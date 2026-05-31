import type { FastifyInstance } from "fastify";
import type { AppConfig } from "../config.js";
import { createAuthMiddleware } from "../middleware/auth.js";
import { createKeyPolicyEnforcer } from "../middleware/enforceKeyPolicy.js";
import { resolveAccountProxyOptions } from "../proxy/resolveAccountProxy.js";
import { buildCacheKey, resolveCacheMode } from "../services/ResponseCacheService.js";
import { anthropicMessagesRequestSchema } from "../validation/openaiSchemas.js";
import type { ProviderProtocol } from "../providers/base/ProviderCapabilities.js";
import { RequestPipeline } from "./pipeline/RequestPipeline.js";
import {
  AnthropicProtocolHandler,
  isProviderStream,
  toAnthropicResponse,
  toOpenAIChatRequest,
  writeAnthropicStream
} from "./pipeline/AnthropicProtocolHandler.js";

export async function registerAnthropicRoutes(
  app: FastifyInstance,
  config: AppConfig
): Promise<void> {
  const pipeline = new RequestPipeline(app);

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
      const body = anthropicMessagesRequestSchema.parse(request.body);

      // Direct account routing: when x-provider-account-id header is present,
      // route directly to the specified account's adapter.
      const directAccountId = request.headers["x-provider-account-id"];
      if (typeof directAccountId === "string" && directAccountId.length > 0) {
        return handleDirectAnthropicRouting(app, request, reply, body, directAccountId);
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
          // The held spend reservation is released by the global onResponse hook.
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

      // lowest-cost-routing-wiring — reorder pooled candidates cheapest-seller-first.
      const candidates = app.marketplaceSeam.rankCandidates(body.model, route.candidates);

      // Phase 20c — group routing may filter out all candidates; return 404. The
      // held spend reservation is released by the global onResponse hook.
      if (candidates.length === 0) {
        await reply.code(404).send({
          error: {
            type: "not_found",
            message: `No provider in your group can serve model "${body.model}"`,
            code: "no_provider_in_group"
          }
        });
        return reply;
      }

      const handler = new AnthropicProtocolHandler(app, body, {
        key: cacheKey,
        mode: cacheMode,
        ttl: cacheControl?.ttl
      });

      return pipeline.handle(request, reply, handler, candidates, route.reasoningEffort);
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

  const definition = app.providerRegistry.getDefinition(account.providerType);

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

  const adapter = app.providerRegistry.getAdapter(account.providerType);

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

  const secret = app.secretService.getSecretForAccount(account.id);
  const credentialPayload = secret
    ? app.secretService.decryptSecretPayload(secret)
    : {};

  if (adapter.messages) {
    const response = await adapter.messages(body, {
      providerInstance,
      account,
      requestId: request.id,
      credentialPayload,
      proxyOptions: resolveAccountProxyOptions(account, app.proxyPoolService)
    });

    if (isProviderStream(response)) {
      await writeAnthropicStream({ reply, stream: response, model: body.model, requestId: request.id });
      return reply;
    }
    return response;
  }

  // Fallback: convert to OpenAI format and use chatCompletions.
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
    await writeAnthropicStream({ reply, stream: response, model: body.model, requestId: request.id });
    return reply;
  }

  return toAnthropicResponse(response, body.model);
}
