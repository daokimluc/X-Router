import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { AppConfig } from "../config.js";
import { NoAvailableAccountError } from "../account-pool/AccountPool.js";
import { CircuitBreakerOpenError } from "../services/CircuitBreaker.js";
import { createAuthMiddleware } from "../middleware/auth.js";
import { createKeyPolicyEnforcer } from "../middleware/enforceKeyPolicy.js";
import { ProviderError } from "../providers/base/ProviderErrors.js";
import { isProviderStream, writeOpenAIStream } from "../utils/sse.js";
import { openAIChatCompletionRequestSchema } from "../validation/openaiSchemas.js";
import type { ProviderProtocol } from "../providers/base/ProviderCapabilities.js";

export async function registerOpenAIRoutes(
  app: FastifyInstance,
  config: AppConfig
): Promise<void> {
  app.post(
    "/v1/chat/completions",
    {
      preHandler: [
        createAuthMiddleware(
          config,
          app.apiKeyService,
          app.rateLimitService,
          app.teamService
        ),
        createKeyPolicyEnforcer({
          apiKeyService: app.apiKeyService,
          teamService: app.teamService,
          getModel: (req) => (req.body as { model?: string } | undefined)?.model
        })
      ]
    },
    async (request, reply) => {
      let releaseGlobal: (() => void) | undefined;
      try {
        releaseGlobal = app.concurrencyLimiter.acquireGlobal();
      } catch (concurrencyErr) {
        // If queue is enabled, wait for a slot instead of rejecting immediately
        if (app.requestQueueService.isEnabled()) {
          await app.requestQueueService.waitForSlot();
          releaseGlobal = app.concurrencyLimiter.acquireGlobal();
        } else {
          throw concurrencyErr;
        }
      }

      try {
      const body = openAIChatCompletionRequestSchema.parse(request.body);

      // Direct account routing: when x-provider-account-id header is present,
      // route directly to the specified account's adapter
      const directAccountId = request.headers["x-provider-account-id"];
      if (typeof directAccountId === "string" && directAccountId.length > 0) {
        const directResult = await handleDirectAccountRouting(app, request, reply, body, directAccountId, "openai_chat_completions");
        return directResult;
      }

      // Apply Token Saver compression to messages
      const processedMessages = app.tokenSaverService.applyToMessages(
        body.messages as Array<{ role: string; content: unknown }>
      ) as typeof body.messages;
      const processedBody = { ...body, messages: processedMessages };

      const route = app.modelResolver.resolve(body.model, ["chat"]);
      let lastError: unknown;

      for (const candidate of route.candidates) {
        const providerInstance = app.providerRuntimeRegistry.getProviderInstance(
          candidate.providerInstanceId
        );

        if (!providerInstance || !providerInstance.enabled) {
          continue;
        }

        if (
          !app.circuitBreaker.canRequest(
            providerInstance.id,
            providerInstance.circuitBreaker
          )
        ) {
          lastError = new CircuitBreakerOpenError(providerInstance.id);
          request.log.warn(
            {
              requestId: request.id,
              providerInstanceId: providerInstance.id,
              model: body.model
            },
            "provider skipped because circuit breaker is open"
          );
          continue;
        }

        const adapter = app.providerRegistry.getAdapter(candidate.providerType);
        const accountPool = app.providerRuntimeRegistry.getAccountPool(
          candidate.providerInstanceId
        );

        if (!accountPool) {
          continue;
        }

        const attempts = providerInstance.maxRetries + 1;

        for (let attempt = 0; attempt < attempts; attempt += 1) {
          let lease;
          let releaseProvider: (() => void) | undefined;

          try {
            app.circuitBreaker.beforeRequest(
              providerInstance.id,
              providerInstance.circuitBreaker
            );
            releaseProvider = app.concurrencyLimiter.acquireProvider(
              providerInstance.id,
              providerInstance.maxConcurrentRequests
            );
            lease = accountPool.acquire({
              model: candidate.publicModel
            });
            const secret = app.secretService.getSecretForAccount(lease.account.id);
            const credentialPayload = secret
              ? app.secretService.decryptSecretPayload(secret)
              : {};
            const response = await adapter.chatCompletions(
              {
                ...processedBody,
                model: candidate.upstreamModel
              },
              {
                providerInstance,
                account: lease.account,
                requestId: request.id,
                credentialPayload,
                reasoningEffort: route.reasoningEffort
              }
            );

            if (isProviderStream(response)) {
              try {
                const outputChars = await writeOpenAIStream({
                  reply,
                  stream: response,
                  model: body.model,
                  requestId: request.id
                });
                lease.releaseSuccess();
                app.circuitBreaker.recordSuccess(providerInstance.id);
                // Estimate tokens for streaming: input from messages, output from streamed chars
                const inputChars = processedBody.messages.reduce((sum, m) => {
                  const content = typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? "");
                  return sum + content.length;
                }, 0);
                const promptTokens = Math.ceil(inputChars / 4);
                const completionTokens = Math.ceil(outputChars / 4);
                const cost = app.modelPricingService.calculateCost(body.model, promptTokens, completionTokens);
                app.usageService.record({
                  requestId: request.id,
                  protocol: "openai",
                  model: body.model,
                  providerType: candidate.providerType,
                  providerInstanceId: candidate.providerInstanceId,
                  accountId: lease.account.id,
                  apiKeyHash: request.auth?.apiKeyHash,
                  promptTokens,
                  completionTokens,
                  totalTokens: promptTokens + completionTokens,
                  estimatedCost: cost.totalCost || undefined
                });
                if (request.auth?.apiKeyHash) {
                  app.rateLimitService.consumeTokens(
                    request.auth.apiKeyHash,
                    promptTokens + completionTokens
                  );
                  app.apiKeyService.deductBalance(
                    request.auth.apiKeyHash,
                    promptTokens + completionTokens
                  );
                }
              } catch (streamError) {
                lease.releaseFailure(
                  streamError instanceof Error ? streamError.message : "stream failed"
                );

                if (isProviderFailureForCircuit(streamError)) {
                  app.circuitBreaker.recordFailure(
                    providerInstance.id,
                    providerInstance.circuitBreaker
                  );
                }

                request.log.warn(
                  {
                    requestId: request.id,
                    providerInstanceId: providerInstance.id
                  },
                  "provider stream failed after response started"
                );

                if (!reply.raw.writableEnded) {
                  reply.raw.end();
                }
              } finally {
                releaseProvider();
              }

              return reply;
            }

            lease.releaseSuccess();
            releaseProvider();
            app.circuitBreaker.recordSuccess(providerInstance.id);
            // Record usage — use real tokens if available, otherwise estimate from content
            const realUsage = response.usage;
            let promptTokens = realUsage?.prompt_tokens ?? 0;
            let completionTokens = realUsage?.completion_tokens ?? 0;
            // Estimate tokens if provider didn't report them
            if (promptTokens === 0 && processedBody.messages) {
              const inputChars = processedBody.messages.reduce((sum, m) => {
                const content = typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? "");
                return sum + content.length;
              }, 0);
              promptTokens = Math.ceil(inputChars / 4);
            }
            if (completionTokens === 0 && response.choices?.[0]?.message?.content) {
              completionTokens = Math.ceil(response.choices[0].message.content.length / 4);
            }
            app.usageService.record({
              requestId: request.id,
              protocol: "openai",
              model: body.model,
              providerType: candidate.providerType,
              providerInstanceId: candidate.providerInstanceId,
              accountId: lease.account.id,
              apiKeyHash: request.auth?.apiKeyHash,
              promptTokens,
              completionTokens,
              totalTokens: promptTokens + completionTokens,
              estimatedCost: app.modelPricingService.calculateCost(body.model, promptTokens, completionTokens).totalCost || undefined
            });
            if (request.auth?.apiKeyHash) {
              app.rateLimitService.consumeTokens(
                request.auth.apiKeyHash,
                promptTokens + completionTokens
              );
              app.apiKeyService.deductBalance(
                request.auth.apiKeyHash,
                promptTokens + completionTokens
              );
            }
            return {
              ...response,
              model: body.model
            };
          } catch (error) {
            if (!(error instanceof NoAvailableAccountError && lastError)) {
              lastError = error;
            }
            releaseProvider?.();

            // Auto-refresh on auth error: try refreshSession before disabling
            if (
              lease &&
              error instanceof ProviderError &&
              error.code === "provider_auth_error" &&
              adapter.refreshSession &&
              attempt === 0 // only try refresh on first attempt
            ) {
              try {
                const secret = app.secretService.getSecretForAccount(lease.account.id);
                const cred = secret ? app.secretService.decryptSecretPayload(secret) : {};
                const refreshResult = await adapter.refreshSession(lease.account, {
                  providerInstance,
                  credentialPayload: cred
                });
                if (refreshResult.refreshed && refreshResult.credentialPayload && secret) {
                  app.secretService.updateSecretPayload(secret.id, refreshResult.credentialPayload);
                  request.log.info({ accountId: lease.account.id }, "session refreshed, will retry");
                  lease.releaseFailure("auth_error_refreshed");
                  continue; // retry with refreshed credential
                }
              } catch (refreshErr) {
                request.log.warn({ accountId: lease.account.id, err: refreshErr }, "session refresh failed");
              }
            }

            if (lease) {
              lease.releaseFailure(error instanceof Error ? error.message : "unknown error");
              handleProviderAccountState(error, accountPool, lease.account.id, providerInstance.cooldownMs);
            }

            if (isProviderFailureForCircuit(error)) {
              app.circuitBreaker.recordFailure(
                providerInstance.id,
                providerInstance.circuitBreaker
              );
            }

            if (!isRetryableProviderError(error)) {
              throw error;
            }
          }
        }
      }

      if (lastError) {
        throw lastError;
      }

      throw new NoAvailableAccountError();
      } finally {
        releaseGlobal?.();
        app.requestQueueService.release(); // notify next queued request
      }
    }
  );
}

