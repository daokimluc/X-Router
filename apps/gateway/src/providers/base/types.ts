import type { ProviderAccount } from "./ProviderAccount.js";
import type { ProviderInstance } from "./ProviderInstance.js";
import type { ProxyFetchOptions } from "../../proxy/types.js";

import type { ReasoningEffort } from "../../router/ModelResolver.js";

export type ProviderModel = {
  id: string;
  displayName?: string;
  upstreamModel: string;
  capabilities?: string[];
};

export type ProviderContext = {
  providerInstance: ProviderInstance;
  credentialPayload?: Record<string, unknown>;
};

export type ProviderRequestContext = ProviderContext & {
  account?: ProviderAccount;
  requestId: string;
  credentialPayload?: Record<string, unknown>;
  /** Reasoning effort level extracted from model name suffix */
  reasoningEffort?: ReasoningEffort;
  /** Per-account proxy resolved by route (Phase 24+ feature). */
  proxyOptions?: ProxyFetchOptions;
};

export type OpenAIChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  // Assistant tool-call turns carry `content: null` (and some clients omit it
  // entirely) per the OpenAI spec.
  content?: string | Array<Record<string, unknown>> | null;
  name?: string;
  tool_calls?: Array<Record<string, unknown>>;
  tool_call_id?: string;
};

export type OpenAIChatCompletionRequest = {
  model: string;
  messages: OpenAIChatMessage[];
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
  tools?: Array<Record<string, unknown>>;
  tool_choice?: string | Record<string, unknown>;
};

export type OpenAIToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

export type NormalizedOpenAIResponse = {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: "assistant";
      content: string;
      tool_calls?: OpenAIToolCall[];
    };
    finish_reason: "stop" | "length" | "tool_calls" | "content_filter" | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    /** Tokens served from provider cache (Anthropic cache_read_input_tokens, OpenAI cached_tokens) */
    cached_tokens?: number;
  };
};

export type AnthropicMessagesRequest = {
  model: string;
  max_tokens: number;
  messages: Array<{
    role: "user" | "assistant";
    content: string | Array<Record<string, unknown>>;
  }>;
  system?: string | Array<Record<string, unknown>>;
  stream?: boolean;
  temperature?: number;
  tools?: Array<Record<string, unknown>>;
  tool_choice?: Record<string, unknown>;
};

/** Discriminated content block for Anthropic responses. */
export type AnthropicContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> };

export type NormalizedAnthropicResponse = {
  id: string;
  type: "message";
  role: "assistant";
  model: string;
  content: AnthropicContentBlock[];
  stop_reason?: "end_turn" | "max_tokens" | "stop_sequence" | "tool_use" | null;
  usage?: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
};

export type StreamUsage = {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  cached_tokens?: number;
};

/**
 * Structured stream event for adapters that need to emit non-text content
 * (e.g. tool_use). Routes prefer `events()` when present and fall back to the
 * text-only AsyncIterable for adapters that only stream text deltas.
 */
export type ProviderStreamEvent =
  | { type: "text_delta"; text: string }
  | { type: "tool_use_start"; id: string; name: string }
  | { type: "tool_use_delta"; id: string; partial_json: string }
  | { type: "tool_use_stop"; id: string }
  | { type: "message_stop"; stop_reason: "end_turn" | "max_tokens" | "stop_sequence" | "tool_use" };

/**
 * AsyncIterable<string> for streaming text deltas. Optionally exposes a
 * `usage` getter that returns provider-reported token counts AFTER the stream
 * has been fully consumed. Adapters that emit a usage event populate this;
 * routes prefer it over char-based estimation.
 *
 * Adapters that need to stream non-text events (tool_use) may also expose
 * `events()` returning an AsyncIterable<ProviderStreamEvent>. Routes that
 * understand structured events prefer `events()` over the string iterator.
 * The two iterators are mutually exclusive: an adapter exposes one or the
 * other, never both at runtime (consuming both would race on the same source).
 */
export type ProviderStream = AsyncIterable<string> & {
  usage?: () => StreamUsage | undefined;
  events?: () => AsyncIterable<ProviderStreamEvent>;
};

export type ProviderHealth = {
  status: "ok" | "degraded" | "down";
  message?: string;
};

export type SessionRefreshResult = {
  refreshed: boolean;
  disabled?: boolean;
  message?: string;
  authError?: boolean;
  credentialPayload?: Record<string, unknown>;
  expiresAt?: Date;
};
