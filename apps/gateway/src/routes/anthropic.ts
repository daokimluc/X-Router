import type { FastifyInstance, FastifyReply } from "fastify";
import type { AppConfig } from "../config.js";
import { NoAvailableAccountError } from "../account-pool/AccountPool.js";
import { CircuitBreakerOpenError } from "../services/CircuitBreaker.js";
import { createAuthMiddleware } from "../middleware/auth.js";
import { createKeyPolicyEnforcer } from "../middleware/enforceKeyPolicy.js";
import { ProviderError } from "../providers/base/ProviderErrors.js";
import { compressToolOutput } from "../services/TokenSaverService.js";
import { resolveAccountProxyOptions } from "../proxy/resolveAccountProxy.js";
import { buildCacheKey, resolveCacheMode } from "../services/ResponseCacheService.js";
import type {
  AnthropicMessagesRequest,
  NormalizedAnthropicResponse,
  NormalizedOpenAIResponse,
  OpenAIChatCompletionRequest,
  ProviderStream
} from "../providers/base/types.js";
import { isProviderStream } from "../utils/sse.js";
import { anthropicMessagesRequestSchema } from "../validation/openaiSchemas.js";
import type { ProviderProtocol } from "../providers/base/ProviderCapabilities.js";

export async function registerAnthropicRoutes(
  app: FastifyInstance,
  config: AppConfig
): Promise<void> {
  app.post(
    "/v1/messages",
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
      const releaseGlobal = app.concurrencyLimiter.acquireGlobal();

      try {
        const body = anthropicMessagesRequestSchema.parse(request.body);

        // Direct account routing: when x-provider-account-id header is present,
        // route directly to the specified account's adapter
        const directAccountId = request.headers["x-provider-account-id"];
        if (typeof directAccountId === "string" && directAccountId.length > 0) {
          const directResult = await handleDirectAnthropicRouting(app, request, reply, body, directAccountId);
          return directResult;
        }

        // Phase 32 — semantic-response-cache lookup (non-streaming only)
        const apiKeyHash = request.auth?.apiKeyHash;
        const apiKeyRecord = apiKeyHash ? app.apiKeyService.findByHash(apiKeyHash) : undefined;
        const bodyAny = body as Record<string, unknown>;
        const cacheControl = bodyAny.cache_control as { mode?: string; ttl?: number } | undefined;
        const cacheHeader = request.headers["x-gateway-cache-control"];
        const cacheMode = resolveCacheMode({
          bodyMode: cacheControl?.mode,
          headerMode: typeof cacheHeader === "string" ? cacheHeader : undefined,
          apiKeyMode: apiKeyRecord?.cacheMode,
          temperature: (bodyAny.temperature as number | undefined) ?? null,
          top_p: (bodyAny.top_p as number | undefined) ?? null,
          top_k: (bodyAny.top_k as number | undefined) ?? null,
          isStream: body.stream === true,
          hasTools: Array.isArray(body.tools) && body.tools.length > 0
        });
        const cacheKey = cacheMode !== "skip" ? buildCacheKey({
          model: body.model,
          protocol: "anthropic",
          messages: body.messages,
          temperature: (bodyAny.temperature as number | undefined) ?? null,
          top_p: (bodyAny.top_p as number | undefined) ?? null,
          top_k: (bodyAny.top_k as number | undefined) ?? null,
          max_tokens: body.max_tokens ?? null,
          stop: bodyAny.stop_sequences,
          reasoning_effort: null,
          apiKeyHash
        }) : null;

        if (cacheMode === "use" && cacheKey) {
          const cached = app.responseCacheService.read(cacheKey) as {
            usage?: { input_tokens?: number; output_tokens?: number };
          } | null;
          if (cached) {
            reply.header("x-gateway-cache", "hit");
            const inputTokens = cached.usage?.input_tokens ?? 0;
            const outputTokens = cached.usage?.output_tokens ?? 0;
            app.usageService.record({
              requestId: request.id,
              protocol: "anthropic",
              model: body.model,
              providerType: "cache",
              providerInstanceId: "cache",
              apiKeyHash,
              promptTokens: inputTokens,
              completionTokens: outputTokens,
              totalTokens: inputTokens + outputTokens,
              estimatedCost: 0,
              cacheHit: true
            });
            return cached;
          }
        }
        if (cacheMode !== "skip") {
          reply.header("x-gateway-cache", cacheMode === "refresh" ? "refresh" : "miss");
        }

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
        // first (no-op when marketplace is off); failover loop tries next cheapest.
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

          for (let attempt = 0; attempt < providerInstance.maxRetries + 1; attempt += 1) {
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
                model: candidate.publicModel
              });
              // lowest-cost-routing-wiring — capture routed context from the lease.
              app.marketplaceSeam.captureRouted(request, candidate.publicModel, lease.account.id);
              const secret = app.secretService.getSecretForAccount(lease.account.id);
              const credentialPayload = secret
                ? app.secretService.decryptSecretPayload(secret)
                : {};
              const compressedMessages = app.tokenSaverService.getSettings().compressToolOutput
                ? compressMessagesToolOutput(body.messages)
                : body.messages;

              // Prefer native Anthropic protocol when the adapter supports it.
              // chatCompletions translation is lossy (drops tools/tool_choice/
              // tool_use blocks), which breaks Anthropic clients like Claude
              // Desktop that depend on native tool_use round-trips.
              let response: NormalizedOpenAIResponse | NormalizedAnthropicResponse | ProviderStream;
              const usedNativeMessages = typeof adapter.messages === "function";
              if (usedNativeMessages) {
                const anthropicRequest: AnthropicMessagesRequest = {
                  model: candidate.upstreamModel,
                  max_tokens: body.max_tokens,
                  messages: compressedMessages,
                  system: body.system,
                  stream: body.stream,
                  temperature: body.temperature,
                  tools: body.tools,
                  tool_choice: body.tool_choice
                };
                response = await adapter.messages!(anthropicRequest, {
                  providerInstance,
                  account: lease.account,
                  requestId: request.id,
                  credentialPayload,
                  reasoningEffort: route.reasoningEffort,
                  proxyOptions: resolveAccountProxyOptions(lease.account, app.proxyPoolService)
                });
              } else {
                const openAIRequest = toOpenAIChatRequest({
                  model: candidate.upstreamModel,
                  maxTokens: body.max_tokens,
                  stream: body.stream,
                  temperature: body.temperature,
                  system: body.system,
                  messages: compressedMessages,
                  tools: body.tools,
                  tool_choice: body.tool_choice
                });
                response = await adapter.chatCompletions(openAIRequest, {
                  providerInstance,
                  account: lease.account,
                  requestId: request.id,
                  credentialPayload,
                  reasoningEffort: route.reasoningEffort,
                  proxyOptions: resolveAccountProxyOptions(lease.account, app.proxyPoolService)
                });
              }

              if (isProviderStream(response)) {
                try {
                  const streamResult = await writeAnthropicStream({
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
                  // Phase 31 — prefer real usage from stream when adapter emits it,
                  // fall back to char-based estimation otherwise.
                  const reported = response.usage?.();
                  let promptTokens: number;
                  let completionTokens: number;
                  if (reported) {
                    promptTokens = reported.prompt_tokens;
                    completionTokens = reported.completion_tokens;
                  } else {
                    const inputChars = JSON.stringify(body.messages).length;
                    promptTokens = Math.ceil(inputChars * 0.42);
                    completionTokens = Math.ceil(streamResult.outputChars * 0.4);
                  }
                  app.usageService.record({
                    requestId: request.id,
                    protocol: "anthropic",
                    model: body.model,
                    providerType: candidate.providerType,
                    providerInstanceId: candidate.providerInstanceId,
                    accountId: lease.account.id,
                    apiKeyHash: request.auth?.apiKeyHash,
                    promptTokens,
                    completionTokens,
                    totalTokens: promptTokens + completionTokens,
                    cachedTokens: reported?.cached_tokens || undefined,
                    estimatedCost: app.modelPricingService.calculateCost(
                      body.model,
                      promptTokens,
                      completionTokens,
                      reported?.cached_tokens ?? 0
                    ).totalCost || undefined
                  });
                  app.accountQuotaService.recordUsage(
                    lease.account.id,
                    promptTokens + completionTokens
                  );
                  // Phase 32 — settle spend reservation
                  if (request.spendReservation) {
                    const ids = request.spendReservation.id.split("|");
                    for (const id of ids) {
                      app.spendLedgerService.settle(id, app.modelPricingService.calculateCost(body.model, promptTokens, completionTokens, reported?.cached_tokens ?? 0).totalCost);
                    }
                  }
                  // two-sided-settlement (#6) — marketplace settlement + seller credit.
                  app.marketplaceSeam.runSettlement({
                    request, outcome: "success", model: body.model, promptTokens, completionTokens, cachedTokens: reported?.cached_tokens ?? 0
                  });
                } catch (streamError) {
                  lease.releaseFailure(
                    streamError instanceof Error
                      ? streamError.message
                      : "stream failed"
                  );

                  if (isProviderFailureForCircuit(streamError)) {
                    app.circuitBreaker.recordFailure(
                      providerInstance.id,
                      providerInstance.circuitBreaker
                    );
                  }

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
              // Normalize usage shape across the two non-stream return types.
              // Native AnthropicMessagesResponse uses input_tokens/output_tokens;
              // OpenAI chatCompletions uses prompt_tokens/completion_tokens.
              const u = (response as { usage?: unknown }).usage;
              const usageNormalized = normalizeUsageShape(u);
              if (usageNormalized) {
                const cachedTokens = usageNormalized.cached_tokens ?? 0;
                app.usageService.record({
                  requestId: request.id,
                  protocol: "anthropic",
                  model: body.model,
                  providerType: candidate.providerType,
                  providerInstanceId: candidate.providerInstanceId,
                  accountId: lease.account.id,
                  apiKeyHash: request.auth?.apiKeyHash,
                  promptTokens: usageNormalized.prompt_tokens,
                  completionTokens: usageNormalized.completion_tokens,
                  totalTokens: usageNormalized.total_tokens,
                  cachedTokens: cachedTokens || undefined,
                  estimatedCost: app.modelPricingService.calculateCost(
                    body.model,
                    usageNormalized.prompt_tokens,
                    usageNormalized.completion_tokens,
                    cachedTokens
                  ).totalCost || undefined
                });
                if (request.auth?.apiKeyHash) {
                  app.rateLimitService.consumeTokens(
                    request.auth.apiKeyHash,
                    usageNormalized.total_tokens
                  );
                }
                app.accountQuotaService.recordUsage(
                  lease.account.id,
                  usageNormalized.total_tokens
                );
                // Phase 32 — settle spend reservation
                if (request.spendReservation) {
                  const ids = request.spendReservation.id.split("|");
                  const cost = app.modelPricingService.calculateCost(
                    body.model,
                    usageNormalized.prompt_tokens,
                    usageNormalized.completion_tokens,
                    cachedTokens
                  ).totalCost;
                  for (const id of ids) {
                    app.spendLedgerService.settle(id, cost);
                  }
                }
                // two-sided-settlement (#6) — marketplace settlement + seller credit.
                app.marketplaceSeam.runSettlement({
                  request, outcome: "success", model: body.model,
                  promptTokens: usageNormalized.prompt_tokens,
                  completionTokens: usageNormalized.completion_tokens,
                  cachedTokens
                });
              }
              // Phase 32 — semantic-response-cache write (non-stream, normalized response)
              if (cacheKey && cacheMode !== "skip") {
                const ttl = (cacheControl?.ttl as number | undefined);
                app.responseCacheService.write(cacheKey, response, body.model, ttl);
              }
              if (usedNativeMessages) {
                // Adapter returned NormalizedAnthropicResponse already; just
                // overwrite the model field with the public model the client asked for.
                return { ...(response as NormalizedAnthropicResponse), model: body.model };
              }
              return toAnthropicResponse(response as NormalizedOpenAIResponse, body.model);
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
                lease.releaseFailure(
                  error instanceof Error ? error.message : "unknown error"
                );
                handleProviderAccountState(
                  error,
                  accountPool,
                  lease.account.id,
                  providerInstance.cooldownMs
                );
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
                // two-sided-settlement (#6) — release marketplace reservations.
                app.marketplaceSeam.runSettlement({
                  request, outcome: "failure", model: body.model, promptTokens: 0, completionTokens: 0
                });
                throw error;
              }
            }
          }
        }

        if (lastError) {
          // Phase 32 — release reservation if all retries exhausted
          if (request.spendReservation) {
            const ids = request.spendReservation.id.split("|");
            for (const id of ids) {
              app.spendLedgerService.release(id);
            }
            request.spendReservation = undefined;
          }
          // two-sided-settlement (#6) — release marketplace reservations.
          app.marketplaceSeam.runSettlement({
            request, outcome: "failure", model: body.model, promptTokens: 0, completionTokens: 0
          });
          throw lastError;
        }

        throw new NoAvailableAccountError();
      } finally {
        releaseGlobal();
      }
    }
  );
}

