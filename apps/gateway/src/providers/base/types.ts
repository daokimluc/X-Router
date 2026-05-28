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
  content: string | Array<Record<string, unknown>>;
  name?: string;
};

export type OpenAIChatCompletionRequest = {
  model: string;
  messages: OpenAIChatMessage[];
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
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
};

export type NormalizedAnthropicResponse = {
  id: string;
  type: "message";
  role: "assistant";
  model: string;
  content: Array<{
    type: "text";
    text: string;
  }>;
  stop_reason?: "end_turn" | "max_tokens" | "stop_sequence" | null;
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
 * AsyncIterable<string> for streaming text deltas. Optionally exposes a
 * `usage` getter that returns provider-reported token counts AFTER the stream
 * has been fully consumed. Adapters that emit a usage event populate this;
 * routes prefer it over char-based estimation.
 */
export type ProviderStream = AsyncIterable<string> & {
  usage?: () => StreamUsage | undefined;
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
