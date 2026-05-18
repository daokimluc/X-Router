/**
 * Provider catalog — hardcoded list of media-capable AI providers.
 * Ported from 9router (src/shared/constants/providers.js).
 *
 * Only providers with at least one non-LLM serviceKind are included
 * (embedding, image, imageToText, tts, stt, webSearch, webFetch).
 */

export type ServiceKind =
  | "llm"
  | "embedding"
  | "image"
  | "imageToText"
  | "tts"
  | "stt"
  | "webSearch"
  | "webFetch";

/**
 * Configuration describing how to talk to an upstream embedding provider.
 * Mirrors the shape used by the gateway's MediaServiceConfig so the catalog
 * entry can be pushed straight to the backend via PATCH
 * /admin/v1/provider-instances/:id/media.
 */
export type EmbeddingProviderConfig = {
  baseUrl: string;
  authType: "apikey" | "bearer" | "none" | "custom";
  /** e.g. "bearer", "key", "x-api-key" — used to derive the auth header. */
  authHeader?: string;
  /** Dispatch hint for the backend handler ("openai" | "gemini"). */
  format?: string;
  models: Array<{ id: string; name: string; dimensions?: number }>;
};

/**
 * Configuration describing how to talk to an upstream image generation provider.
 * Mirrors the shape used by the gateway's MediaServiceConfig so the catalog
 * entry can be pushed straight to the backend via PATCH
 * /admin/v1/provider-instances/:id/media.
 *
 * `format` selects the dispatch branch in the backend's ImageGenerationHandler.
 * Valid values: "openai" | "gemini" | "cloudflare" | "sdwebui" | "comfyui"
 *   | "falai" | "stability" | "bfl" | "runway" | "huggingface" | "nanobanana"
 *   | "codex".
 */
export type ImageProviderConfig = {
  baseUrl: string;
  authType: "apikey" | "bearer" | "none" | "custom";
  authHeader?: string;
  format?: string;
  models: Array<{ id: string; name: string }>;
  /** Provider-specific data fields the user must supply (e.g. Cloudflare account_id). */
  extraFields?: Array<{ key: string; label: string; required?: boolean; placeholder?: string }>;
};

/**
 * Configuration describing how to talk to an upstream TTS provider.
 *
 * `format` selects the dispatch branch in the backend's TTSHandler. Valid
 * values: "openai" | "gemini-tts" | "elevenlabs" | "deepgram" | "minimax-tts"
 *   | "edge-tts" | "google-tts" | "local-device" | "openrouter" | "nvidia-tts"
 *   | "hyperbolic" | "huggingface-tts" | "inworld" | "aws-polly" | "cartesia"
 *   | "playht" | "coqui" | "tortoise".
 */
export type TTSProviderConfig = {
  baseUrl: string;
  authType: "apikey" | "bearer" | "none" | "custom";
  authHeader?: string;
  format?: string;
  models: Array<{ id: string; name: string }>;
};

/**
 * Configuration describing how to talk to an upstream STT provider.
 *
 * `format` selects the dispatch branch in the backend's STTHandler. Valid
 * values: "openai" | "deepgram" | "groq" | "gemini-stt" | "assemblyai"
 *   | "huggingface-asr" | "nvidia-asr".
 */
export type STTProviderConfig = {
  baseUrl: string;
  authType: "apikey" | "bearer" | "none" | "custom";
  authHeader?: string;
  format?: string;
  models: Array<{ id: string; name: string }>;
  /** AssemblyAI uses async upload + poll. */
  async?: boolean;
};

/**
 * Configuration describing how to talk to an upstream Web Search provider.
 *
 * `format` selects the dispatch branch in the backend's WebSearchHandler.
 * Valid values: "perplexity" | "tavily" | "brave" | "serper" | "exa"
 *   | "searxng" | "google-pse" | "linkup" | "searchapi" | "youcom" | "chat".
 */
export type WebSearchProviderConfig = {
  baseUrl: string;
  method?: "GET" | "POST";
  authType: "apikey" | "bearer" | "none" | "custom";
  authHeader?: string;
  format?: string;
  searchTypes?: string[];
  defaultMaxResults?: number;
  maxMaxResults?: number;
  /** When set, this provider uses an LLM chat endpoint with grounding. */
  searchViaChat?: { defaultModel: string };
};

/**
 * Configuration describing how to talk to an upstream Web Fetch provider.
 *
 * `format` selects the dispatch branch in the backend's WebFetchHandler.
 * Valid values: "tavily" | "exa" | "firecrawl" | "jina".
 */
export type WebFetchProviderConfig = {
  baseUrl: string;
  method?: "GET" | "POST";
  authType: "apikey" | "bearer" | "none" | "custom";
  authHeader?: string;
  format?: string;
  formats?: string[];
  maxCharacters?: number;
};

export type CatalogProvider = {
  id: string;
  alias: string;
  name: string;
  color?: string;
  textIcon?: string;
  hidden?: boolean;
  hiddenKinds?: ServiceKind[];
  noAuth?: boolean;
  deprecated?: boolean;
  website?: string;
  /**
   * URL where users can obtain an API key (or sign up). Surfaced as a
   * "Get API Key" link button on the provider detail page header.
   */
  apiKeyUrl?: string;
  serviceKinds?: ServiceKind[];
  mediaPriority?: number;
  /**
   * Built-in embedding configuration for providers that expose an
   * embedding service. When present, the dashboard auto-applies this to
   * the backend's mediaConfig on connection creation.
   */
  embeddingConfig?: EmbeddingProviderConfig;
  /**
   * Built-in image generation configuration. When present, the dashboard
   * auto-applies this to the backend's mediaConfig on connection creation.
   */
  imageConfig?: ImageProviderConfig;
  /**
   * Built-in TTS configuration. When present, the dashboard auto-applies
   * this to the backend's mediaConfig on connection creation.
   */
  ttsConfig?: TTSProviderConfig;
  /**
   * Built-in STT configuration. When present, the dashboard auto-applies
   * this to the backend's mediaConfig on connection creation.
   */
  sttConfig?: STTProviderConfig;
  /**
   * Built-in Web Search configuration. When present, the dashboard
   * auto-applies this to the backend's mediaConfig on connection creation.
   */
  searchConfig?: WebSearchProviderConfig;
  /**
   * Built-in Web Fetch configuration. When present, the dashboard
   * auto-applies this to the backend's mediaConfig on connection creation.
   */
  fetchConfig?: WebFetchProviderConfig;
  /**
   * Search-via-chat: when set, the provider can be used as a search
   * source by routing through its chat-completions endpoint with built-in
   * grounding tools. Used by gemini, openai, kimi, minimax, xai, perplexity.
   */
  searchViaChat?: { defaultModel: string };
};