/**
 * Handle direct account routing for /v1/messages when x-provider-account-id header is present.
 * Validates that the provider supports anthropic_messages protocol.
 * Credentials are injected into the adapter context without being exposed in logs or errors.
 */
async function handleDirectAnthropicRouting(
  app: FastifyInstance,
  request: any,
  reply: any,
  body: any,
  accountId: string
) {
  const requiredProtocol: ProviderProtocol = "anthropic_messages";

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

  // Validate protocol compatibility: /v1/messages requires anthropic_messages
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

  // If adapter supports native anthropic_messages protocol, use messages() directly
  if (adapter.messages) {
    const response = await adapter.messages(body, {
      providerInstance,
      account,
      requestId: request.id,
      credentialPayload,
      proxyOptions: resolveAccountProxyOptions(account, app.proxyPoolService)
    });

    if (isProviderStream(response)) {
      await writeAnthropicStream({
        reply,
        stream: response,
        model: body.model,
        requestId: request.id
      });
      return reply;
    }

    return response;
  }

  // Fallback: convert to OpenAI format and use chatCompletions. Lossy for
  // tool calling (translation drops the structured fields) — only triggered
  // when the adapter declares anthropic_messages support but doesn't actually
  // implement messages(), which is unlikely in practice.
  const openAIRequest = toOpenAIChatRequest({
    model: body.model,
    maxTokens: body.max_tokens,
    stream: body.stream,
    temperature: body.temperature,
    system: body.system,
    messages: body.messages,
    tools: body.tools,
    tool_choice: body.tool_choice
  });

  const response = await adapter.chatCompletions(openAIRequest, {
    providerInstance,
    account,
    requestId: request.id,
    credentialPayload,
    proxyOptions: resolveAccountProxyOptions(account, app.proxyPoolService)
  });

  if (isProviderStream(response)) {
    await writeAnthropicStream({
      reply,
      stream: response,
      model: body.model,
      requestId: request.id
    });
    return reply;
  }

  return toAnthropicResponse(response, body.model);
}

