/**
 * Media Router
 *
 * Core routing logic for media kind requests. Finds providers by kind,
 * resolves model to a specific provider, selects an account via round-robin,
 * resolves proxy pool for the account, makes proxy-aware fetch to upstream,
 * and returns normalized response.
 *
 * Requirements: 6.3, 17.1, 17.2, 17.3, 17.4
 */

import type { ProviderRuntimeRegistry } from "../provider-runtime/ProviderRuntimeRegistry.js";
import type { ProxyPoolService } from "../proxy/ProxyPoolService.js";
import type { ProviderInstance } from "../providers/base/ProviderInstance.js";
import type { ProxyFetchOptions } from "../proxy/types.js";
import type { MediaKind, MediaServiceConfig } from "./types.js";
import type { SecretService } from "../services/SecretService.js";
import { MediaKindRegistry } from "./MediaKindRegistry.js";
import { proxyAwareFetch } from "../proxy/ProxyAwareFetch.js";
import { synthesizeGoogleTts } from "./handlers/tts/googleTts.js";
import { synthesizeEdgeTts } from "./handlers/tts/edgeTts.js";

/**
 * Static provider-type → alias map. Mirrors the dashboard catalog's `alias`
 * field so that model prefixes like "cx/gpt-5.5-image" resolve correctly
 * even when the provider instance doesn't carry `config.alias`.
 */
const PROVIDER_ALIAS_MAP: Record<string, string> = {
  codex: "cx",
  openai: "oa",
  gemini: "gm",
  anthropic: "an",
  cloudflare: "cf",
  github: "gh",
  minimax: "mm",
  openrouter: "or",
  groq: "gq",
  deepgram: "dg",
  elevenlabs: "el",
  "voyage-ai": "va",
  fireworks: "fw",
  together: "tg",
  nebius: "nb",
  nvidia: "nv",
  "jina-ai": "ja",
  mistral: "ms",
  nanobanana: "nn",
  huggingface: "hf",
  falai: "fa",
  stability: "st",
  bfl: "bf",
  recraft: "rc",
  topaz: "tz",
  runway: "rw",
  perplexity: "px",
  tavily: "tv",
  brave: "bv",
  serper: "sp",
  exa: "ex",
  searxng: "sx",
  linkup: "lu",
  searchapi: "sa",
  youcom: "yc",
  firecrawl: "fc",
  kimi: "km",
  xai: "xa",
};

export type MediaRouteResult = {
  success: boolean;
  statusCode: number;
  body: unknown;
  headers?: Record<string, string>;
  isBinary?: boolean;
};

export class MediaRouter {
  private readonly registry: ProviderRuntimeRegistry;
  private readonly proxyPoolService: ProxyPoolService;
  private readonly kindRegistry: MediaKindRegistry;
  private readonly secretService?: SecretService;

  constructor(
    registry: ProviderRuntimeRegistry,
    proxyPoolService: ProxyPoolService,
    kindRegistry?: MediaKindRegistry,
    secretService?: SecretService
  ) {
    this.registry = registry;
    this.proxyPoolService = proxyPoolService;
    this.kindRegistry = kindRegistry ?? new MediaKindRegistry();
    this.secretService = secretService;
  }

