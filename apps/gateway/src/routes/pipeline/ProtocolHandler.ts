import type { FastifyReply } from "fastify";
import type { ProviderStream } from "../../providers/base/types.js";
import type { ProviderInstance } from "../../providers/base/ProviderInstance.js";
import type { ProviderAccount } from "../../providers/base/ProviderAccount.js";
import type { AIProviderAdapter } from "../../providers/base/AIProviderAdapter.js";
import type { ReasoningEffort } from "../../router/ModelResolver.js";
import type { ProxyFetchOptions } from "../../proxy/types.js";

/**
 * Token usage a protocol handler reports for a completed request. Handlers MUST
 * always return concrete numbers — estimating from content when the upstream
 * provider reports no usage — so the pipeline can always record + settle (no
 * free request, no permanently-held reservation). This is the single rule that
 * structurally closes the F4 (success-without-usage) divergence.
 */
export type PipelineUsage = {
  promptTokens: number;
  completionTokens: number;
  /** Provider-cache read tokens (subset of promptTokens). Optional. */
  cachedTokens?: number;
};

/** The per-attempt adapter call context, identical across protocols. */
export type AdapterCallContext = {
  providerInstance: ProviderInstance;
  account: ProviderAccount;
  requestId: string;
  credentialPayload: Record<string, unknown>;
  reasoningEffort?: ReasoningEffort;
  proxyOptions?: ProxyFetchOptions;
};

/** Outcome of decoding a non-streaming provider response. */
export type DecodedResponse = {
  /** The body to return to the client (already in the client's protocol shape). */
  body: unknown;
  usage: PipelineUsage;
  /** Whether this response is eligible to be written to the semantic cache. */
  cacheable: boolean;
};

/**
 * Protocol-specific encode/decode for one in-flight request. A fresh instance
 * is created per request (it closes over the parsed body, cache plan, and api
 * key hash). The shared {@link RequestPipeline} owns the entire lifecycle and
 * calls these hooks for the parts that genuinely differ between OpenAI and
 * Anthropic wire formats.
 */
export interface ProtocolHandler {
  readonly protocol: "openai" | "anthropic";
  /** The public model the client requested (for routing + usage records). */
  readonly model: string;

  /**
   * Build the upstream request for `upstreamModel` and invoke the adapter
   * (`chatCompletions` vs native `messages`). Returns a normalized response or
   * a ProviderStream.
   */
  invoke(
    adapter: AIProviderAdapter,
    upstreamModel: string,
    ctx: AdapterCallContext
  ): Promise<unknown | ProviderStream>;

  /**
   * Write a streaming response to the reply and return the usage produced
   * (estimating from streamed content when the adapter reports none).
   */
  writeStream(
    reply: FastifyReply,
    stream: ProviderStream,
    requestId: string
  ): Promise<PipelineUsage>;

  /** Decode a non-streaming response into the client body + usage + cacheability. */
  decode(response: unknown): DecodedResponse;

  /** Persist a successful non-stream response to the semantic cache (guarded). */
  writeCache(response: unknown): void;
}