function toOpenAIChatRequest(options: {
  model: string;
  maxTokens: number;
  stream?: boolean;
  temperature?: number;
  system?: string | Array<Record<string, unknown>>;
  messages: Array<{
    role: "user" | "assistant";
    content: string | Array<Record<string, unknown>>;
  }>;
  tools?: Array<Record<string, unknown>>;
  tool_choice?: Record<string, unknown>;
}): OpenAIChatCompletionRequest {
  const out: OpenAIChatCompletionRequest = {
    model: options.model,
    max_tokens: options.maxTokens,
    stream: options.stream,
    temperature: options.temperature,
    messages: [
      ...(options.system
        ? [
            {
              role: "system" as const,
              content: options.system
            }
          ]
        : []),
      ...options.messages.map((message) => ({
        role: message.role,
        content: message.content
      }))
    ]
  };
  if (options.tools && options.tools.length > 0) {
    out.tools = options.tools.map(translateAnthropicToolToOpenAI);
  }
  if (options.tool_choice !== undefined) {
    out.tool_choice = translateAnthropicToolChoice(options.tool_choice);
  }
  return out;
}

/**
 * Anthropic tool shape: `{ name, description, input_schema }`.
 * OpenAI tool shape: `{ type: "function", function: { name, description, parameters } }`.
 */
