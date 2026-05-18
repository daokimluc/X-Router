import type { AIProviderAdapter } from "../../base/AIProviderAdapter.js";
import type { ProviderCapabilities } from "../../base/ProviderCapabilities.js";
import {
  ProviderAuthError,
  ProviderConfigError,
  ProviderRateLimitError,
  ProviderTimeoutError,
  ProviderUnavailableError,
  UnsupportedCapabilityError
} from "../../base/ProviderErrors.js";
import type {
  AnthropicMessagesRequest,
  NormalizedAnthropicResponse,
  NormalizedOpenAIResponse,
  OpenAIChatCompletionRequest,
  ProviderContext,
  ProviderHealth,
  ProviderModel,
  ProviderRequestContext,
  ProviderStream
} from "../../base/types.js";
import { ModelCache } from "../../services/ModelCache.js";

export type GenericOpenAIConfig = {
  baseUrl: string;
  chatCompletionsPath?: string;
  modelsPath?: string;
  apiVersion?: string;
};

export type GenericOpenAICredential = {
  apiKey: string;
};

const DEFAULT_TIMEOUT_MS = 30_000;
const CHAT_COMPLETIONS_PATH = "/v1/chat/completions";

export class GenericOpenAIAdapter implements AIProviderAdapter {
  readonly type = "generic_openai";
  private readonly modelCache: ModelCache;

  constructor(
    private readonly fetchImpl: typeof fetch = fetch,
    modelCache?: ModelCache
  ) {
    this.modelCache = modelCache ?? new ModelCache();
  }

  getCapabilities(): ProviderCapabilities {
    return {
      protocols: ["openai_chat_completions"],
      flags: ["chat", "streaming"]
    };
  }

  async validateConfig(config: Record<string, unknown>): Promise<void> {
    if (!config.baseUrl || typeof config.baseUrl !== "string") {
      throw new ProviderConfigError(
        "GenericOpenAI config requires a valid baseUrl string"
      );
    }

    if (config.chatCompletionsPath && typeof config.chatCompletionsPath !== "string") {
      throw new ProviderConfigError(
        "GenericOpenAI config chatCompletionsPath must be a string"
      );
    }

    if (config.modelsPath && typeof config.modelsPath !== "string") {
      throw new ProviderConfigError(
        "GenericOpenAI config modelsPath must be a string"
      );
    }
  }

  async validateCredential(payload: Record<string, unknown>): Promise<void> {
    if (!payload.apiKey || typeof payload.apiKey !== "string") {
      throw new ProviderConfigError(
        "GenericOpenAI credential requires a valid apiKey string"
      );
    }
  }

