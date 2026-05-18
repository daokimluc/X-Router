/**
 * Auto-sync media configuration for provider instances on startup.
 *
 * When provider instances are created via auto-import flows (OAuth, CLI, etc.)
 * they don't go through the dashboard's "Add Connection" modal which normally
 * PATCHes serviceKinds + mediaConfig. This utility fills that gap by scanning
 * all instances at startup and applying catalog-defined media configs for any
 * instance whose type matches a known media-capable provider.
 *
 * Only applies to instances that have NO serviceKinds set yet — never
 * overwrites user customizations.
 */

import type { ProviderRuntimeRegistry } from "../provider-runtime/ProviderRuntimeRegistry.js";
import type { MediaKind, MediaServiceConfig } from "./types.js";

type MediaCatalogEntry = {
  serviceKinds: MediaKind[];
  mediaConfig: Partial<Record<MediaKind, MediaServiceConfig>>;
};

/**
 * Minimal server-side catalog mapping provider type → media capabilities.
 * Mirrors the dashboard's providerCatalog.ts but only includes the fields
 * needed for auto-sync (serviceKinds + mediaConfig per kind).
 *
 * Keep in sync with apps/dashboard/src/providerCatalog.ts.
 */
const MEDIA_CATALOG: Record<string, MediaCatalogEntry> = {
  // ─── LLM providers with media capabilities ────────────────────────────
  openai: {
    serviceKinds: ["embedding", "image", "tts", "stt", "imageToText", "webSearch"],
    mediaConfig: {
      embedding: {
        baseUrl: "https://api.openai.com/v1/embeddings",
        authType: "apikey",
        authHeader: "bearer",
        format: "openai",
        models: [
          { id: "text-embedding-3-small", displayName: "Text Embedding 3 Small" },
          { id: "text-embedding-3-large", displayName: "Text Embedding 3 Large" },
          { id: "text-embedding-ada-002", displayName: "Text Embedding Ada 002" },
        ],
      },
      image: {
        baseUrl: "https://api.openai.com/v1/images/generations",
        authType: "bearer",
        authHeader: "bearer",
        format: "openai",
        models: [
          { id: "gpt-image-1", displayName: "GPT Image 1" },
          { id: "dall-e-3", displayName: "DALL-E 3" },
          { id: "dall-e-2", displayName: "DALL-E 2" },
        ],
      },
      tts: {
        baseUrl: "https://api.openai.com/v1/audio/speech",
        authType: "apikey",
        authHeader: "bearer",
        format: "openai",
        models: [
          { id: "tts-1", displayName: "TTS-1" },
          { id: "tts-1-hd", displayName: "TTS-1 HD" },
          { id: "gpt-4o-mini-tts", displayName: "GPT-4o Mini TTS" },
        ],
      },
      stt: {
        baseUrl: "https://api.openai.com/v1/audio/transcriptions",
        authType: "apikey",
        authHeader: "bearer",
        format: "openai",
        models: [
          { id: "whisper-1", displayName: "Whisper 1" },
          { id: "gpt-4o-transcribe", displayName: "GPT-4o Transcribe" },
          { id: "gpt-4o-mini-transcribe", displayName: "GPT-4o Mini Transcribe" },
        ],
      },
    },
  },
  gemini: {
    serviceKinds: ["embedding", "image", "imageToText", "tts", "stt", "webSearch"],
    mediaConfig: {
      embedding: {
        baseUrl: "https://generativelanguage.googleapis.com/v1beta",
        authType: "apikey",
        authHeader: "key",
        format: "gemini",
        models: [
          { id: "gemini-embedding-2-preview", displayName: "Gemini Embedding 2 Preview" },
          { id: "text-embedding-005", displayName: "Text Embedding 005" },
          { id: "text-embedding-004", displayName: "Text Embedding 004" },
        ],
      },
      image: {
        baseUrl: "https://generativelanguage.googleapis.com/v1beta",
        authType: "apikey",
        authHeader: "key",
        format: "gemini",
        models: [
          { id: "gemini-3.1-flash-image-preview", displayName: "Gemini 3.1 Flash Image" },
          { id: "gemini-3-pro-image-preview", displayName: "Gemini 3 Pro Image" },
          { id: "gemini-2.5-flash-image", displayName: "Gemini 2.5 Flash Image" },
          { id: "imagen-3.0-generate-002", displayName: "Imagen 3" },
        ],
      },
      tts: {
        baseUrl: "https://generativelanguage.googleapis.com/v1beta/models",
        authType: "apikey",
        authHeader: "key",
        format: "gemini-tts",
        models: [
          { id: "gemini-2.5-flash-preview-tts", displayName: "Gemini 2.5 Flash TTS" },
          { id: "gemini-2.5-pro-preview-tts", displayName: "Gemini 2.5 Pro TTS" },
        ],
      },
      stt: {
        baseUrl: "https://generativelanguage.googleapis.com/v1beta/models",
        authType: "apikey",
        authHeader: "key",
        format: "gemini-stt",
        models: [
          { id: "gemini-2.5-flash", displayName: "Gemini 2.5 Flash STT" },
          { id: "gemini-2.0-flash", displayName: "Gemini 2.0 Flash STT" },
        ],
      },
    },
  },
  codex: {
    serviceKinds: ["image"],
    mediaConfig: {
      image: {
        baseUrl: "https://chatgpt.com/backend-api/codex/responses",
        authType: "bearer",
        authHeader: "bearer",
        format: "codex",
        models: [
          { id: "gpt-5.5-image", displayName: "GPT 5.5 Image" },
          { id: "gpt-5.4-image", displayName: "GPT 5.4 Image" },
          { id: "gpt-5.3-image", displayName: "GPT 5.3 Image" },
          { id: "gpt-5.2-image", displayName: "GPT 5.2 Image" },
        ],
      },
    },
  },
  openrouter: {
    serviceKinds: ["embedding", "tts", "image"],
    mediaConfig: {
      embedding: {
        baseUrl: "https://openrouter.ai/api/v1/embeddings",
        authType: "apikey",
        authHeader: "bearer",
        format: "openai",
        models: [
          { id: "openai/text-embedding-3-large", displayName: "Text Embedding 3 Large" },
          { id: "openai/text-embedding-3-small", displayName: "Text Embedding 3 Small" },
          { id: "qwen/qwen3-embedding-8b", displayName: "Qwen3 Embedding 8B" },
        ],
      },
      tts: {
        baseUrl: "https://openrouter.ai/api/v1/audio/speech",
        authType: "apikey",
        authHeader: "bearer",
        format: "openrouter",
        models: [
          { id: "openai/gpt-4o-mini-tts", displayName: "GPT-4o Mini TTS" },
          { id: "openai/tts-1-hd", displayName: "TTS-1 HD" },
          { id: "openai/tts-1", displayName: "TTS-1" },
        ],
      },
      image: {
        baseUrl: "https://openrouter.ai/api/v1/images/generations",
        authType: "apikey",
        authHeader: "bearer",
        format: "openai",
        models: [
          { id: "openai/gpt-image-1", displayName: "GPT Image 1 (via OR)" },
          { id: "openai/dall-e-3", displayName: "DALL-E 3 (via OR)" },
        ],
      },
    },
  },
  minimax: {
    serviceKinds: ["image", "imageToText", "tts", "webSearch"],
    mediaConfig: {
      image: {
        baseUrl: "https://api.minimaxi.com/v1/images/generations",
        authType: "bearer",
        authHeader: "bearer",
        format: "openai",
        models: [{ id: "image-01", displayName: "MiniMax Image 01" }],
      },
      tts: {
        baseUrl: "https://api.minimaxi.com/v1/t2a_v2",
        authType: "apikey",
        authHeader: "bearer",
        format: "minimax-tts",
        models: [
          { id: "speech-02-hd", displayName: "Speech 02 HD" },
          { id: "speech-02", displayName: "Speech 02" },
        ],
      },
    },
  },
  // ─── Embedding-only providers ─────────────────────────────────────────
  mistral: {
    serviceKinds: ["embedding"],
    mediaConfig: {
      embedding: {
        baseUrl: "https://api.mistral.ai/v1/embeddings",
        authType: "apikey",
        authHeader: "bearer",
        format: "openai",
        models: [{ id: "mistral-embed", displayName: "Mistral Embed" }],
      },
    },
  },
  together: {
    serviceKinds: ["embedding"],
    mediaConfig: {
      embedding: {
        baseUrl: "https://api.together.xyz/v1/embeddings",
        authType: "apikey",
        authHeader: "bearer",
        format: "openai",
        models: [
          { id: "BAAI/bge-large-en-v1.5", displayName: "BGE Large EN v1.5" },
          { id: "togethercomputer/m2-bert-80M-8k-retrieval", displayName: "M2 BERT 80M 8K" },
        ],
      },
    },
  },
  fireworks: {
    serviceKinds: ["embedding"],
    mediaConfig: {
      embedding: {
        baseUrl: "https://api.fireworks.ai/inference/v1/embeddings",
        authType: "apikey",
        authHeader: "bearer",
        format: "openai",
        models: [{ id: "nomic-ai/nomic-embed-text-v1.5", displayName: "Nomic Embed Text v1.5" }],
      },
    },
  },
  nebius: {
    serviceKinds: ["embedding"],
    mediaConfig: {
      embedding: {
        baseUrl: "https://api.tokenfactory.nebius.com/v1/embeddings",
        authType: "apikey",
        authHeader: "bearer",
        format: "openai",
        models: [{ id: "Qwen/Qwen3-Embedding-8B", displayName: "Qwen3 Embedding 8B" }],
      },
    },
  },
  "voyage-ai": {
    serviceKinds: ["embedding"],
    mediaConfig: {
      embedding: {
        baseUrl: "https://api.voyageai.com/v1/embeddings",
        authType: "apikey",
        authHeader: "bearer",
        format: "openai",
        models: [
          { id: "voyage-3-large", displayName: "Voyage 3 Large" },
          { id: "voyage-3.5", displayName: "Voyage 3.5" },
          { id: "voyage-code-3", displayName: "Voyage Code 3" },
        ],
      },
    },
  },
  "jina-ai": {
    serviceKinds: ["embedding"],
    mediaConfig: {
      embedding: {
        baseUrl: "https://api.jina.ai/v1/embeddings",
        authType: "apikey",
        authHeader: "bearer",
        format: "openai",
        models: [
          { id: "jina-embeddings-v3", displayName: "Jina Embeddings v3" },
          { id: "jina-embeddings-v2-base-en", displayName: "Jina Embeddings v2 Base EN" },
        ],
      },
    },
  },
  github: {
    serviceKinds: ["embedding"],
    mediaConfig: {
      embedding: {
        baseUrl: "https://models.github.ai/inference/embeddings",
        authType: "apikey",
        authHeader: "bearer",
        format: "openai",
        models: [
          { id: "text-embedding-3-small", displayName: "Text Embedding 3 Small (GitHub)" },
          { id: "text-embedding-3-large", displayName: "Text Embedding 3 Large (GitHub)" },
        ],
      },
    },
  },
  // ─── STT providers ────────────────────────────────────────────────────
  groq: {
    serviceKinds: ["stt"],
    mediaConfig: {
      stt: {
        baseUrl: "https://api.groq.com/openai/v1/audio/transcriptions",
        authType: "apikey",
        authHeader: "bearer",
        format: "openai",
        models: [
          { id: "whisper-large-v3-turbo", displayName: "Whisper Large V3 Turbo" },
          { id: "whisper-large-v3", displayName: "Whisper Large V3" },
          { id: "distil-whisper-large-v3-en", displayName: "Distil Whisper Large V3 EN" },
        ],
      },
    },
  },
  assemblyai: {
    serviceKinds: ["stt"],
    mediaConfig: {
      stt: {
        baseUrl: "https://api.assemblyai.com/v2/transcript",
        authType: "apikey",
        authHeader: "bearer",
        format: "assemblyai",
        models: [
          { id: "universal-3-pro", displayName: "Universal 3 Pro" },
          { id: "universal-2", displayName: "Universal 2" },
        ],
      },
    },
  },
  // ─── TTS providers ────────────────────────────────────────────────────
  deepgram: {
    serviceKinds: ["tts", "stt"],
    mediaConfig: {
      tts: {
        baseUrl: "https://api.deepgram.com/v1/speak",
        authType: "apikey",
        authHeader: "token",
        format: "deepgram",
        models: [
          { id: "aura-asteria-en", displayName: "Aura Asteria" },
          { id: "aura-luna-en", displayName: "Aura Luna" },
        ],
      },
      stt: {
        baseUrl: "https://api.deepgram.com/v1/listen",
        authType: "apikey",
        authHeader: "token",
        format: "deepgram",
        models: [
          { id: "nova-3", displayName: "Nova 3" },
          { id: "nova-2", displayName: "Nova 2" },
        ],
      },
    },
  },
  elevenlabs: {
    serviceKinds: ["tts"],
    mediaConfig: {
      tts: {
        baseUrl: "https://api.elevenlabs.io/v1/text-to-speech",
        authType: "apikey",
        authHeader: "xi-api-key",
        format: "elevenlabs",
        models: [
          { id: "eleven_multilingual_v2", displayName: "Multilingual V2" },
          { id: "eleven_turbo_v2_5", displayName: "Turbo V2.5" },
          { id: "eleven_flash_v2_5", displayName: "Flash V2.5" },
        ],
      },
    },
  },
  hyperbolic: {
    serviceKinds: ["tts"],
    mediaConfig: {
      tts: {
        baseUrl: "https://api.hyperbolic.xyz/v1/audio/generation",
        authType: "apikey",
        authHeader: "bearer",
        format: "hyperbolic",
        models: [{ id: "melo-tts", displayName: "Melo TTS" }],
      },
    },
  },
  // ─── Image providers ──────────────────────────────────────────────────
  huggingface: {
    serviceKinds: ["image", "imageToText", "tts", "stt"],
    mediaConfig: {
      image: {
        baseUrl: "https://api-inference.huggingface.co/models",
        authType: "bearer",
        authHeader: "bearer",
        format: "huggingface",
        models: [
          { id: "black-forest-labs/FLUX.1-schnell", displayName: "FLUX.1 Schnell" },
          { id: "stabilityai/stable-diffusion-xl-base-1.0", displayName: "SDXL Base 1.0" },
        ],
      },
      stt: {
        baseUrl: "https://api-inference.huggingface.co/models",
        authType: "apikey",
        authHeader: "bearer",
        format: "huggingface-asr",
        models: [
          { id: "openai/whisper-large-v3", displayName: "Whisper Large v3 (HF)" },
          { id: "openai/whisper-small", displayName: "Whisper Small (HF)" },
        ],
      },
    },
  },
  cloudflare: {
    serviceKinds: ["image"],
    mediaConfig: {
      image: {
        baseUrl: "https://api.cloudflare.com/client/v4",
        authType: "bearer",
        authHeader: "bearer",
        format: "cloudflare",
        models: [
          { id: "@cf/black-forest-labs/FLUX.1-schnell", displayName: "FLUX.1 Schnell" },
          { id: "@cf/stabilityai/stable-diffusion-xl-base-1.0", displayName: "SDXL Base 1.0" },
        ],
      },
    },
  },
  nanobanana: {
    serviceKinds: ["image"],
    mediaConfig: {
      image: {
        baseUrl: "https://api.nanobananaapi.ai/v1/images/generations",
        authType: "bearer",
        authHeader: "bearer",
        format: "nanobanana",
        models: [
          { id: "nanobanana-flash", displayName: "NanoBanana Flash" },
          { id: "nanobanana-pro", displayName: "NanoBanana Pro" },
        ],
      },
    },
  },
  // ─── Web Search providers ─────────────────────────────────────────────
  perplexity: {
    serviceKinds: ["webSearch"],
    mediaConfig: {
      webSearch: {
        baseUrl: "https://api.perplexity.ai/search",
        authType: "apikey",
        authHeader: "bearer",
        format: "perplexity",
        models: [],
      },
    },
  },
  tavily: {
    serviceKinds: ["webSearch", "webFetch"],
    mediaConfig: {
      webSearch: {
        baseUrl: "https://api.tavily.com/search",
        authType: "apikey",
        authHeader: "bearer",
        format: "tavily",
        models: [],
      },
      webFetch: {
        baseUrl: "https://api.tavily.com/extract",
        authType: "apikey",
        authHeader: "bearer",
        format: "tavily",
        models: [],
      },
    },
  },
  "brave-search": {
    serviceKinds: ["webSearch"],
    mediaConfig: {
      webSearch: {
        baseUrl: "https://api.search.brave.com/res/v1",
        authType: "apikey",
        authHeader: "x-subscription-token",
        format: "brave",
        models: [],
      },
    },
  },
  serper: {
    serviceKinds: ["webSearch"],
    mediaConfig: {
      webSearch: {
        baseUrl: "https://google.serper.dev",
        authType: "apikey",
        authHeader: "x-api-key",
        format: "serper",
        models: [],
      },
    },
  },
  exa: {
    serviceKinds: ["webSearch", "webFetch"],
    mediaConfig: {
      webSearch: {
        baseUrl: "https://api.exa.ai/search",
        authType: "apikey",
        authHeader: "x-api-key",
        format: "exa",
        models: [],
      },
      webFetch: {
        baseUrl: "https://api.exa.ai/contents",
        authType: "apikey",
        authHeader: "x-api-key",
        format: "exa",
        models: [],
      },
    },
  },
  firecrawl: {
    serviceKinds: ["webFetch"],
    mediaConfig: {
      webFetch: {
        baseUrl: "https://api.firecrawl.dev/v1/scrape",
        authType: "apikey",
        authHeader: "bearer",
        format: "firecrawl",
        models: [],
      },
    },
  },
  "jina-reader": {
    serviceKinds: ["webFetch"],
    mediaConfig: {
      webFetch: {
        baseUrl: "https://r.jina.ai",
        authType: "apikey",
        authHeader: "bearer",
        format: "jina",
        models: [],
      },
    },
  },
  "google-tts": {
    serviceKinds: ["tts"],
    mediaConfig: {
      tts: {
        baseUrl: "google-tts",
        authType: "none",
        authHeader: "none",
        format: "google-tts",
        models: [
          { id: "en", displayName: "English" },
          { id: "vi", displayName: "Vietnamese" },
          { id: "ja", displayName: "Japanese" },
          { id: "ko", displayName: "Korean" },
          { id: "zh-CN", displayName: "Chinese (Simplified)" },
          { id: "fr", displayName: "French" },
          { id: "de", displayName: "German" },
          { id: "es", displayName: "Spanish" },
        ],
      },
    },
  },
  "edge-tts": {
    serviceKinds: ["tts"],
    mediaConfig: {
      tts: {
        baseUrl: "edge-tts",
        authType: "none",
        authHeader: "none",
        format: "edge-tts",
        models: [
          { id: "vi-VN-HoaiMyNeural", displayName: "Vietnamese - Hoai My" },
          { id: "vi-VN-NamMinhNeural", displayName: "Vietnamese - Nam Minh" },
          { id: "en-US-JennyNeural", displayName: "English US - Jenny" },
          { id: "en-US-GuyNeural", displayName: "English US - Guy" },
          { id: "en-GB-SoniaNeural", displayName: "English UK - Sonia" },
          { id: "ja-JP-NanamiNeural", displayName: "Japanese - Nanami" },
          { id: "ko-KR-SunHiNeural", displayName: "Korean - Sun Hi" },
          { id: "zh-CN-XiaoxiaoNeural", displayName: "Chinese - Xiaoxiao" },
        ],
      },
    },
  },
};