/**
 * Handle direct account routing when x-provider-account-id header is present.
 * Looks up the account, validates protocol compatibility, and routes to the correct adapter.
 * Credentials are injected into the adapter context without being exposed in logs or errors.
 */
async function handleDirectAccountRouting(
  app: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply,
  body: Record<string, unknown>,
  accountId: string,
  requiredProtocol: ProviderProtocol
) {
  // Lookup ProviderAccount by account ID
  const account = app.providerRuntimeRegistry.getAccount(accountId);
  if (!account) {
    await reply.code(404).send({
      error: {
        type: "invalid_request_error",
        message: `Provider account "${accountId}" not found`,
        code: "account_not_found"
      }
    });
    return reply;
  }

  // Determine adapter type from ProviderTypeDefinition
  const definition = app.providerRegistry.getDefinition(account.providerType);

  // Validate protocol compatibility
  if (definition && !definition.supportedProtocols.includes(requiredProtocol)) {
    await reply.code(400).send({
      error: {
        type: "invalid_request_error",
        message: `Provider "${definition.displayName}" (type: ${account.providerType}) does not support protocol "${requiredProtocol}". Supported protocols: ${definition.supportedProtocols.join(", ")}`,
        code: "protocol_not_supported"
      }
    });
    return reply;
  }

  // Route to correct adapter instance via ProviderAdapterRegistry
  const adapter = app.providerRegistry.getAdapter(account.providerType);

  // Get provider instance for the account
  const providerInstance = app.providerRuntimeRegistry.getProviderInstance(
    account.providerInstanceId
  );
  if (!providerInstance) {
    await reply.code(404).send({
      error: {
        type: "invalid_request_error",
        message: `Provider instance for account "${accountId}" not found`,
        code: "provider_instance_not_found"
      }
    });
    return reply;
  }

  // Inject credentials into adapter context without exposing in logs/errors
  const secret = app.secretService.getSecretForAccount(account.id);
  const credentialPayload = secret
    ? app.secretService.decryptSecretPayload(secret)
    : {};

  const response = await adapter.chatCompletions(body as any, {
    providerInstance,
    account,
    requestId: request.id,
    credentialPayload
  });

  if (isProviderStream(response)) {
    await writeOpenAIStream({
      reply,
      stream: response,
      model: (body as any).model ?? "unknown",
      requestId: request.id
    });
    return reply;
  }

  return response;
}

function isRetryableProviderError(error: unknown): boolean {
  return error instanceof ProviderError && error.retryable;
}

function isProviderFailureForCircuit(error: unknown): boolean {
  return (
    error instanceof ProviderError &&
    ["provider_rate_limited", "provider_timeout", "provider_unavailable"].includes(
      error.code
    )
  );
}

function handleProviderAccountState(
  error: unknown,
  accountPool: {
    setCooldown(accountId: string, cooldownUntil: Date, error?: string): void;
    disable(accountId: string, error?: string): void;
  },
  accountId: string,
  cooldownMs: number
): void {
  if (!(error instanceof ProviderError)) {
    return;
  }

  if (error.code === "provider_rate_limited") {
    accountPool.setCooldown(
      accountId,
      new Date(Date.now() + cooldownMs),
      error.message
    );
  }

  if (error.code === "provider_auth_error") {
    accountPool.disable(accountId, error.message);
  }
}
