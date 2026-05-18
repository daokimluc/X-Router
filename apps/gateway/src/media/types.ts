/**
 * Media Provider Type Definitions
 *
 * Types for non-LLM AI services: embeddings, image generation, image-to-text,
 * TTS, STT, web search, and web fetch.
 */

// --- Core Media Types ---

export type MediaKind =
  | "embedding"
  | "image"
  | "imageToText"
  | "tts"
  | "stt"
  | "webSearch"
  | "webFetch";

export type MediaAuthType = "apikey" | "bearer" | "none" | "custom";

export type MediaModelConfig = {
  id: string;
  displayName?: string;
  isDefault?: boolean;
};

export type MediaServiceConfig = {
  baseUrl: string;
  authType: MediaAuthType;
  authHeader?: string;
  format?: string;
  models: MediaModelConfig[];
};

// Extension to ProviderInstance
export type MediaProviderExtension = {
  serviceKinds?: MediaKind[];
  mediaConfig?: Partial<Record<MediaKind, MediaServiceConfig>>;
};

// --- Embedding Types ---

export type EmbeddingRequest = {
  model?: string;
  input: string | string[];
  dimensions?: number;
  encoding_format?: "float" | "base64";
};

export type EmbeddingResponse = {
  object: "list";
  data: Array<{
    object: "embedding";
    index: number;
    embedding: number[];
  }>;
  model: string;
  usage: {
    prompt_tokens: number;
    total_tokens: number;
  };
};

// --- Image Generation Types ---

export type ImageGenerationRequest = {
  model?: string;
  prompt: string;
  n?: number;
  size?: string;
  quality?: string;
  response_format?: "url" | "b64_json";
};

export type ImageGenerationResponse = {
  created: number;
  data: Array<{
    url?: string;
    b64_json?: string;
    revised_prompt?: string;
  }>;
};

// --- TTS Types ---

export type TTSRequest = {
  model?: string;
  input: string;
  voice: string;
  response_format?: string;
  speed?: number;
};

// --- STT Types ---

export type STTRequest = {
  model?: string;
  file: Buffer;
  language?: string;
  response_format?: string;
};

export type STTResponse = {
  text: string;
};

// --- Web Search Types ---

export type WebSearchRequest = {
  query: string;
  model?: string;
  max_results?: number;
  search_type?: string;
  country?: string;
  language?: string;
  time_range?: string;
  domain_filter?: string[];
};

export type WebSearchResponse = {
  results: Array<{
    title: string;
    url: string;
    snippet: string;
  }>;
  query: string;
  provider: string;
  usage: {
    queries_used: number;
    search_cost_usd?: number;
  };
  metrics: {
    response_time_ms: number;
  };
};

// --- Web Fetch Types ---

export type WebFetchRequest = {
  url: string;
  format?: "text" | "markdown" | "html";
  maxCharacters?: number;
  provider?: string;
};

export type WebFetchResponse = {
  provider: string;
  url: string;
  title?: string;
  content: {
    format: string;
    text: string;
    length: number;
  };
  metadata?: Record<string, unknown>;
  usage: {
    fetch_cost_usd?: number;
  };
  metrics: {
    response_time_ms: number;
    upstream_latency_ms?: number;
  };
};
