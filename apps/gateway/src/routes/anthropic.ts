import type { FastifyInstance, FastifyReply } from "fastify";
import type { AppConfig } from "../config.js";
import { NoAvailableAccountError } from "../account-pool/AccountPool.js";
import { CircuitBreakerOpenError } from "../services/CircuitBreaker.js";
import { createAuthMiddleware } from "../middleware/auth.js";
import { createKeyPolicyEnforcer } from "../middleware/enforceKeyPolicy.js";
import { ProviderError } from "../providers/base/ProviderErrors.js";
import { compressToolOutput } from "../services/TokenSaverService.js";
import type {
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
          getModel: (req) => (req.body as { model?: string } | undefined)?.model
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

        const route = app.modelResolver.resolve(body.model, ["chat"], (() => {
          if (!request.auth?.apiKeyHash) return {};
          const keyRecord = app.apiKeyService.findByHash(request.auth.apiKeyHash);
          return {
            keyGroupName: keyRecord?.groupName,
            crossGroupRetry: keyRecord?.crossGroupRetry
          };
        })());
        let lastError: unknown;

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
              const openAIRequest = toOpenAIChatRequest({
                model: candidate.upstreamModel,
                maxTokens: body.max_tokens,
                stream: body.stream,
                temperature: body.temperature,
                system: body.system,
                messages: app.tokenSaverService.getSettings().compressToolOutput
                  ? compressMessagesToolOutput(body.messages)
                  : body.messages
              });
              const response = await adapter.chatCompletions(openAIRequest, {
                providerInstance,
                account: lease.account,
                requestId: request.id,
                credentialPayload,
                reasoningEffort: route.reasoningEffort
              });

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
                  // Record usage for streaming (estimate tokens from chars)
                  const inputChars = JSON.stringify(body.messages).length;
                  const estimatedInputTokens = Math.ceil(inputChars * 0.42);
                  const estimatedOutputTokens = Math.ceil(streamResult.outputChars * 0.4);
                  app.usageService.record({
                    requestId: request.id,
                    protocol: "anthropic",
                    model: body.model,
                    providerType: candidate.providerType,
                    providerInstanceId: candidate.providerInstanceId,
                    accountId: lease.account.id,
                    apiKeyHash: request.auth?.apiKeyHash,
                    promptTokens: estimatedInputTokens,
                    completionTokens: estimatedOutputTokens,
                    totalTokens: estimatedInputTokens + estimatedOutputTokens,
                    estimatedCost: app.modelPricingService.calculateCost(
                      body.model,
                      estimatedInputTokens,
                      estimatedOutputTokens,
                      0
                    ).totalCost || undefined
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
              if (response.usage) {
                const cachedTokens = response.usage.cached_tokens ?? 0;
                app.usageService.record({
                  requestId: request.id,
                  protocol: "anthropic",
                  model: body.model,
                  providerType: candidate.providerType,
                  providerInstanceId: candidate.providerInstanceId,
                  accountId: lease.account.id,
                  apiKeyHash: request.auth?.apiKeyHash,
                  promptTokens: response.usage.prompt_tokens,
                  completionTokens: response.usage.completion_tokens,
                  totalTokens: response.usage.total_tokens,
                  cachedTokens: cachedTokens || undefined,
                  estimatedCost: app.modelPricingService.calculateCost(
                    body.model,
                    response.usage.prompt_tokens,
                    response.usage.completion_tokens,
                    cachedTokens
                  ).totalCost || undefined
                });
                if (request.auth?.apiKeyHash) {
                  app.rateLimitService.consumeTokens(
                    request.auth.apiKeyHash,
                    response.usage.total_tokens
                  );
                }
              }
              return toAnthropicResponse(response, body.model);
            } catch (error) {
              if (!(error instanceof NoAvailableAccountError && lastError)) {
                lastError = error;
              }
              releaseProvider?.();

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
      credentialPayload
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

  // Fallback: convert to OpenAI format and use chatCompletions
  const openAIRequest = toOpenAIChatRequest({
    model: body.model,
    maxTokens: body.max_tokens,
    stream: body.stream,
    temperature: body.temperature,
    system: body.system,
    messages: body.messages
  });

  const response = await adapter.chatCompletions(openAIRequest, {
    providerInstance,
    account,
    requestId: request.id,
    credentialPayload
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
}): OpenAIChatCompletionRequest {
  return {
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
}

function toAnthropicResponse(
  response: NormalizedOpenAIResponse,
  requestedModel: string
): NormalizedAnthropicResponse {
  const firstChoice = response.choices[0];
  return {
    id: response.id.replace(/^chatcmpl/, "msg"),
    type: "message",
    role: "assistant",
    model: requestedModel,
    content: [
      {
        type: "text",
        text: firstChoice?.message.content ?? ""
      }
    ],
    stop_reason: firstChoice?.finish_reason === "length" ? "max_tokens" : "end_turn",
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