function translateAnthropicToolToOpenAI(tool: Record<string, unknown>): Record<string, unknown> {
  if (typeof tool.name === "string" && tool.input_schema && typeof tool.input_schema === "object") {
    return {
      type: "function",
      function: {
        name: tool.name,
        description: typeof tool.description === "string" ? tool.description : "",
        parameters: tool.input_schema as Record<string, unknown>
      }
    };
  }
  return tool;
}

/**
 * Anthropic `tool_choice`: `{ type: "auto" | "any" | "tool" | "none", name? }`.
 * OpenAI: "auto" | "none" | "required" | { type: "function", function: { name } }.
 */
function translateAnthropicToolChoice(
  choice: Record<string, unknown>
): string | Record<string, unknown> {
  const t = choice.type;
  if (t === "auto") return "auto";
  if (t === "none") return "none";
  if (t === "any") return "required";
  if (t === "tool" && typeof choice.name === "string") {
    return { type: "function", function: { name: choice.name } };
  }
  return "auto";
}

function toAnthropicResponse(
  response: NormalizedOpenAIResponse,
  requestedModel: string
): NormalizedAnthropicResponse {
  const firstChoice = response.choices[0];
  const blocks: NormalizedAnthropicResponse["content"] = [];
  const text = firstChoice?.message.content ?? "";
  if (text.length > 0) {
    blocks.push({ type: "text", text });
  }
  const toolCalls = firstChoice?.message.tool_calls;
  if (toolCalls && toolCalls.length > 0) {
    for (const tc of toolCalls) {
      let input: Record<string, unknown> = {};
      const argsStr = tc.function?.arguments ?? "";
      if (argsStr.trim().length > 0) {
        try {
          const parsed = JSON.parse(argsStr);
          input = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : { _raw: argsStr };
        } catch {
          input = { _raw: argsStr };
        }
      }
      blocks.push({
        type: "tool_use",
        id: tc.id,
        name: tc.function?.name ?? "",
        input
      });
    }
  }
  if (blocks.length === 0) blocks.push({ type: "text", text: "" });

  let stopReason: NormalizedAnthropicResponse["stop_reason"];
  if (firstChoice?.finish_reason === "length") stopReason = "max_tokens";
  else if (firstChoice?.finish_reason === "tool_calls") stopReason = "tool_use";
  else stopReason = "end_turn";

  return {
    id: response.id.replace(/^chatcmpl/, "msg"),
    type: "message",
    role: "assistant",
    model: requestedModel,
    content: blocks,
    stop_reason: stopReason,
    usage: response.usage
      ? {
          input_tokens: response.usage.prompt_tokens,
          output_tokens: response.usage.completion_tokens
        }
      : undefined
  };
}