export const AI_PROVIDERS: Record<string, CatalogProvider> = {
  // ─── Free tier (kept in original order) ───────────────────────────────
  qwen: {
    id: "qwen",
    alias: "qw",
    name: "Qwen Code",
    color: "#10B981",
    mediaPriority: 999,
    hidden: true,
    deprecated: true,
    website: "https://chat.qwen.ai",
    serviceKinds: ["llm", "tts"],
    ttsConfig: {
      baseUrl: "http://localhost:8000/v1/audio/speech",
      authType: "none",
      authHeader: "none",
      format: "openai",
      models: [{ id: "qwen3-tts", name: "Qwen3 TTS" }],
    },
  },

  // ─── Free tier providers with media kinds ─────────────────────────────
  openrouter: {
    id: "openrouter",
    alias: "openrouter",
    name: "OpenRouter",
    color: "#F97316",
    textIcon: "OR",
    website: "https://openrouter.ai",
    apiKeyUrl: "https://openrouter.ai/settings/keys",
    serviceKinds: ["llm", "embedding", "tts", "imageToText"],
    embeddingConfig: {
      baseUrl: "https://openrouter.ai/api/v1/embeddings",
      authType: "apikey",
      authHeader: "bearer",
      format: "openai",
      models: [
        { id: "openai/text-embedding-3-small", name: "Text Embedding 3 Small (OpenRouter)", dimensions: 1536 },
        { id: "openai/text-embedding-3-large", name: "Text Embedding 3 Large (OpenRouter)", dimensions: 3072 },
        { id: "openai/text-embedding-ada-002", name: "Text Embedding Ada 002 (OpenRouter)", dimensions: 1536 },
      ],
    },
    ttsConfig: {
      // OpenRouter TTS streams audio chunks via chat completions with the
      // audio modality enabled. The handler returns a not-implemented error
      // because the chunked SSE assembly is not yet wired up server-side.
      baseUrl: "https://openrouter.ai/api/v1/chat/completions",
      authType: "apikey",
      authHeader: "bearer",
      format: "openrouter",
      models: [
        { id: "openai/gpt-4o-mini-tts", name: "OpenAI gpt-4o-mini-tts (OpenRouter)" },
        { id: "openai/tts-1", name: "OpenAI tts-1 (OpenRouter)" },
        { id: "openai/tts-1-hd", name: "OpenAI tts-1-hd (OpenRouter)" },
      ],
    },
  },
  nvidia: {
    id: "nvidia",
    alias: "nvidia",
    name: "NVIDIA NIM",
    color: "#76B900",
    textIcon: "NV",
    website: "https://developer.nvidia.com/nim",
    apiKeyUrl: "https://build.nvidia.com/settings/api-keys",
    serviceKinds: ["llm", "tts", "embedding"],
    embeddingConfig: {
      baseUrl: "https://integrate.api.nvidia.com/v1/embeddings",
      authType: "apikey",
      authHeader: "bearer",
      format: "openai",
      models: [
        { id: "nvidia/nv-embedqa-e5-v5", name: "NV EmbedQA E5 v5", dimensions: 1024 },
      ],
    },
    ttsConfig: {
      baseUrl: "https://integrate.api.nvidia.com/v1/audio/speech",
      authType: "apikey",
      authHeader: "bearer",
      format: "nvidia-tts",
      models: [
        { id: "fastpitch", name: "FastPitch" },
        { id: "tacotron2", name: "Tacotron2" },
      ],
    },
  },
  gemini: {
    id: "gemini",
    alias: "gemini",
    name: "Gemini",
    color: "#4285F4",
    textIcon: "GE",
    mediaPriority: 1,
    website: "https://ai.google.dev",
    apiKeyUrl: "https://aistudio.google.com/app/apikey",
    serviceKinds: ["llm", "embedding", "image", "imageToText", "webSearch", "tts", "stt"],
    embeddingConfig: {
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      authType: "apikey",
      authHeader: "key",
      format: "gemini",
      models: [
        { id: "text-embedding-004", name: "Text Embedding 004", dimensions: 768 },
        { id: "embedding-001", name: "Embedding 001", dimensions: 768 },
      ],
    },
    imageConfig: {
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      authType: "apikey",
      authHeader: "key",
      format: "gemini",
      models: [
        { id: "gemini-3.1-flash-image-preview", name: "Gemini 3.1 Flash Image" },
        { id: "gemini-3-pro-image-preview", name: "Gemini 3 Pro Image" },
        { id: "gemini-2.5-flash-image", name: "Gemini 2.5 Flash Image" },
        { id: "imagen-3.0-generate-002", name: "Imagen 3" },
      ],
    },
    ttsConfig: {
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/models",
      authType: "apikey",
      authHeader: "key",
      format: "gemini-tts",
      models: [
        { id: "gemini-2.5-flash-preview-tts", name: "Gemini 2.5 Flash TTS" },
        { id: "gemini-2.5-pro-preview-tts", name: "Gemini 2.5 Pro TTS" },
      ],
    },
    sttConfig: {
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/models",
      authType: "apikey",
      authHeader: "key",
      format: "gemini-stt",
      models: [
        { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro (Best)" },
        { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash" },
        { id: "gemini-2.5-flash-lite", name: "Gemini 2.5 Flash Lite (Cheapest)" },
        { id: "gemini-2.0-flash", name: "Gemini 2.0 Flash" },
      ],
    },
    searchViaChat: { defaultModel: "gemini-2.5-flash" },
  },
  "cloudflare-ai": {
    id: "cloudflare-ai",
    alias: "cf",
    name: "Cloudflare",
    color: "#F38020",
    textIcon: "CF",
    website: "https://developers.cloudflare.com/workers-ai/",
    apiKeyUrl: "https://dash.cloudflare.com/profile/api-tokens",
    serviceKinds: ["llm", "image"],
    imageConfig: {
      // baseUrl is the API root — the per-account path
      // /accounts/{accountId}/ai/run is appended at request time using the
      // accountId from providerSpecificData.
      baseUrl: "https://api.cloudflare.com/client/v4",
      authType: "bearer",
      authHeader: "bearer",
      format: "cloudflare",
      models: [
        { id: "@cf/black-forest-labs/flux-1-schnell", name: "FLUX.1 Schnell" },
        { id: "@cf/stabilityai/stable-diffusion-xl-base-1.0", name: "SDXL Base 1.0" },
        { id: "@cf/runwayml/stable-diffusion-v1-5-img2img", name: "SD 1.5 (img2img)" },
        { id: "@cf/lykon/dreamshaper-8-lcm", name: "DreamShaper 8 LCM" },
        { id: "@cf/bytedance/stable-diffusion-xl-lightning", name: "SDXL Lightning" },
      ],
      extraFields: [
        {
          key: "accountId",
          label: "Cloudflare Account ID",
          required: true,
          placeholder: "e.g. 1a2b3c4d5e6f7g8h9i0j",
        },
      ],
    },
  },

  // ─── OAuth providers with media kinds ─────────────────────────────────
  codex: {
    id: "codex",
    alias: "cx",
    name: "OpenAI Codex",
    color: "#3B82F6",
    deprecated: true,
    website: "https://chatgpt.com/codex",
    serviceKinds: ["llm", "image"],
    imageConfig: {
      // Codex uses OAuth tokens against the ChatGPT backend Responses API.
      // The handler currently falls through to the OpenAI-compatible flow as
      // a stub; full ChatGPT Plus SSE flow is not yet implemented.
      baseUrl: "https://chatgpt.com/backend-api/codex/responses",
      authType: "bearer",
      authHeader: "bearer",
      format: "codex",
      models: [
        { id: "gpt-5.5-image", name: "GPT 5.5 Image" },
        { id: "gpt-5.4-image", name: "GPT 5.4 Image" },
        { id: "gpt-5.3-image", name: "GPT 5.3 Image" },
        { id: "gpt-5.2-image", name: "GPT 5.2 Image" },
      ],
    },
  },
  github: {
    id: "github",
    alias: "gh",
    name: "GitHub Copilot",
    color: "#333333",
    deprecated: true,
    website: "https://github.com/features/copilot",
    serviceKinds: ["llm", "embedding"],
    embeddingConfig: {
      baseUrl: "https://models.github.ai/inference/embeddings",
      authType: "apikey",
      authHeader: "bearer",
      format: "openai",
      models: [
        { id: "text-embedding-3-small", name: "Text Embedding 3 Small (GitHub)", dimensions: 1536 },
        { id: "text-embedding-3-large", name: "Text Embedding 3 Large (GitHub)", dimensions: 3072 },
      ],
    },
  },

  // ─── API key providers with media kinds ───────────────────────────────
  kimi: {
    id: "kimi",
    alias: "kimi",
    name: "Kimi",
    color: "#1E3A8A",
    textIcon: "KM",
    website: "https://kimi.moonshot.cn",
    apiKeyUrl: "https://platform.moonshot.ai/console/api-keys",
    serviceKinds: ["llm", "webSearch"],
    searchViaChat: { defaultModel: "kimi-k2.5" },
  },
  minimax: {
    id: "minimax",
    alias: "minimax",
    name: "Minimax Coding",
    color: "#7C3AED",
    textIcon: "MM",
    website: "https://www.minimaxi.com",
    apiKeyUrl: "https://platform.minimaxi.com/user-center/basic-information/interface-key",
    serviceKinds: ["llm", "image", "imageToText", "webSearch", "tts"],
    imageConfig: {
      baseUrl: "https://api.minimaxi.com/v1/images/generations",
      authType: "bearer",
      authHeader: "bearer",
      format: "openai",
      models: [
        { id: "image-01", name: "Image-01" },
      ],
    },
    ttsConfig: {
      baseUrl: "https://api.minimax.io/v1/t2a_v2",
      authType: "apikey",
      authHeader: "bearer",
      format: "minimax-tts",
      models: [
        { id: "speech-2.8-hd", name: "Speech 2.8 HD" },
        { id: "speech-2.8-turbo", name: "Speech 2.8 Turbo" },
        { id: "speech-2.6-hd", name: "Speech 2.6 HD" },
        { id: "speech-2.6-turbo", name: "Speech 2.6 Turbo" },
        { id: "speech-02-hd", name: "Speech 02 HD" },
        { id: "speech-02-turbo", name: "Speech 02 Turbo" },
        { id: "speech-01-hd", name: "Speech 01 HD" },
        { id: "speech-01-turbo", name: "Speech 01 Turbo" },
      ],
    },
    searchViaChat: { defaultModel: "MiniMax-M2.7" },
  },
  "minimax-cn": {
    id: "minimax-cn",
    alias: "minimax-cn",
    name: "Minimax (China)",
    color: "#DC2626",
    textIcon: "MC",
    website: "https://www.minimaxi.com",
    apiKeyUrl: "https://platform.minimaxi.com/user-center/basic-information/interface-key",
    serviceKinds: ["llm", "tts"],
    ttsConfig: {
      baseUrl: "https://api.minimaxi.com/v1/t2a_v2",
      authType: "apikey",
      authHeader: "bearer",
      format: "minimax-tts",
      models: [
        { id: "speech-2.8-hd", name: "Speech 2.8 HD" },
        { id: "speech-2.8-turbo", name: "Speech 2.8 Turbo" },
        { id: "speech-2.6-hd", name: "Speech 2.6 HD" },
        { id: "speech-2.6-turbo", name: "Speech 2.6 Turbo" },
        { id: "speech-02-hd", name: "Speech 02 HD" },
        { id: "speech-02-turbo", name: "Speech 02 Turbo" },
        { id: "speech-01-hd", name: "Speech 01 HD" },
        { id: "speech-01-turbo", name: "Speech 01 Turbo" },
      ],
    },
  },
  openai: {
    id: "openai",
    alias: "openai",
    name: "OpenAI",
    color: "#10A37F",
    textIcon: "OA",
    website: "https://platform.openai.com",
    apiKeyUrl: "https://platform.openai.com/api-keys",
    serviceKinds: ["llm", "embedding", "tts", "stt", "image", "imageToText", "webSearch"],
    embeddingConfig: {
      baseUrl: "https://api.openai.com/v1/embeddings",
      authType: "apikey",
      authHeader: "bearer",
      format: "openai",
      models: [
        { id: "text-embedding-3-small", name: "Text Embedding 3 Small", dimensions: 1536 },
        { id: "text-embedding-3-large", name: "Text Embedding 3 Large", dimensions: 3072 },
        { id: "text-embedding-ada-002", name: "Text Embedding Ada 002", dimensions: 1536 },
      ],
    },
    imageConfig: {
      baseUrl: "https://api.openai.com/v1/images/generations",
      authType: "bearer",
      authHeader: "bearer",
      format: "openai",
      models: [
        { id: "gpt-image-1", name: "GPT Image 1" },
        { id: "dall-e-3", name: "DALL·E 3" },
        { id: "dall-e-2", name: "DALL·E 2" },
      ],
    },
    ttsConfig: {
      baseUrl: "https://api.openai.com/v1/audio/speech",
      authType: "apikey",
      authHeader: "bearer",
      format: "openai",
      models: [
        { id: "tts-1", name: "TTS-1" },
        { id: "tts-1-hd", name: "TTS-1 HD" },
        { id: "gpt-4o-mini-tts", name: "GPT-4o Mini TTS" },
      ],
    },
    sttConfig: {
      baseUrl: "https://api.openai.com/v1/audio/transcriptions",
      authType: "apikey",
      authHeader: "bearer",
      format: "openai",
      models: [
        { id: "whisper-1", name: "Whisper 1" },
        { id: "gpt-4o-transcribe", name: "GPT-4o Transcribe" },
        { id: "gpt-4o-mini-transcribe", name: "GPT-4o Mini Transcribe" },
      ],
    },
    searchViaChat: { defaultModel: "gpt-4o-mini" },
  },
  anthropic: {
    id: "anthropic",
    alias: "anthropic",
    name: "Anthropic",
    color: "#D97757",
    textIcon: "AN",
    website: "https://console.anthropic.com",
    apiKeyUrl: "https://console.anthropic.com/settings/keys",
    serviceKinds: ["llm", "imageToText"],
  },
  groq: {
    id: "groq",
    alias: "groq",
    name: "Groq",
    color: "#F55036",
    textIcon: "GQ",
    website: "https://groq.com",
    apiKeyUrl: "https://console.groq.com/keys",
    serviceKinds: ["llm", "imageToText", "stt"],
    sttConfig: {
      // Groq uses an OpenAI-compatible transcription endpoint.
      baseUrl: "https://api.groq.com/openai/v1/audio/transcriptions",
      authType: "apikey",
      authHeader: "bearer",
      format: "openai",
      models: [
        { id: "whisper-large-v3", name: "Whisper Large v3" },
        { id: "whisper-large-v3-turbo", name: "Whisper Large v3 Turbo" },
        { id: "distil-whisper-large-v3-en", name: "Distil Whisper Large v3 EN" },
      ],
    },
  },
  xai: {
    id: "xai",
    alias: "xai",
    name: "xAI (Grok)",
    color: "#1DA1F2",
    textIcon: "XA",
    website: "https://x.ai",
    apiKeyUrl: "https://console.x.ai",
    serviceKinds: ["llm", "imageToText", "webSearch"],
    searchViaChat: { defaultModel: "grok-4.20-reasoning" },
  },
  mistral: {
    id: "mistral",
    alias: "mistral",
    name: "Mistral",
    color: "#FF7000",
    textIcon: "MI",
    website: "https://mistral.ai",
    apiKeyUrl: "https://console.mistral.ai/api-keys",
    serviceKinds: ["llm", "imageToText", "embedding"],
    embeddingConfig: {
      baseUrl: "https://api.mistral.ai/v1/embeddings",
      authType: "apikey",
      authHeader: "bearer",
      format: "openai",
      models: [
        { id: "mistral-embed", name: "Mistral Embed", dimensions: 1024 },
      ],
    },
  },
  perplexity: {
    id: "perplexity",
    alias: "pplx",
    name: "Perplexity",
    color: "#20808D",
    textIcon: "PP",
    website: "https://www.perplexity.ai",
    apiKeyUrl: "https://www.perplexity.ai/settings/api",
    serviceKinds: ["llm", "webSearch"],
    searchConfig: {
      baseUrl: "https://api.perplexity.ai/search",
      method: "POST",
      authType: "apikey",
      authHeader: "bearer",
      format: "perplexity",
      searchTypes: ["web"],
      defaultMaxResults: 5,
      maxMaxResults: 20,
    },
    searchViaChat: { defaultModel: "sonar" },
  },
  together: {
    id: "together",
    alias: "together",
    name: "Together AI",
    color: "#0F6FFF",
    textIcon: "TG",
    website: "https://www.together.ai",
    apiKeyUrl: "https://api.together.xyz/settings/api-keys",
    serviceKinds: ["llm", "embedding"],
    embeddingConfig: {
      baseUrl: "https://api.together.xyz/v1/embeddings",
      authType: "apikey",
      authHeader: "bearer",
      format: "openai",
      models: [
        { id: "BAAI/bge-large-en-v1.5", name: "BGE Large EN v1.5", dimensions: 1024 },
        { id: "togethercomputer/m2-bert-80M-8k-retrieval", name: "M2 BERT 80M 8K", dimensions: 768 },
      ],
    },
  },
  fireworks: {
    id: "fireworks",
    alias: "fireworks",
    name: "Fireworks AI",
    color: "#7B2EF2",
    textIcon: "FW",
    website: "https://fireworks.ai",
    apiKeyUrl: "https://fireworks.ai/account/api-keys",
    serviceKinds: ["llm", "embedding"],
    embeddingConfig: {
      baseUrl: "https://api.fireworks.ai/inference/v1/embeddings",
      authType: "apikey",
      authHeader: "bearer",
      format: "openai",
      models: [
        { id: "nomic-ai/nomic-embed-text-v1.5", name: "Nomic Embed Text v1.5", dimensions: 768 },
      ],
    },
  },
  nebius: {
    id: "nebius",
    alias: "nebius",
    name: "Nebius AI",
    color: "#6C5CE7",
    textIcon: "NB",
    website: "https://nebius.com",
    apiKeyUrl: "https://studio.nebius.com/settings/api-keys",
    serviceKinds: ["llm", "embedding"],
    embeddingConfig: {
      baseUrl: "https://api.tokenfactory.nebius.com/v1/embeddings",
      authType: "apikey",
      authHeader: "bearer",
      format: "openai",
      models: [
        { id: "Qwen/Qwen3-Embedding-8B", name: "Qwen3 Embedding 8B", dimensions: 4096 },
      ],
    },
  },
  hyperbolic: {
    id: "hyperbolic",
    alias: "hyp",
    name: "Hyperbolic",
    color: "#00D4FF",
    textIcon: "HY",
    website: "https://hyperbolic.xyz",
    apiKeyUrl: "https://app.hyperbolic.xyz/settings",
    serviceKinds: ["llm", "tts"],
    ttsConfig: {
      baseUrl: "https://api.hyperbolic.xyz/v1/audio/generation",
      authType: "apikey",
      authHeader: "bearer",
      format: "hyperbolic",
      models: [{ id: "melo-tts", name: "Melo TTS" }],
    },
  },
  deepgram: {
    id: "deepgram",
    alias: "dg",
    name: "Deepgram",
    color: "#13EF93",
    textIcon: "DG",
    website: "https://deepgram.com",
    apiKeyUrl: "https://console.deepgram.com/api-keys",
    serviceKinds: ["stt", "imageToText", "tts"],
    ttsConfig: {
      // 9router ships an empty model list for Deepgram TTS — voice/model is
      // selected at request time. We keep a single placeholder so the
      // catalog table has at least one entry to show.
      baseUrl: "https://api.deepgram.com/v1/speak",
      authType: "apikey",
      authHeader: "token",
      format: "deepgram",
      models: [{ id: "aura-asteria-en", name: "Aura Asteria EN" }],
    },
    sttConfig: {
      baseUrl: "https://api.deepgram.com/v1/listen",
      authType: "apikey",
      authHeader: "token",
      format: "deepgram",
      models: [
        { id: "nova-3", name: "Nova 3" },
        { id: "nova-2", name: "Nova 2" },
        { id: "whisper-large", name: "Whisper Large" },
      ],
    },
  },
  assemblyai: {
    id: "assemblyai",
    alias: "aai",
    name: "AssemblyAI",
    color: "#0062FF",
    textIcon: "AA",
    website: "https://assemblyai.com",
    apiKeyUrl: "https://www.assemblyai.com/app/api-keys",
    serviceKinds: ["stt"],
    sttConfig: {
      baseUrl: "https://api.assemblyai.com/v2/transcript",
      authType: "apikey",
      authHeader: "bearer",
      format: "assemblyai",
      async: true,
      models: [
        { id: "universal-3-pro", name: "Universal 3 Pro" },
        { id: "universal-2", name: "Universal 2" },
      ],
    },
  },
  nanobanana: {
    id: "nanobanana",
    alias: "nb",
    name: "NanoBanana API",
    color: "#FFD700",
    textIcon: "🍌",
    website: "https://nanobananaapi.ai",
    apiKeyUrl: "https://nanobananaapi.ai/dashboard",
    serviceKinds: ["image"],
    imageConfig: {
      // 3rd-party proxy for Google Nano Banana (Gemini 2.5 Flash Image).
      // 9router uses an async submit + poll pattern; the gateway currently
      // wraps it as an OpenAI-compatible synchronous proxy.
      baseUrl: "https://api.nanobananaapi.ai",
      authType: "bearer",
      authHeader: "bearer",
      format: "nanobanana",
      models: [
        { id: "nano-banana", name: "Nano Banana (Gemini 2.5 Flash Image)" },
      ],
    },
  },
  elevenlabs: {
    id: "elevenlabs",
    alias: "el",
    name: "ElevenLabs",
    color: "#6C47FF",
    textIcon: "EL",
    website: "https://elevenlabs.io",
    apiKeyUrl: "https://elevenlabs.io/app/settings/api-keys",
    serviceKinds: ["tts"],
    ttsConfig: {
      baseUrl: "https://api.elevenlabs.io/v1/text-to-speech",
      authType: "apikey",
      authHeader: "xi-api-key",
      format: "elevenlabs",
      models: [
        { id: "eleven_multilingual_v2", name: "Eleven Multilingual v2" },
        { id: "eleven_turbo_v2_5", name: "Eleven Turbo v2.5" },
      ],
    },
  },
  cartesia: {
    id: "cartesia",
    alias: "cartesia",
    name: "Cartesia",
    color: "#FF4F8B",
    textIcon: "CA",
    website: "https://cartesia.ai",
    apiKeyUrl: "https://play.cartesia.ai/keys",
    hidden: true,
    serviceKinds: ["tts"],
    ttsConfig: {
      baseUrl: "https://api.cartesia.ai/tts/bytes",
      authType: "apikey",
      authHeader: "x-api-key",
      format: "cartesia",
      models: [
        { id: "sonic-2", name: "Sonic 2" },
        { id: "sonic-3", name: "Sonic 3" },
      ],
    },
  },
  playht: {
    id: "playht",
    alias: "playht",
    name: "PlayHT",
    color: "#00B4D8",
    textIcon: "PH",
    website: "https://play.ht",
    apiKeyUrl: "https://play.ht/studio/api-access",
    hidden: true,
    serviceKinds: ["tts"],
    ttsConfig: {
      baseUrl: "https://api.play.ht/api/v2/tts/stream",
      authType: "apikey",
      authHeader: "playht",
      format: "playht",
      models: [
        { id: "PlayDialog", name: "PlayDialog" },
        { id: "Play3.0-mini", name: "Play 3.0 Mini" },
      ],
    },
  },
  "local-device": {
    id: "local-device",
    alias: "local-device",
    name: "Local Device",
    color: "#64748B",
    textIcon: "LD",
    mediaPriority: 5,
    noAuth: true,
    serviceKinds: ["tts"],
    ttsConfig: {
      // Client-side TTS — runs in the browser via Web Speech API.
      baseUrl: "local-device",
      authType: "none",
      authHeader: "none",
      format: "local-device",
      models: [],
    },
  },
  "google-tts": {
    id: "google-tts",
    alias: "google-tts",
    name: "Google TTS",
    color: "#4285F4",
    textIcon: "GT",
    mediaPriority: 5,
    noAuth: true,
    serviceKinds: ["tts"],
    ttsConfig: {
      baseUrl: "google-tts",
      authType: "none",
      authHeader: "none",
      format: "google-tts",
      models: [
        { id: "af", name: "Afrikaans" },
        { id: "ar", name: "Arabic" },
        { id: "bg", name: "Bulgarian" },
        { id: "bn", name: "Bengali" },
        { id: "bs", name: "Bosnian" },
        { id: "ca", name: "Catalan" },
        { id: "cs", name: "Czech" },
        { id: "cy", name: "Welsh" },
        { id: "da", name: "Danish" },
        { id: "de", name: "German" },
        { id: "el", name: "Greek" },
        { id: "en", name: "English" },
        { id: "eo", name: "Esperanto" },
        { id: "es", name: "Spanish" },
        { id: "et", name: "Estonian" },
        { id: "fi", name: "Finnish" },
        { id: "fr", name: "French" },
        { id: "gu", name: "Gujarati" },
        { id: "hi", name: "Hindi" },
        { id: "hr", name: "Croatian" },
        { id: "hu", name: "Hungarian" },
        { id: "hy", name: "Armenian" },
        { id: "id", name: "Indonesian" },
        { id: "is", name: "Icelandic" },
        { id: "it", name: "Italian" },
        { id: "ja", name: "Japanese" },
        { id: "jw", name: "Javanese" },
        { id: "km", name: "Khmer" },
        { id: "kn", name: "Kannada" },
        { id: "ko", name: "Korean" },
        { id: "la", name: "Latin" },
        { id: "lv", name: "Latvian" },
        { id: "mk", name: "Macedonian" },
        { id: "ml", name: "Malayalam" },
        { id: "mr", name: "Marathi" },
        { id: "my", name: "Myanmar (Burmese)" },
        { id: "ne", name: "Nepali" },
        { id: "nl", name: "Dutch" },
        { id: "no", name: "Norwegian" },
        { id: "pl", name: "Polish" },
        { id: "pt", name: "Portuguese" },
        { id: "ro", name: "Romanian" },
        { id: "ru", name: "Russian" },
        { id: "si", name: "Sinhala" },
        { id: "sk", name: "Slovak" },
        { id: "sq", name: "Albanian" },
        { id: "sr", name: "Serbian" },
        { id: "su", name: "Sundanese" },
        { id: "sv", name: "Swedish" },
        { id: "sw", name: "Swahili" },
        { id: "ta", name: "Tamil" },
        { id: "te", name: "Telugu" },
        { id: "th", name: "Thai" },
        { id: "tl", name: "Filipino" },
        { id: "tr", name: "Turkish" },
        { id: "uk", name: "Ukrainian" },
        { id: "ur", name: "Urdu" },
        { id: "vi", name: "Vietnamese" },
        { id: "zh-CN", name: "Chinese (Simplified)" },
        { id: "zh-TW", name: "Chinese (Traditional)" },
      ],
    },
  },
  "edge-tts": {
    id: "edge-tts",
    alias: "edge-tts",
    name: "Edge TTS",
    color: "#0078D4",
    textIcon: "ET",
    mediaPriority: 5,
    noAuth: true,
    serviceKinds: ["tts"],
    ttsConfig: {
      baseUrl: "edge-tts",
      authType: "none",
      authHeader: "none",
      format: "edge-tts",
      models: [
        { id: "en-US-AriaNeural", name: "Aria (en-US)" },
        { id: "en-US-GuyNeural", name: "Guy (en-US)" },
        { id: "en-GB-SoniaNeural", name: "Sonia (en-GB)" },
        { id: "vi-VN-HoaiMyNeural", name: "Hoai My (vi-VN)" },
        { id: "vi-VN-NamMinhNeural", name: "Nam Minh (vi-VN)" },
        { id: "zh-CN-XiaoxiaoNeural", name: "Xiaoxiao (zh-CN)" },
        { id: "zh-CN-YunxiNeural", name: "Yunxi (zh-CN)" },
        { id: "fr-FR-DeniseNeural", name: "Denise (fr-FR)" },
        { id: "de-DE-KatjaNeural", name: "Katja (de-DE)" },
        { id: "ja-JP-NanamiNeural", name: "Nanami (ja-JP)" },
        { id: "ko-KR-SunHiNeural", name: "SunHi (ko-KR)" },
      ],
    },
  },
  coqui: {
    id: "coqui",
    alias: "coqui",
    name: "Coqui TTS",
    color: "#10B981",
    textIcon: "CQ",
    website: "https://github.com/coqui-ai/TTS",
    hidden: true,
    noAuth: true,
    serviceKinds: ["tts"],
    ttsConfig: {
      baseUrl: "http://localhost:5002/api/tts",
      authType: "none",
      authHeader: "none",
      format: "coqui",
      models: [
        { id: "tts_models/en/ljspeech/tacotron2-DDC", name: "Tacotron2 DDC (LJSpeech)" },
      ],
    },
  },
  tortoise: {
    id: "tortoise",
    alias: "tortoise",
    name: "Tortoise TTS",
    color: "#7C3AED",
    textIcon: "TT",
    website: "https://github.com/neonbjb/tortoise-tts",
    hidden: true,
    noAuth: true,
    serviceKinds: ["tts"],
    ttsConfig: {
      baseUrl: "http://localhost:5000/api/tts",
      authType: "none",
      authHeader: "none",
      format: "tortoise",
      models: [{ id: "tortoise-v2", name: "Tortoise v2" }],
    },
  },
  inworld: {
    id: "inworld",
    alias: "inworld",
    name: "Inworld TTS",
    color: "#FF6B6B",
    textIcon: "IW",
    website: "https://inworld.ai",
    apiKeyUrl: "https://platform.inworld.ai/api-keys",
    serviceKinds: ["tts"],
    ttsConfig: {
      baseUrl: "https://api.inworld.ai/tts/v1/voice",
      authType: "apikey",
      authHeader: "basic",
      format: "inworld",
      models: [
        { id: "inworld-tts-1.5-mini", name: "Inworld TTS 1.5 Mini ($0.01/min)" },
        { id: "inworld-tts-1.5-max", name: "Inworld TTS 1.5 Max ($0.025/min)" },
      ],
    },
  },
  "voyage-ai": {
    id: "voyage-ai",
    alias: "voyage",
    name: "Voyage AI",
    color: "#0EA5E9",
    textIcon: "VG",
    website: "https://www.voyageai.com",
    apiKeyUrl: "https://dash.voyageai.com/api-keys",
    serviceKinds: ["embedding"],
    embeddingConfig: {
      baseUrl: "https://api.voyageai.com/v1/embeddings",
      authType: "apikey",
      authHeader: "bearer",
      format: "openai",
      models: [
        { id: "voyage-3-large", name: "Voyage 3 Large", dimensions: 1024 },
        { id: "voyage-3.5", name: "Voyage 3.5", dimensions: 1024 },
        { id: "voyage-3.5-lite", name: "Voyage 3.5 Lite", dimensions: 1024 },
        { id: "voyage-code-3", name: "Voyage Code 3", dimensions: 1024 },
        { id: "voyage-finance-2", name: "Voyage Finance 2", dimensions: 1024 },
        { id: "voyage-law-2", name: "Voyage Law 2", dimensions: 1024 },
        { id: "voyage-multilingual-2", name: "Voyage Multilingual 2", dimensions: 1024 },
      ],
    },
  },
  sdwebui: {
    id: "sdwebui",
    alias: "sdwebui",
    name: "SD WebUI",
    color: "#FF7043",
    textIcon: "SD",
    website: "https://github.com/AUTOMATIC1111/stable-diffusion-webui",
    serviceKinds: ["image"],
    imageConfig: {
      // Local AUTOMATIC1111 instance — no auth by default.
      baseUrl: "http://localhost:7860",
      authType: "none",
      format: "sdwebui",
      models: [
        { id: "default", name: "Default (current model)" },
      ],
    },
  },
  comfyui: {
    id: "comfyui",
    alias: "comfyui",
    name: "ComfyUI",
    color: "#4CAF50",
    textIcon: "CF",
    website: "https://github.com/comfyanonymous/ComfyUI",
    serviceKinds: ["image"],
    imageConfig: {
      // Local ComfyUI instance — async workflow execution not yet implemented.
      // Marked as a placeholder/stub on the gateway side.
      baseUrl: "http://localhost:8188",
      authType: "none",
      format: "comfyui",
      models: [
        { id: "default", name: "Default workflow" },
      ],
    },
  },
  huggingface: {
    id: "huggingface",
    alias: "hf",
    name: "HuggingFace",
    color: "#FFD21E",
    textIcon: "HF",
    website: "https://huggingface.co",
    apiKeyUrl: "https://huggingface.co/settings/tokens",
    serviceKinds: ["image", "imageToText", "tts", "stt"],
    hiddenKinds: ["tts"],
    imageConfig: {
      // baseUrl is the HF inference root; the model id is appended at request
      // time. Returns binary PNG which the handler converts to b64_json.
      baseUrl: "https://api-inference.huggingface.co/models",
      authType: "bearer",
      authHeader: "bearer",
      format: "huggingface",
      models: [
        { id: "black-forest-labs/FLUX.1-schnell", name: "FLUX.1 Schnell" },
        { id: "black-forest-labs/FLUX.1-dev", name: "FLUX.1 Dev" },
        { id: "stabilityai/stable-diffusion-xl-base-1.0", name: "SDXL Base 1.0" },
        { id: "stabilityai/stable-diffusion-3.5-large", name: "SD 3.5 Large" },
        { id: "stabilityai/sdxl-turbo", name: "SDXL Turbo" },
      ],
    },
    ttsConfig: {
      // Hidden in catalog UI (hiddenKinds) but kept wired so backend still
      // dispatches for users who manually point at it.
      baseUrl: "https://api-inference.huggingface.co/models",
      authType: "apikey",
      authHeader: "bearer",
      format: "huggingface-tts",
      models: [
        { id: "facebook/mms-tts-eng", name: "MMS TTS English" },
        { id: "microsoft/speecht5_tts", name: "SpeechT5 TTS" },
      ],
    },
    sttConfig: {
      baseUrl: "https://api-inference.huggingface.co/models",
      authType: "apikey",
      authHeader: "bearer",
      format: "huggingface-asr",
      models: [
        { id: "openai/whisper-large-v3", name: "Whisper Large v3 (HF)" },
        { id: "openai/whisper-small", name: "Whisper Small (HF)" },
      ],
    },
  },

  // ─── Web search & fetch providers ─────────────────────────────────────
  tavily: {
    id: "tavily",
    alias: "tavily",
    name: "Tavily",
    color: "#5B21B6",
    textIcon: "TV",
    website: "https://tavily.com",
    apiKeyUrl: "https://app.tavily.com/home",
    serviceKinds: ["webSearch", "webFetch"],
    searchConfig: {
      baseUrl: "https://api.tavily.com/search",
      method: "POST",
      authType: "apikey",
      authHeader: "bearer",
      format: "tavily",
      searchTypes: ["web", "news"],
      defaultMaxResults: 5,
      maxMaxResults: 20,
    },
    fetchConfig: {
      baseUrl: "https://api.tavily.com/extract",
      method: "POST",
      authType: "apikey",
      authHeader: "bearer",
      format: "tavily",
      formats: ["markdown", "text"],
      maxCharacters: 100000,
    },
  },
  "brave-search": {
    id: "brave-search",
    alias: "brave",
    name: "Brave Search",
    color: "#FB542B",
    textIcon: "BR",
    website: "https://brave.com/search/api",
    apiKeyUrl: "https://api-dashboard.search.brave.com/app/keys",
    serviceKinds: ["webSearch"],
    searchConfig: {
      baseUrl: "https://api.search.brave.com/res/v1",
      method: "GET",
      authType: "apikey",
      authHeader: "x-subscription-token",
      format: "brave",
      searchTypes: ["web", "news"],
      defaultMaxResults: 5,
      maxMaxResults: 20,
    },
  },
  serper: {
    id: "serper",
    alias: "serper",
    name: "Serper",
    color: "#4F46E5",
    textIcon: "SP",
    website: "https://serper.dev",
    apiKeyUrl: "https://serper.dev/api-key",
    serviceKinds: ["webSearch"],
    searchConfig: {
      baseUrl: "https://google.serper.dev",
      method: "POST",
      authType: "apikey",
      authHeader: "x-api-key",
      format: "serper",
      searchTypes: ["web", "news"],
      defaultMaxResults: 5,
      maxMaxResults: 100,
    },
  },
  exa: {
    id: "exa",
    alias: "exa",
    name: "Exa",
    color: "#2563EB",
    textIcon: "EX",
    website: "https://exa.ai",
    apiKeyUrl: "https://dashboard.exa.ai/api-keys",
    serviceKinds: ["webSearch", "webFetch"],
    searchConfig: {
      baseUrl: "https://api.exa.ai/search",
      method: "POST",
      authType: "apikey",
      authHeader: "x-api-key",
      format: "exa",
      searchTypes: ["web", "news"],
      defaultMaxResults: 5,
      maxMaxResults: 100,
    },
    fetchConfig: {
      baseUrl: "https://api.exa.ai/contents",
      method: "POST",
      authType: "apikey",
      authHeader: "x-api-key",
      format: "exa",
      formats: ["text", "markdown"],
      maxCharacters: 100000,
    },
  },
  searxng: {
    id: "searxng",
    alias: "searxng",
    name: "SearXNG",
    color: "#3B82F6",
    textIcon: "SX",
    website: "https://docs.searxng.org",
    noAuth: true,
    serviceKinds: ["webSearch"],
    searchConfig: {
      baseUrl: "http://localhost:8888/search",
      method: "GET",
      authType: "none",
      authHeader: "none",
      format: "searxng",
      searchTypes: ["web", "news"],
      defaultMaxResults: 5,
      maxMaxResults: 50,
    },
  },
  "google-pse": {
    id: "google-pse",
    alias: "gpse",
    name: "Google PSE",
    color: "#4285F4",
    textIcon: "GP",
    website: "https://programmablesearchengine.google.com",
    apiKeyUrl: "https://programmablesearchengine.google.com/controlpanel/create",
    serviceKinds: ["webSearch"],
    searchConfig: {
      // Google Programmable Search Engine — also requires a `cx` (custom
      // search engine ID) which the user must provide via providerSpecificData.
      baseUrl: "https://www.googleapis.com/customsearch/v1",
      method: "GET",
      authType: "apikey",
      authHeader: "key",
      format: "google-pse",
      searchTypes: ["web", "news"],
      defaultMaxResults: 5,
      maxMaxResults: 10,
    },
  },
  linkup: {
    id: "linkup",
    alias: "linkup",
    name: "Linkup",
    color: "#0EA5E9",
    textIcon: "LK",
    website: "https://linkup.so",
    apiKeyUrl: "https://app.linkup.so/api-keys",
    serviceKinds: ["webSearch"],
    searchConfig: {
      baseUrl: "https://api.linkup.so/v1/search",
      method: "POST",
      authType: "apikey",
      authHeader: "bearer",
      format: "linkup",
      searchTypes: ["web"],
      defaultMaxResults: 5,
      maxMaxResults: 50,
    },
  },
  searchapi: {
    id: "searchapi",
    alias: "searchapi",
    name: "SearchAPI",
    color: "#0EA5A4",
    textIcon: "SA",
    website: "https://www.searchapi.io",
    apiKeyUrl: "https://www.searchapi.io/dashboard",
    serviceKinds: ["webSearch"],
    searchConfig: {
      baseUrl: "https://www.searchapi.io/api/v1/search",
      method: "GET",
      authType: "apikey",
      authHeader: "api_key",
      format: "searchapi",
      searchTypes: ["web", "news"],
      defaultMaxResults: 5,
      maxMaxResults: 100,
    },
  },
  youcom: {
    id: "youcom",
    alias: "youcom",
    name: "You.com Search",
    color: "#7C3AED",
    textIcon: "YC",
    website: "https://you.com",
    apiKeyUrl: "https://api.you.com",
    serviceKinds: ["webSearch"],
    searchConfig: {
      baseUrl: "https://ydc-index.io/v1/search",
      method: "GET",
      authType: "apikey",
      authHeader: "x-api-key",
      format: "youcom",
      searchTypes: ["web", "news"],
      defaultMaxResults: 5,
      maxMaxResults: 100,
    },
  },
  firecrawl: {
    id: "firecrawl",
    alias: "firecrawl",
    name: "Firecrawl",
    color: "#F59E0B",
    textIcon: "FC",
    website: "https://firecrawl.dev",
    apiKeyUrl: "https://www.firecrawl.dev/app/api-keys",
    serviceKinds: ["webFetch"],
    fetchConfig: {
      baseUrl: "https://api.firecrawl.dev/v1/scrape",
      method: "POST",
      authType: "apikey",
      authHeader: "bearer",
      format: "firecrawl",
      formats: ["markdown", "html", "text"],
      maxCharacters: 200000,
    },
  },

  // ─── Image / video providers ──────────────────────────────────────────
  "fal-ai": {
    id: "fal-ai",
    alias: "fal",
    name: "Fal.ai",
    color: "#2563EB",
    textIcon: "FL",
    website: "https://fal.ai",
    apiKeyUrl: "https://fal.ai/dashboard/keys",
    serviceKinds: ["image"],
    imageConfig: {
      // Fal.ai uses a queue-based async API. The synchronous wrapper in the
      // gateway POSTs to https://fal.run/{model} which returns the result
      // synchronously for fast models (schnell, sdxl-lightning).
      baseUrl: "https://fal.run",
      authType: "apikey",
      authHeader: "key", // "Authorization: Key <token>" — NOT Bearer.
      format: "falai",
      models: [
        { id: "fal-ai/flux/schnell", name: "FLUX.1 Schnell" },
        { id: "fal-ai/flux/dev", name: "FLUX.1 Dev" },
        { id: "fal-ai/flux-pro/v1.1", name: "FLUX.1 Pro 1.1" },
        { id: "fal-ai/fast-sdxl", name: "Fast SDXL" },
        { id: "fal-ai/stable-diffusion-v35-large", name: "SD 3.5 Large" },
      ],
    },
  },
  "stability-ai": {
    id: "stability-ai",
    alias: "stability",
    name: "Stability AI",
    color: "#8B5CF6",
    textIcon: "SA",
    website: "https://stability.ai",
    apiKeyUrl: "https://platform.stability.ai/account/keys",
    serviceKinds: ["image"],
    imageConfig: {
      // Stability v2beta is synchronous: POST → image bytes (or JSON with b64).
      // baseUrl is the v2beta root; the engine path (core/ultra/sd3) is
      // appended based on the model id.
      baseUrl: "https://api.stability.ai/v2beta/stable-image/generate",
      authType: "bearer",
      authHeader: "bearer",
      format: "stability",
      models: [
        { id: "stable-image-core", name: "Stable Image Core" },
        { id: "stable-image-ultra", name: "Stable Image Ultra" },
        { id: "sd3-large", name: "Stable Diffusion 3 Large" },
        { id: "sd3-large-turbo", name: "Stable Diffusion 3 Large Turbo" },
        { id: "sd3-medium", name: "Stable Diffusion 3 Medium" },
      ],
    },
  },
  "black-forest-labs": {
    id: "black-forest-labs",
    alias: "bfl",
    name: "Black Forest Labs",
    color: "#111827",
    textIcon: "BF",
    website: "https://blackforestlabs.ai",
    apiKeyUrl: "https://api.bfl.ai",
    serviceKinds: ["image"],
    imageConfig: {
      // BFL is async (POST → {polling_url}, then GET /v1/get_result).
      // The gateway returns 501 from the synchronous flow; full polling
      // support is not yet implemented.
      baseUrl: "https://api.bfl.ai/v1",
      authType: "custom",
      authHeader: "x-key",
      format: "bfl",
      models: [
        { id: "flux-pro-1.1", name: "FLUX 1.1 Pro" },
        { id: "flux-pro-1.1-ultra", name: "FLUX 1.1 Pro Ultra" },
        { id: "flux-pro", name: "FLUX Pro" },
        { id: "flux-dev", name: "FLUX Dev" },
      ],
    },
  },
  recraft: {
    id: "recraft",
    alias: "recraft",
    name: "Recraft",
    color: "#EC4899",
    textIcon: "RC",
    website: "https://recraft.ai",
    apiKeyUrl: "https://www.recraft.ai/profile/api",
    serviceKinds: ["image"],
    imageConfig: {
      baseUrl: "https://external.api.recraft.ai/v1/images/generations",
      authType: "bearer",
      authHeader: "bearer",
      format: "openai",
      models: [
        { id: "recraftv3", name: "Recraft V3" },
        { id: "recraftv2", name: "Recraft V2" },
      ],
    },
  },
  topaz: {
    id: "topaz",
    alias: "topaz",
    name: "Topaz",
    color: "#059669",
    textIcon: "TP",
    website: "https://topazlabs.com",
    apiKeyUrl: "https://topazlabs.com/account",
    serviceKinds: ["image"],
    imageConfig: {
      // Topaz upscaling — handler not yet wired up. OpenAI-compatible
      // pass-through is configured as a best-effort stub.
      baseUrl: "https://api.topazlabs.com/image/v1",
      authType: "bearer",
      authHeader: "bearer",
      format: "openai",
      models: [
        { id: "upscale", name: "Image Upscale" },
      ],
    },
  },
  runwayml: {
    id: "runwayml",
    alias: "runway",
    name: "Runway ML",
    color: "#000000",
    textIcon: "RW",
    website: "https://runwayml.com",
    apiKeyUrl: "https://dev.runwayml.com",
    serviceKinds: ["image"],
    imageConfig: {
      // Runway is async (POST → {id}, then GET /v1/tasks/{id}).
      // The gateway submits the request and returns the task envelope; full
      // polling support is not yet implemented.
      baseUrl: "https://api.dev.runwayml.com/v1",
      authType: "bearer",
      authHeader: "bearer",
      format: "runway",
      models: [
        { id: "gen4_image", name: "Gen-4 Image" },
        { id: "gen3a_turbo", name: "Gen-3 Alpha Turbo" },
      ],
    },
  },

  // ─── Audio providers ──────────────────────────────────────────────────
  "aws-polly": {
    id: "aws-polly",
    alias: "polly",
    name: "AWS Polly",
    color: "#FF9900",
    textIcon: "PL",
    website: "https://aws.amazon.com/polly/",
    apiKeyUrl: "https://console.aws.amazon.com/iam/home#/security_credentials",
    serviceKinds: ["tts"],
    ttsConfig: {
      // AWS Polly requires SigV4 request signing — not yet implemented.
      // The handler returns a not-implemented error for this format.
      baseUrl: "https://polly.{region}.amazonaws.com/v1/speech",
      authType: "custom",
      authHeader: "aws-sigv4",
      format: "aws-polly",
      models: [
        { id: "standard", name: "Standard" },
        { id: "neural", name: "Neural" },
        { id: "long-form", name: "Long-form" },
        { id: "generative", name: "Generative" },
      ],
    },
  },

  // ─── Embedding / web fetch providers ──────────────────────────────────
  "jina-ai": {
    id: "jina-ai",
    alias: "jina",
    name: "Jina AI",
    color: "#2563EB",
    textIcon: "JA",
    website: "https://jina.ai",
    apiKeyUrl: "https://jina.ai/?sui=apikey",
    serviceKinds: ["embedding"],
    embeddingConfig: {
      baseUrl: "https://api.jina.ai/v1/embeddings",
      authType: "apikey",
      authHeader: "bearer",
      format: "openai",
      models: [
        { id: "jina-embeddings-v3", name: "Jina Embeddings v3", dimensions: 1024 },
        { id: "jina-embeddings-v2-base-en", name: "Jina Embeddings v2 Base EN", dimensions: 768 },
        { id: "jina-embeddings-v2-base-code", name: "Jina Embeddings v2 Base Code", dimensions: 768 },
      ],
    },
  },
  "jina-reader": {
    id: "jina-reader",
    alias: "jina",
    name: "Jina Reader",
    color: "#000000",
    textIcon: "JR",
    website: "https://jina.ai/reader",
    apiKeyUrl: "https://jina.ai/?sui=apikey",
    serviceKinds: ["webFetch"],
    fetchConfig: {
      baseUrl: "https://r.jina.ai",
      method: "GET",
      authType: "apikey",
      authHeader: "bearer",
      format: "jina",
      formats: ["markdown", "text", "html"],
      maxCharacters: 200000,
    },
  },
};

/**
 * Get the list of providers that expose a given service kind, sorted by
 * `mediaPriority` (lower first, default 100). Hidden providers and providers
 * that explicitly hide that kind are filtered out.
 */
export function getProvidersByKind(kind: ServiceKind): CatalogProvider[] {
  return Object.values(AI_PROVIDERS)
    .filter((p) => {
      const kinds = p.serviceKinds ?? ["llm"];
      if (!kinds.includes(kind)) return false;
      if (p.hidden) return false;
      if (p.hiddenKinds?.includes(kind)) return false;
      return true;
    })
    .sort((a, b) => (a.mediaPriority ?? 100) - (b.mediaPriority ?? 100));
}
