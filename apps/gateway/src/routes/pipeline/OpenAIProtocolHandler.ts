import type { FastifyInstance, FastifyReply } from "fastify";
import { writeOpenAIStream } from "../../utils/sse.js";
import type { AIProviderAdapter } from "../../providers/base/AIProviderAdapter.js";
import type {
  NormalizedOpenAIResponse,
  OpenAIChatCompletionRequest,
  ProviderStream
} from "../../providers/base/types.js";
import type {
  AdapterCallContext,
  DecodedResponse,
  PipelineUsage,
  ProtocolHandler
} from "./ProtocolHandler.js";

type OpenAIBody = OpenAIChatCompletionRequest & Record<string, unknown>;

/**
 * Protocol encode/decode for `/v1/chat/completions`. Holds the parsed body, the
 * token-saver-processed messages, and the cache plan. The shared pipeline drives
 * the lifecycle and calls these hooks.
 */
export class OpenAIProtocolHandler implements ProtocolHandler {
  readonly protocol = "openai" as const;
  readonly model: string;

  constructor(
    private readonly app: FastifyInstance,
    private readonly body: OpenAIBody,
    private readonly processedBody: OpenAIBody,
    private readonly cache: { key: string | null; mode: "use" | "skip" | "refresh"; ttl?: number }
  ) {
    this.model = body.model;
  }

  async invoke(
    adapter: AIProviderAdapter,
    upstreamModel: string,
    ctx: AdapterCallContext
  ): Promise<unknown | ProviderStream> {
    return adapter.chatCompletions(
      { ...this.processedBody, model: upstreamModel },
      ctx
    );
  }

  async writeStream(
    reply: FastifyReply,
    stream: ProviderStream,
    requestId: string
  ): Promise<PipelineUsage> {
    const outputChars = await writeOpenAIStream({
      reply,
      stream,
      model: this.model,
      requestId
    });
    const reported = stream.usage?.();
    if (reported) {
      return {
        promptTokens: reported.prompt_tokens,
        completionTokens: reported.completion_tokens,
        cachedTokens: reported.cached_tokens
      };
    }
    // Estimation fallback so usage is always recorded + settled.
    const inputChars = (this.processedBody.messages ?? []).reduce((sum, m) => {
      const content = typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? "");
      return sum + content.length;
    }, 0);
    return {
      promptTokens: Math.ceil(inputChars / 4),
      completionTokens: Math.ceil(outputChars / 4)
    };
  }

  decode(response: unknown): DecodedResponse {
    const resp = response as NormalizedOpenAIResponse;
    const realUsage = resp.usage;
    let promptTokens = realUsage?.prompt_tokens ?? 0;
    let completionTokens = realUsage?.completion_tokens ?? 0;

    if (promptTokens === 0 && this.processedBody.messages) {
      const inputChars = this.processedBody.messages.reduce((sum, m) => {
        const content = typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? "");
        return sum + content.length;
      }, 0);
      promptTokens = Math.ceil(inputChars / 4);
    }
    if (completionTokens === 0 && resp.choices?.[0]?.message?.content) {
      completionTokens = Math.ceil(resp.choices[0].message.content.length / 4);
    }

    // Cacheable unless it carries tool_calls (those depend on conversation state).
    const respMessage = resp.choices?.[0]?.message as Record<string, unknown> | undefined;
    const hasToolCalls = Array.isArray(respMessage?.tool_calls) && (respMessage!.tool_calls as unknown[]).length > 0;

    return {
      body: { ...resp, model: this.model },
      usage: { promptTokens, completionTokens, cachedTokens: realUsage?.cached_tokens },
      cacheable: this.cache.key !== null && this.cache.mode !== "skip" && !hasToolCalls
    };
  }

  writeCache(response: unknown): void {
    if (!this.cache.key) return;
    this.app.responseCacheService.write(this.cache.key, response, this.model, this.cache.ttl);
  }
}
