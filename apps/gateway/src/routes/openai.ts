import type { FastifyInstance } from "fastify";
import type { AppConfig } from "../config.js";
import { NoAvailableAccountError } from "../account-pool/AccountPool.js";
import { CircuitBreakerOpenError } from "../services/CircuitBreaker.js";
import { createAuthMiddleware } from "../middleware/auth.js";
import { ProviderError } from "../providers/base/ProviderErrors.js";
import { isProviderStream, writeOpenAIStream } from "../utils/sse.js";
import { openAIChatCompletionRequestSchema } from "../validation/openaiSchemas.js";

export async function registerOpenAIRoutes(
  app: FastifyInstance,
  config: AppConfig
): Promise<void> {
  app.post(
    "/v1/chat/completions",
    {
      preHandler: createAuthMiddleware(
        config,
        app.apiKeyService,
        app.rateLimitService
      )
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

      // Team enforcement: check allowedModels if key belongs to a team
      if (request.auth?.apiKeyHash) {
        const keyRecord = app.apiKeyService.findByHash(request.auth.apiKeyHash);
        if (keyRecord?.teamId) {
          const team = app.teamService.get(keyRecord.teamId);
          if (team && team.enabled && team.allowedModels?.length) {
            if (!team.allowedModels.includes(body.model)) {
              await reply.code(403).send({
                error: {
                  type: "forbidden",
                  message: `Team "${team.name}" does not allow model "${body.model}". Allowed: ${team.allowedModels.join(", ")}`,
                  code: "team_model_not_allowed"
                }
              });
              return reply;
            }
          }
        }
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
                credentialPayload
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
                  totalTokens: promptTokens + completionTokens
                });
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
              totalTokens: promptTokens + completionTokens
            });
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