async function writeAnthropicStream(options: {
  reply: FastifyReply;
  stream: ProviderStream;
  model: string;
  requestId: string;
}): Promise<{ outputChars: number }> {
  options.reply.raw.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-request-id": options.requestId
  });

  const messageId = "msg_stream";
  options.reply.raw.write(
    `event: message_start\ndata: ${JSON.stringify({
      type: "message_start",
      message: {
        id: messageId,
        type: "message",
        role: "assistant",
        model: options.model,
        content: [],
        stop_reason: null,
        usage: {
          input_tokens: 0,
          output_tokens: 0
        }
      }
    })}\n\n`
  );

  // Structured-event path: adapter exposes events() — emit text and tool_use
  // blocks as separate Anthropic content blocks with the correct indices.
  if (typeof options.stream.events === "function") {
    let outputChars = 0;
    let blockIndex = -1;
    let textBlockOpen = false;
    let toolBlockOpen = false;
    let stopReason: "end_turn" | "max_tokens" | "stop_sequence" | "tool_use" = "end_turn";

    const closeOpenBlock = () => {
      if (textBlockOpen || toolBlockOpen) {
        options.reply.raw.write(
          `event: content_block_stop\ndata: ${JSON.stringify({
            type: "content_block_stop",
            index: blockIndex
          })}\n\n`
        );
        textBlockOpen = false;
        toolBlockOpen = false;
      }
    };

    for await (const ev of options.stream.events()) {
      if (ev.type === "text_delta") {
        if (toolBlockOpen) closeOpenBlock();
        if (!textBlockOpen) {
          blockIndex += 1;
          textBlockOpen = true;
          options.reply.raw.write(
            `event: content_block_start\ndata: ${JSON.stringify({
              type: "content_block_start",
              index: blockIndex,
              content_block: { type: "text", text: "" }
            })}\n\n`
          );
        }
        outputChars += ev.text.length;
        options.reply.raw.write(
          `event: content_block_delta\ndata: ${JSON.stringify({
            type: "content_block_delta",
            index: blockIndex,
            delta: { type: "text_delta", text: ev.text }
          })}\n\n`
        );
      } else if (ev.type === "tool_use_start") {
        if (textBlockOpen || toolBlockOpen) closeOpenBlock();
        blockIndex += 1;
        toolBlockOpen = true;
        options.reply.raw.write(
          `event: content_block_start\ndata: ${JSON.stringify({
            type: "content_block_start",
            index: blockIndex,
            content_block: {
              type: "tool_use",
              id: ev.id,
              name: ev.name,
              input: {}
            }
          })}\n\n`
        );
      } else if (ev.type === "tool_use_delta") {
        if (!toolBlockOpen) continue;
        options.reply.raw.write(
          `event: content_block_delta\ndata: ${JSON.stringify({
            type: "content_block_delta",
            index: blockIndex,
            delta: { type: "input_json_delta", partial_json: ev.partial_json }
          })}\n\n`
        );
      } else if (ev.type === "tool_use_stop") {
        closeOpenBlock();
      } else if (ev.type === "message_stop") {
        stopReason = ev.stop_reason;
      }
    }

    closeOpenBlock();
    options.reply.raw.write(
      `event: message_delta\ndata: ${JSON.stringify({
        type: "message_delta",
        delta: { stop_reason: stopReason },
        usage: { output_tokens: 0 }
      })}\n\n`
    );
    options.reply.raw.write(
      `event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`
    );
    options.reply.raw.end();
    return { outputChars };
  }

  // Text-only fallback path: adapter only exposes the string AsyncIterable.
  options.reply.raw.write(
    `event: content_block_start\ndata: ${JSON.stringify({
      type: "content_block_start",
      index: 0,
      content_block: {
        type: "text",
        text: ""
      }
    })}\n\n`
  );

  let outputChars = 0;
  for await (const text of options.stream) {
    outputChars += text.length;
    options.reply.raw.write(
      `event: content_block_delta\ndata: ${JSON.stringify({
        type: "content_block_delta",
        index: 0,
        delta: {
          type: "text_delta",
          text
        }
      })}\n\n`
    );
  }

  options.reply.raw.write(
    `event: content_block_stop\ndata: ${JSON.stringify({
      type: "content_block_stop",
      index: 0
    })}\n\n`
  );
  options.reply.raw.write(
    `event: message_delta\ndata: ${JSON.stringify({
      type: "message_delta",
      delta: {
        stop_reason: "end_turn"
      },
      usage: {
        output_tokens: 0
      }
    })}\n\n`
  );
  options.reply.raw.write(
    `event: message_stop\ndata: ${JSON.stringify({
      type: "message_stop"
    })}\n\n`
  );
  options.reply.raw.end();
  return { outputChars };
}