  async listModels(context: ProviderContext): Promise<ProviderModel[]> {
    const config = context.providerInstance.config as GenericOpenAIConfig;
    const credential = (context.credentialPayload ?? {}) as GenericOpenAICredential;
    const baseUrl = config.baseUrl;
    const modelsPath = config.modelsPath ?? "/v1/models";
    const url = `${baseUrl.replace(/\/$/, "")}${modelsPath}`;
    const cacheKey = context.providerInstance.id;

    // Check cache first
    const cached = this.modelCache.get(cacheKey);
    if (cached !== null) {
      return cached;
    }

    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), DEFAULT_TIMEOUT_MS);

    try {
      const response = await this.fetchImpl(url, {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${credential.apiKey}`,
          "Content-Type": "application/json"
        },
        signal: abortController.signal
      });

      if (response.status === 404) {
        return [];
      }

      if (response.status === 401 || response.status === 403) {
        throw new ProviderAuthError(
          this.type,
          "API key is invalid or expired"
        );
      }

      if (!response.ok) {
        return [];
      }

      const body = (await response.json()) as {
        object?: string;
        data?: Array<{
          id: string;
          created?: number;
          owned_by?: string;
        }>;
      };

      if (!body.data || !Array.isArray(body.data)) {
        return [];
      }

      const models: ProviderModel[] = body.data.map((model) => ({
        id: model.id,
        displayName: model.id,
        upstreamModel: model.id
      }));

      // Store in cache
      this.modelCache.set(cacheKey, models);

      return models;
    } catch (error) {
      if (error instanceof ProviderAuthError) {
        throw error;
      }
      if (error instanceof Error && error.name === "AbortError") {
        throw new ProviderTimeoutError(this.type, baseUrl, DEFAULT_TIMEOUT_MS);
      }
      return [];
    } finally {
      clearTimeout(timeout);
    }
  }

  async chatCompletions(
    request: OpenAIChatCompletionRequest,
    context: ProviderRequestContext
  ): Promise<NormalizedOpenAIResponse | ProviderStream> {
    const config = context.providerInstance.config as GenericOpenAIConfig;
    const credential = (context.credentialPayload ?? {}) as GenericOpenAICredential;
    const baseUrl = config.baseUrl;
    const path = config.chatCompletionsPath ?? CHAT_COMPLETIONS_PATH;
    const url = `${baseUrl.replace(/\/$/, "")}${path}`;

    const abortController = new AbortController();
    const timeoutMs = context.providerInstance.defaultTimeoutMs || DEFAULT_TIMEOUT_MS;
    const timeout = setTimeout(() => abortController.abort(), timeoutMs);

    try {
      const response = await this.fetchImpl(url, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${credential.apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(request),
        signal: abortController.signal
      });

      if (!response.ok) {
        throw await this.classifyHttpError(response, baseUrl, timeoutMs);
      }

      // Streaming response
      if (request.stream) {
        if (!response.body) {
          throw new ProviderUnavailableError(this.type, 502);
        }
        clearTimeout(timeout);
        return this.createSSEStream(response.body);
      }

      // Non-streaming response
      const body = (await response.json()) as NormalizedOpenAIResponse;
      return body;
    } catch (error) {
      if (
        error instanceof ProviderAuthError ||
        error instanceof ProviderRateLimitError ||
        error instanceof ProviderTimeoutError ||
        error instanceof ProviderUnavailableError
      ) {
        throw error;
      }

      if (error instanceof Error && error.name === "AbortError") {
        throw new ProviderTimeoutError(this.type, baseUrl, timeoutMs);
      }

      throw new ProviderUnavailableError(this.type, 502);
    } finally {
      clearTimeout(timeout);
    }
  }

  async messages(
    _request: AnthropicMessagesRequest,
    _context: ProviderRequestContext
  ): Promise<NormalizedAnthropicResponse | ProviderStream> {
    throw new UnsupportedCapabilityError(
      "GenericOpenAI adapter does not support Anthropic Messages protocol"
    );
  }

  async healthCheck(context: ProviderContext): Promise<ProviderHealth> {
    const config = context.providerInstance.config as GenericOpenAIConfig;
    const credential = (context.credentialPayload ?? {}) as GenericOpenAICredential;
    const baseUrl = config.baseUrl;
    const modelsPath = config.modelsPath ?? "/v1/models";
    const url = `${baseUrl.replace(/\/$/, "")}${modelsPath}`;

    const abortController = new AbortController();
    const healthTimeout = 10_000;
    const timeout = setTimeout(() => abortController.abort(), healthTimeout);

    try {
      const response = await this.fetchImpl(url, {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${credential.apiKey}`,
          "Content-Type": "application/json"
        },
        signal: abortController.signal
      });

      if (response.status === 200) {
        return { status: "ok" };
      }

      if (response.status === 401 || response.status === 403) {
        return {
          status: "down",
          message: "Authentication failed: API key is invalid or expired"
        };
      }

      if (response.status === 404) {
        // Fallback: try a minimal chat completion request
        return this.healthCheckFallback(config, credential);
      }

      return {
        status: "degraded",
        message: `Provider returned HTTP ${response.status}`
      };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return {
          status: "degraded",
          message: `Health check timed out after ${healthTimeout}ms`
        };
      }
      return {
        status: "down",
        message: `Connection failed: ${error instanceof Error ? error.message : "unknown error"}`
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  private async healthCheckFallback(
    config: GenericOpenAIConfig,
    credential: GenericOpenAICredential
  ): Promise<ProviderHealth> {
    const baseUrl = config.baseUrl;
    const path = config.chatCompletionsPath ?? CHAT_COMPLETIONS_PATH;
    const url = `${baseUrl.replace(/\/$/, "")}${path}`;

    const abortController = new AbortController();
    const healthTimeout = 10_000;
    const timeout = setTimeout(() => abortController.abort(), healthTimeout);

    try {
      const response = await this.fetchImpl(url, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${credential.apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "gpt-3.5-turbo",
          messages: [{ role: "user", content: "hi" }],
          max_tokens: 1
        }),
        signal: abortController.signal
      });

      if (response.status === 200) {
        return { status: "ok" };
      }

      if (response.status === 401 || response.status === 403) {
        return {
          status: "down",
          message: "Authentication failed: API key is invalid or expired"
        };
      }

      return {
        status: "degraded",
        message: `Provider returned HTTP ${response.status}`
      };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return {
          status: "degraded",
          message: `Health check timed out after ${healthTimeout}ms`
        };
      }
      return {
        status: "down",
        message: `Connection failed: ${error instanceof Error ? error.message : "unknown error"}`
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  private async classifyHttpError(
    response: Response,
    baseUrl: string,
    timeoutMs: number
  ): Promise<ProviderAuthError | ProviderRateLimitError | ProviderTimeoutError | ProviderUnavailableError> {
    const status = response.status;

    if (status === 401 || status === 403) {
      return new ProviderAuthError(
        this.type,
        "API key is invalid or expired"
      );
    }

    if (status === 429) {
      const retryAfterHeader = response.headers.get("retry-after");
      const retryAfterSeconds = retryAfterHeader
        ? parseInt(retryAfterHeader, 10)
        : undefined;
      return new ProviderRateLimitError(
        this.type,
        Number.isNaN(retryAfterSeconds) ? undefined : retryAfterSeconds
      );
    }

    if (status >= 500) {
      return new ProviderUnavailableError(this.type, status);
    }

    return new ProviderUnavailableError(this.type, status);
  }

  private async *createSSEStream(
    body: ReadableStream<Uint8Array>
  ): ProviderStream {
    const reader = body.getReader();
    const decoder = new TextDecoder();

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        const chunk = decoder.decode(value, { stream: true });
        if (chunk) {
          yield chunk;
        }
      }

      const final = decoder.decode();
      if (final) {
        yield final;
      }
    } finally {
      reader.releaseLock();
    }
  }
}
