import type { FastifyInstance, FastifyReply } from "fastify";
import type { AppConfig } from "../config.js";
import { NoAvailableAccountError } from "../account-pool/AccountPool.js";
import { CircuitBreakerOpenError } from "../services/CircuitBreaker.js";
import { createAuthMiddleware } from "../middleware/auth.js";
import { ProviderError } from "../providers/base/ProviderErrors.js";
import type {
  NormalizedAnthropicResponse,
  NormalizedOpenAIResponse,
  OpenAIChatCompletionRequest,
  ProviderStream
} from "../providers/base/types.js";
import { isProviderStream } from "../utils/sse.js";
import { anthropicMessagesRequestSchema } from "../validation/openaiSchemas.js";

export async function registerAnthropicRoutes(
  app: FastifyInstance,
  config: AppConfig
): Promise<void> {
  app.post(
    "/v1/messages",
    {
      preHandler: createAuthMiddleware(
        config,
        app.apiKeyService,
        app.rateLimitService
      )
    },
    async (request, reply) => {
      const releaseGlobal = app.concurrencyLimiter.acquireGlobal();

      try {
        const body = anthropicMessagesRequestSchema.parse(request.body);
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
                messages: body.messages
              });
              const response = await adapter.chatCompletions(openAIRequest, {
                providerInstance,
                account: lease.account,
                requestId: request.id,
                credentialPayload
              });

              if (isProviderStream(response)) {
                try {
                  await writeAnthropicStream({
                    reply,
                    stream: response,
                    model: body.model,
                    requestId: request.id
                  });
                  lease.releaseSuccess();
                  app.circuitBreaker.recordSuccess(providerInstance.id);
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
                  totalTokens: response.usage.total_tokens
                });
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
}): Promise<void> {
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

  for await (const text of options.stream) {
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