  /**
   * Route a media request to the appropriate provider.
   *
   * @param kind - The media kind (embedding, image, tts, etc.)
   * @param model - The requested model (optional, may be null/undefined for default)
   * @param payload - The request payload (kind-specific)
   * @returns MediaRouteResult with the normalized response
   */
  async route(
    kind: MediaKind,
    model: string | undefined | null,
    payload: unknown
  ): Promise<MediaRouteResult> {
    // 1. Get the handler for this kind
    const handler = this.kindRegistry.getHandler(kind);
    if (!handler) {
      return {
        success: false,
        statusCode: 503,
        body: {
          error: {
            type: "no_provider_available",
            message: `No handler registered for media kind: ${kind}`,
            code: "no_handler",
          },
        },
      };
    }

    // 2. Find providers that support this kind
    const providers = this.findProvidersByKind(kind);
    if (providers.length === 0) {
      return {
        success: false,
        statusCode: 503,
        body: {
          error: {
            type: "no_provider_available",
            message: `No provider available for media kind: ${kind}`,
            code: "no_provider_available",
          },
        },
      };
    }

    // 3. Resolve model to a specific provider
    const resolved = this.resolveModelToProvider(kind, model, providers);
    if (!resolved) {
      const availableModels = this.listAvailableModels(kind, providers);
      return {
        success: false,
        statusCode: 404,
        body: {
          error: {
            type: "model_not_found",
            message: `Model '${model}' not found for media kind: ${kind}`,
            code: "model_not_found",
            available_models: availableModels,
          },
        },
      };
    }

    const { provider, resolvedModel, config } = resolved;

    // 4. Select an account from the provider's AccountPool
    // For noAuth providers (google-tts, edge-tts, etc.), skip account
    // selection — they don't need credentials.
    const isNoAuth = config.authType === "none";
    const accountPool = this.registry.getAccountPool(provider.id);

    if (!isNoAuth) {
      if (!accountPool) {
        return {
          success: false,
          statusCode: 503,
          body: {
            error: {
              type: "no_provider_available",
              message: `No account pool available for provider: ${provider.name}`,
              code: "no_account_pool",
            },
          },
        };
      }

      let lease;
      try {
        lease = accountPool.acquire({ model: resolvedModel });
      } catch {
        return {
          success: false,
          statusCode: 503,
          body: {
            error: {
              type: "no_provider_available",
              message: `No available account for provider: ${provider.name}`,
              code: "no_available_account",
            },
          },
        };
      }

      try {
        // 5. Resolve proxy pool for the account
        const proxyOptions = this.resolveProxyOptions(lease.account);

        // 6. Build the upstream request using the handler
        const credentials = this.extractCredentials(lease.account);
        const requestBuild = handler.buildRequest(
          config,
          resolvedModel,
          payload,
          credentials,
          { providerType: provider.type }
        );

        // 6b. Special TTS handlers (google-tts, edge-tts) that bypass
        // proxyAwareFetch and synthesize directly.
        if (requestBuild.url.startsWith("__special_tts__/")) {
          const result = await this.handleSpecialTts(requestBuild);
          lease.releaseSuccess();
          return result;
        }

        // 7. Make proxy-aware fetch to upstream
        const result = await proxyAwareFetch({
          url: requestBuild.url,
          method: requestBuild.method as "GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "HEAD",
          headers: requestBuild.headers,
          body: requestBuild.body,
          proxyOptions,
        });

        // 8. Normalize the response using the handler
        const normalized = handler.normalizeResponse(result.body, result.statusCode);

        // Mark success
        lease.releaseSuccess();

        // Determine if response is binary (e.g., TTS audio)
        const isBinary = Buffer.isBuffer(normalized);

        return {
          success: result.statusCode < 400,
          statusCode: result.statusCode,
          body: normalized,
          isBinary,
        };
      } catch (error) {
        // Mark failure
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        lease.releaseFailure(errorMessage);

        return {
          success: false,
          statusCode: 502,
          body: {
            error: {
              type: "upstream_error",
              message: errorMessage,
              code: "upstream_error",
            },
          },
        };
      }
    }

    // noAuth path — no account needed, call handler directly
    try {
      const requestBuild = handler.buildRequest(
        config,
        resolvedModel,
        payload,
        {},
        { providerType: provider.type }
      );

      // Special TTS handlers
      if (requestBuild.url.startsWith("__special_tts__/")) {
        return await this.handleSpecialTts(requestBuild);
      }

      // Standard proxyAwareFetch for noAuth providers with real URLs
      const result = await proxyAwareFetch({
        url: requestBuild.url,
        method: requestBuild.method as "GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "HEAD",
        headers: requestBuild.headers,
        body: requestBuild.body,
      });

      const normalized = handler.normalizeResponse(result.body, result.statusCode);
      const isBinary = Buffer.isBuffer(normalized);

      return {
        success: result.statusCode < 400,
        statusCode: result.statusCode,
        body: normalized,
        isBinary,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      return {
        success: false,
        statusCode: 502,
        body: {
          error: {
            type: "upstream_error",
            message: errorMessage,
            code: "upstream_error",
          },
        },
      };
    }
  }

  /**
   * Find all enabled provider instances that support the given media kind.
   */
  private findProvidersByKind(kind: MediaKind): ProviderInstance[] {
    const allProviders = this.registry.listProviderInstances();
    return allProviders.filter(
      (p) => p.enabled && p.serviceKinds?.includes(kind)
    );
  }

  /**
   * Resolve a model identifier to a specific provider and its config.
   *
   * Supports:
   * - Short form: "text-embedding-3-small"
   * - Provider-prefixed form: "openai/text-embedding-3-small"
   * - Default model selection when no model specified
   */
  private resolveModelToProvider(
    kind: MediaKind,
    model: string | undefined | null,
    providers: ProviderInstance[]
  ): { provider: ProviderInstance; resolvedModel: string; config: MediaServiceConfig } | null {
    // Handle provider-prefixed form (e.g., "openai/text-embedding-3-small")
    let providerPrefix: string | null = null;
    let modelId = model || null;

    if (modelId && modelId.includes("/")) {
      const slashIndex = modelId.indexOf("/");
      providerPrefix = modelId.slice(0, slashIndex);
      modelId = modelId.slice(slashIndex + 1);
    }

    for (const provider of providers) {
      const config = provider.mediaConfig?.[kind];
      if (!config) continue;

      // If provider prefix specified, match against provider type, name, or
      // the catalog alias (from config.alias or the static PROVIDER_ALIAS_MAP).
      if (providerPrefix) {
        const aliasFromConfig =
          typeof provider.config?.alias === "string"
            ? (provider.config.alias as string)
            : undefined;
        const aliasFromMap = PROVIDER_ALIAS_MAP[provider.type];
        const lowerPrefix = providerPrefix.toLowerCase();
        const matchesPrefix =
          provider.type.toLowerCase() === lowerPrefix ||
          provider.name.toLowerCase() === lowerPrefix ||
          aliasFromConfig?.toLowerCase() === lowerPrefix ||
          aliasFromMap?.toLowerCase() === lowerPrefix;
        if (!matchesPrefix) continue;
      }

      // If no model specified, use the default model for this provider
      if (!modelId) {
        const defaultModel = config.models.find((m) => m.isDefault) || config.models[0];
        if (defaultModel) {
          return { provider, resolvedModel: defaultModel.id, config };
        }
        continue;
      }

      // Check if this provider supports the requested model
      const matchedModel = config.models.find(
        (m) => m.id === modelId || m.id.toLowerCase() === modelId!.toLowerCase()
      );
      if (matchedModel) {
        return { provider, resolvedModel: matchedModel.id, config };
      }
    }

    // If no model was specified and we haven't found a default yet,
    // use the first provider's first model
    if (!model) {
      for (const provider of providers) {
        const config = provider.mediaConfig?.[kind];
        if (config && config.models.length > 0) {
          const defaultModel = config.models.find((m) => m.isDefault) || config.models[0];
          if (defaultModel) {
            return { provider, resolvedModel: defaultModel.id, config };
          }
        }
      }
    }

    return null;
  }

  /**
   * List all available models for a given kind across all providers.
   */
  private listAvailableModels(kind: MediaKind, providers: ProviderInstance[]): string[] {
    const models: string[] = [];
    for (const provider of providers) {
      const config = provider.mediaConfig?.[kind];
      if (config) {
        // Prefer alias over type for the prefix (matches dashboard display).
        const alias =
          (typeof provider.config?.alias === "string" ? provider.config.alias : null) ||
          PROVIDER_ALIAS_MAP[provider.type] ||
          provider.type;
        for (const m of config.models) {
          models.push(`${alias}/${m.id}`);
        }
      }
    }
    return models;
  }

  /**
   * Resolve proxy options from the account's providerSpecificData.
   */
  private resolveProxyOptions(
    account: { metadata?: Record<string, unknown> }
  ): ProxyFetchOptions | undefined {
    const proxyPoolId = (account.metadata as Record<string, unknown> | undefined)?.proxyPoolId as string | undefined;
    if (!proxyPoolId) return undefined;

    const pool = this.proxyPoolService.getById(proxyPoolId);
    if (!pool || !pool.isActive) return undefined;

    if (pool.type === "vercel") {
      return {
        enabled: true,
        vercelRelayUrl: pool.proxyUrl,
        noProxy: pool.noProxy || undefined,
        strictProxy: pool.strictProxy,
      };
    }

    return {
      enabled: true,
      url: pool.proxyUrl,
      noProxy: pool.noProxy || undefined,
      strictProxy: pool.strictProxy,
    };
  }

  /**
   * Handle special TTS formats (google-tts, edge-tts) that synthesize
   * directly without going through proxyAwareFetch.
   */
  private async handleSpecialTts(
    requestBuild: { url: string; body?: string | Buffer | null }
  ): Promise<MediaRouteResult> {
    const format = requestBuild.url.replace("__special_tts__/", "");
    const parsed = JSON.parse(
      typeof requestBuild.body === "string"
        ? requestBuild.body
        : requestBuild.body?.toString("utf-8") ?? "{}"
    ) as { input?: string; model?: string };

    const text = parsed.input || "";
    const model = parsed.model || "";

    let result: { base64: string; format: string };

    switch (format) {
      case "google-tts":
        result = await synthesizeGoogleTts(text, model);
        break;
      case "edge-tts":
        result = await synthesizeEdgeTts(text, model);
        break;
      default:
        return {
          success: false,
          statusCode: 501,
          body: {
            error: {
              type: "not_implemented",
              message: `Special TTS format '${format}' is not implemented`,
              code: "not_implemented",
            },
          },
        };
    }

    // Return base64 audio as binary buffer
    const audioBuffer = Buffer.from(result.base64, "base64");
    return {
      success: true,
      statusCode: 200,
      body: audioBuffer,
      isBinary: true,
      headers: {
        "content-type": `audio/${result.format}`,
        "content-length": String(audioBuffer.length),
      },
    };
  }

  /**
   * Extract credentials from the account for use in upstream requests.
   * Decrypts the credential payload from the SecretService when available.
   * Falls back to using credentialRef as a raw token (for tests/simple setups).
   */
  private extractCredentials(
    account: { id?: string; credentialRef: string; metadata?: Record<string, unknown> }
  ): Record<string, string> {
    // Try to decrypt from SecretService (production path).
    if (this.secretService && account.id) {
      try {
        const secret = this.secretService.getSecretForAccount(account.id);
        if (secret) {
          const payload = this.secretService.decryptSecretPayload(secret);
          // Return all string values from the decrypted payload.
          const result: Record<string, string> = {};
          for (const [key, value] of Object.entries(payload)) {
            if (typeof value === "string") {
              result[key] = value;
            }
          }
          // Ensure common aliases exist for handler compatibility.
          if (!result.apiKey && result.accessToken) result.apiKey = result.accessToken;
          if (!result.token && result.accessToken) result.token = result.accessToken;
          if (!result.accessToken && result.apiKey) result.accessToken = result.apiKey;
          return result;
        }
      } catch {
        // Fall through to credentialRef fallback.
      }
    }

    // Fallback: use credentialRef as a raw token.
    return {
      apiKey: account.credentialRef,
      token: account.credentialRef,
    };
  }
}