/**
 * Scan all provider instances and auto-apply media config for any that:
 * 1. Have a type matching a known media-capable provider in MEDIA_CATALOG
 * 2. Do NOT already have serviceKinds set (to avoid overwriting user config)
 *
 * Also auto-creates provider instances for noAuth providers (google-tts,
 * edge-tts, searxng) that don't require user setup but need to exist in
 * the registry for MediaRouter to find them.
 *
 * Returns the number of instances that were updated or created.
 */
export function autoSyncMediaConfig(
  registry: ProviderRuntimeRegistry
): number {
  let updated = 0;
  const instances = registry.listProviderInstances();
  const existingTypes = new Set(instances.map((i) => i.type));

  // 1. Update existing instances that are missing serviceKinds.
  for (const instance of instances) {
    if (instance.serviceKinds && instance.serviceKinds.length > 0) continue;
    const catalogEntry = MEDIA_CATALOG[instance.type];
    if (!catalogEntry) continue;
    registry.updateProviderInstance(instance.id, {
      serviceKinds: catalogEntry.serviceKinds,
      mediaConfig: catalogEntry.mediaConfig as Record<MediaKind, MediaServiceConfig>,
    });
    updated++;
  }

  // 2. Auto-create instances for noAuth providers that don't exist yet.
  const NO_AUTH_PROVIDERS = ["google-tts", "edge-tts", "searxng"];
  for (const providerType of NO_AUTH_PROVIDERS) {
    if (existingTypes.has(providerType)) continue;
    const catalogEntry = MEDIA_CATALOG[providerType];
    if (!catalogEntry) continue;

    const instance = {
      id: `provider_${providerType.replace(/-/g, "_")}_auto`,
      type: providerType,
      name: providerType === "google-tts" ? "Google TTS"
        : providerType === "edge-tts" ? "Edge TTS"
        : providerType === "searxng" ? "SearXNG"
        : providerType,
      enabled: true,
      config: {} as Record<string, unknown>,
      defaultTimeoutMs: 30000,
      maxRetries: 1,
      cooldownMs: 60000,
      accountSelectionStrategy: "round_robin" as const,
      maxConcurrentRequests: 20,
      maxConcurrentRequestsPerAccount: 3,
      circuitBreaker: {
        enabled: false,
        failureThreshold: 5,
        cooldownMs: 60000,
        halfOpenMaxRequests: 1,
      },
      createdAt: new Date(),
      updatedAt: new Date(),
      serviceKinds: catalogEntry.serviceKinds,
      mediaConfig: catalogEntry.mediaConfig as Record<MediaKind, MediaServiceConfig>,
    };

    registry.registerProviderInstance(instance);
    updated++;
  }

  return updated;
}
