import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { AppConfig } from "../config.js";
import { createAuthMiddleware } from "../middleware/auth.js";
import { createKeyPolicyEnforcer } from "../middleware/enforceKeyPolicy.js";
import { isProviderStream, writeOpenAIStream } from "../utils/sse.js";
import { openAIChatCompletionRequestSchema } from "../validation/openaiSchemas.js";
import type { ProviderProtocol } from "../providers/base/ProviderCapabilities.js";
import { buildCacheKey, resolveCacheMode } from "../services/ResponseCacheService.js";
import type { NormalizedOpenAIResponse } from "../providers/base/types.js";
import { RequestPipeline } from "./pipeline/RequestPipeline.js";
import { OpenAIProtocolHandler } from "./pipeline/OpenAIProtocolHandler.js";

export async function registerOpenAIRoutes(
  app: FastifyInstance,
  config: AppConfig
): Promise<void> {
  const pipeline = new RequestPipeline(app);

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
      const body = openAIChatCompletionRequestSchema.parse(request.body);

      // Direct account routing: when x-provider-account-id header is present,
      // route directly to the specified account's adapter.
      const directAccountId = request.headers["x-provider-account-id"];
      if (typeof directAccountId === "string" && directAccountId.length > 0) {
        return handleDirectAccountRouting(app, request, reply, body, directAccountId, "openai_chat_completions");
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
          // The held spend reservation is released by the global onResponse hook.
          return cached;
        }
      }
      if (cacheMode !== "skip") {
        reply.header("x-gateway-cache", cacheMode === "refresh" ? "refresh" : "miss");
      }

      // Apply Token Saver compression to messages.
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

      const handler = new OpenAIProtocolHandler(app, body, processedBody, {
        key: cacheKey,
        mode: cacheMode,
        ttl: (body as { cache_control?: { ttl?: number } }).cache_control?.ttl
      });

      return pipeline.handle(request, reply, handler, candidates, route.reasoningEffort);
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
