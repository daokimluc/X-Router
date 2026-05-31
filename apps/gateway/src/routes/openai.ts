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
import { resolveAccountProxyOptions } from "../proxy/resolveAccountProxy.js";
import { buildCacheKey, resolveCacheMode } from "../services/ResponseCacheService.js";
import type { NormalizedOpenAIResponse } from "../providers/base/types.js";

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
          getModel: (req) => (req.body as { model?: string } | undefined)?.model,
          modelPricingService: app.modelPricingService,
          spendLedgerService: app.spendLedgerService,
          getBody: (req) => req.body as { messages?: Array<{ content?: unknown }>; max_tokens?: number } | undefined
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

      // Phase 32 — semantic-response-cache lookup (non-streaming only)
      const apiKeyHash = request.auth?.apiKeyHash;
      const apiKeyRecord = apiKeyHash ? app.apiKeyService.findByHash(apiKeyHash) : undefined;
      const cacheControl = (body as { cache_control?: { mode?: string; ttl?: number } }).cache_control;
      const cacheHeader = request.headers["x-gateway-cache-control"];
      const cacheMode = resolveCacheMode({
        bodyMode: cacheControl?.mode,
        headerMode: typeof cacheHeader === "string" ? cacheHeader : undefined,
        apiKeyMode: apiKeyRecord?.cacheMode,
        temperature: body.temperature ?? null,
        top_p: (body as { top_p?: number }).top_p ?? null,
        top_k: (body as { top_k?: number }).top_k ?? null,
        isStream: body.stream === true,
        hasTools: Array.isArray((body as { tools?: unknown[] }).tools) && ((body as { tools: unknown[] }).tools.length > 0)
      });
      const cacheKey = cacheMode !== "skip" ? buildCacheKey({
        model: body.model,
        protocol: "openai",
        messages: body.messages,
        temperature: body.temperature ?? null,
        top_p: (body as { top_p?: number }).top_p ?? null,
        top_k: (body as { top_k?: number }).top_k ?? null,
        max_tokens: body.max_tokens ?? null,
        stop: (body as { stop?: unknown }).stop,
        reasoning_effort: (body as { reasoning_effort?: string }).reasoning_effort ?? null,
        apiKeyHash
      }) : null;

      if (cacheMode === "use" && cacheKey) {
        const cached = app.responseCacheService.read(cacheKey) as NormalizedOpenAIResponse | null;
        if (cached) {
          reply.header("x-gateway-cache", "hit");
          // Record zero-cost UsageRecord with cacheHit
          app.usageService.record({
            requestId: request.id,
            protocol: "openai",
            model: body.model,
            providerType: "cache",
            providerInstanceId: "cache",
            apiKeyHash,
            promptTokens: cached.usage?.prompt_tokens ?? 0,
            completionTokens: cached.usage?.completion_tokens ?? 0,
            totalTokens: cached.usage?.total_tokens ?? 0,
            estimatedCost: 0,
            cacheHit: true
          });
          return cached;
        }
      }
      if (cacheMode !== "skip") {
        reply.header("x-gateway-cache", cacheMode === "refresh" ? "refresh" : "miss");
      }

      // Apply Token Saver compression to messages
      const processedMessages = app.tokenSaverService.applyToMessages(
        body.messages as Array<{ role: string; content: unknown }>
      ) as typeof body.messages;
      const processedBody = { ...body, messages: processedMessages };

      const route = app.modelResolver.resolve(body.model, ["chat"], (() => {
        if (!request.auth?.apiKeyHash) return {};
        const keyRecord = app.apiKeyService.findByHash(request.auth.apiKeyHash);
        return {
          keyGroupName: keyRecord?.groupName,
          crossGroupRetry: keyRecord?.crossGroupRetry
        };
      })());
      let lastError: unknown;

      // lowest-cost-routing-wiring — reorder pooled candidates cheapest-seller-
      // first (no-op when marketplace is off). The failover loop below then tries
      // the cheapest and falls over to the next cheapest automatically.
      route.candidates = app.marketplaceSeam.rankCandidates(body.model, route.candidates);

      // Phase 20c — group routing may filter out all candidates without
      // crossGroupRetry. Return a clear 404 instead of falling through to
      // the generic "no available account" error.
      if (route.candidates.length === 0) {
        await reply.code(404).send({
          error: {
            type: "not_found",
            message: `No provider in your group can serve model "${body.model}"`,
            code: "no_provider_in_group"
          }
        });
        return reply;
      }

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
          const requestStart = performance.now();

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
              model: candidate.publicModel,
              // lowest-cost-routing-wiring — let a `lowest_cost` pool rank by
              // seller cost (undefined when marketplace off / no costed supply).
              costFor: app.marketplaceSeam.costForModel(candidate.publicModel)
            });
            // lowest-cost-routing-wiring — capture routed settlement context from
            // the account actually leased (marketplace fills request.routed).
            app.marketplaceSeam.captureRouted(request, candidate.publicModel, lease.account.id);
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
                reasoningEffort: route.reasoningEffort,
                proxyOptions: resolveAccountProxyOptions(lease.account, app.proxyPoolService)
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
                app.latencyTracker.record({
                  providerInstanceId: candidate.providerInstanceId,
                  publicModel: candidate.publicModel,
                  accountId: lease.account.id,
                  durationMs: Math.round(performance.now() - requestStart),
                  ok: true
                });
                const reported = response.usage?.();
                let promptTokens: number;
                let completionTokens: number;
                if (reported) {
                  promptTokens = reported.prompt_tokens;
                  completionTokens = reported.completion_tokens;
                } else {
                  const inputChars = processedBody.messages.reduce((sum, m) => {
                    const content = typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? "");
                    return sum + content.length;
                  }, 0);
                  promptTokens = Math.ceil(inputChars / 4);
                  completionTokens = Math.ceil(outputChars / 4);
                }
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
                }
                app.accountQuotaService.recordUsage(
                  lease.account.id,
                  promptTokens + completionTokens
                );
                // Phase 32 — settle spend reservation against actual cost
                if (request.spendReservation) {
                  const settleCost = app.modelPricingService.calculateCost(body.model, promptTokens, completionTokens).totalCost;
                  const ids = request.spendReservation.id.split("|");
                  for (const id of ids) {
                    app.spendLedgerService.settle(id, settleCost);
                  }
                }
                // two-sided-settlement (#6) — marketplace settlement (plan bucket
                // or wallet) + seller credit. No-op when marketplace is off.
                app.marketplaceSeam.runSettlement({
                  request, outcome: "success", model: body.model, promptTokens, completionTokens
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

                // Release held reservations on a mid-stream failure — otherwise
                // the PAYG wallet hold (debited up-front at enforce time) and the
                // spend buckets stay charged for a request that never completed.
                if (request.spendReservation) {
                  const ids = request.spendReservation.id.split("|");
                  for (const id of ids) {
                    app.spendLedgerService.release(id);
                  }
                  request.spendReservation = undefined;
                }
                app.marketplaceSeam.runSettlement({
                  request, outcome: "failure", model: body.model, promptTokens: 0, completionTokens: 0
                });

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
            app.latencyTracker.record({
              providerInstanceId: candidate.providerInstanceId,
              publicModel: candidate.publicModel,
              accountId: lease.account.id,
              durationMs: Math.round(performance.now() - requestStart),
              ok: true
            });
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
            }
            app.accountQuotaService.recordUsage(
              lease.account.id,
              promptTokens + completionTokens
            );
            // Phase 32 — settle spend reservation against actual cost
            if (request.spendReservation) {
              const settleCost = app.modelPricingService.calculateCost(body.model, promptTokens, completionTokens).totalCost;
              const ids = request.spendReservation.id.split("|");
              for (const id of ids) {
                app.spendLedgerService.settle(id, settleCost);
              }
            }
            // two-sided-settlement (#6) — marketplace settlement + seller credit.
            app.marketplaceSeam.runSettlement({
              request, outcome: "success", model: body.model, promptTokens, completionTokens
            });
            // Phase 32 — semantic-response-cache write (non-stream, no tool_calls)
            const respMessage = response.choices?.[0]?.message as Record<string, unknown> | undefined;
            const hasToolCalls = Array.isArray(respMessage?.tool_calls) && (respMessage!.tool_calls as unknown[]).length > 0;
            if (cacheKey && cacheMode !== "skip" && !hasToolCalls) {
              const ttl = (body as { cache_control?: { ttl?: number } }).cache_control?.ttl;
              app.responseCacheService.write(cacheKey, response, body.model, ttl);
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
              app.latencyTracker.record({
                providerInstanceId: candidate.providerInstanceId,
                publicModel: candidate.publicModel,
                accountId: lease.account.id,
                durationMs: Math.round(performance.now() - requestStart),
                ok: false
              });
            }

            if (isProviderFailureForCircuit(error)) {
              app.circuitBreaker.recordFailure(
                providerInstance.id,
                providerInstance.circuitBreaker
              );
            }

            if (!isRetryableProviderError(error)) {
              // Phase 32 — release spend reservation on terminal failure
              if (request.spendReservation) {
                const ids = request.spendReservation.id.split("|");
                for (const id of ids) {
                  app.spendLedgerService.release(id);
                }
                request.spendReservation = undefined;
              }
              // two-sided-settlement (#6) — release marketplace reservations
              // (plan bucket / wallet / payg-daily); no seller credit.
              app.marketplaceSeam.runSettlement({
                request, outcome: "failure", model: body.model, promptTokens: 0, completionTokens: 0
              });
              throw error;
            }
          }
        }
      }

      // Every candidate exhausted (all retryable) or none available — release any
      // held reservation + run failure settlement so a wallet hold isn't leaked.
      if (request.spendReservation) {
        const ids = request.spendReservation.id.split("|");
        for (const id of ids) {
          app.spendLedgerService.release(id);
        }
        request.spendReservation = undefined;
      }
      app.marketplaceSeam.runSettlement({
        request, outcome: "failure", model: body.model, promptTokens: 0, completionTokens: 0
      });

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

  if (error.code === "provider_account_suspended") {
    accountPool.disable(accountId, error.message);
  }
}