/**
 * Bridge OpenAI-shape and Anthropic-shape usage objects into the
 * `prompt/completion/total_tokens` shape consumed by the rest of this route.
 * Returns null when no recognizable usage is present.
 */
function normalizeUsageShape(
  raw: unknown
): { prompt_tokens: number; completion_tokens: number; total_tokens: number; cached_tokens?: number } | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const promptTokens =
    typeof r.prompt_tokens === "number"
      ? r.prompt_tokens
      : typeof r.input_tokens === "number"
        ? r.input_tokens
        : null;
  const completionTokens =
    typeof r.completion_tokens === "number"
      ? r.completion_tokens
      : typeof r.output_tokens === "number"
        ? r.output_tokens
        : null;
  if (promptTokens === null && completionTokens === null) return null;
  const p = promptTokens ?? 0;
  const c = completionTokens ?? 0;
  const total =
    typeof r.total_tokens === "number" ? r.total_tokens : p + c;
  const cached =
    typeof r.cached_tokens === "number"
      ? r.cached_tokens
      : typeof r.cache_read_input_tokens === "number"
        ? r.cache_read_input_tokens
        : undefined;
  return {
    prompt_tokens: p,
    completion_tokens: c,
    total_tokens: total,
    ...(cached !== undefined ? { cached_tokens: cached } : {})
  };
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

function compressMessagesToolOutput(
  messages: Array<{ role: "user" | "assistant"; content: string | Array<Record<string, unknown>> }>
): Array<{ role: "user" | "assistant"; content: string | Array<Record<string, unknown>> }> {
  return messages.map((msg) => {
    if (typeof msg.content === "string") return msg;
    if (!Array.isArray(msg.content)) return msg;

    const compressed = msg.content.map((block) => {
      if (block.type === "tool_result" && typeof block.content === "string") {
        return { ...block, content: compressToolOutput(block.content) };
      }
      return block;
    });

    return { ...msg, content: compressed };
  });
}
