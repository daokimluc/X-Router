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

export type AzureOpenAIConfig = {
  resourceName: string;
  deploymentName: string;
  apiVersion: string;
};

export type AzureOpenAICredential = {
  apiKey: string;
};

const DEFAULT_TIMEOUT_MS = 30_000;
const HEALTH_CHECK_TIMEOUT_MS = 10_000;
const DEFAULT_API_VERSION = "2024-02-01";

export class AzureOpenAIAdapter implements AIProviderAdapter {
  readonly type = "azure_openai";

  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  getCapabilities(): ProviderCapabilities {
    return {
      protocols: ["openai_chat_completions"],
      flags: ["chat", "streaming"]
    };
  }

  async validateConfig(config: Record<string, unknown>): Promise<void> {
    if (!config.resourceName || typeof config.resourceName !== "string") {
      throw new ProviderConfigError(
        "AzureOpenAI config requires a valid resourceName string"
      );
    }

    if (!config.deploymentName || typeof config.deploymentName !== "string") {
      throw new ProviderConfigError(
        "AzureOpenAI config requires a valid deploymentName string"
      );
    }

    if (config.apiVersion !== undefined && typeof config.apiVersion !== "string") {
      throw new ProviderConfigError(
        "AzureOpenAI config apiVersion must be a string"
      );
    }
  }

  async validateCredential(payload: Record<string, unknown>): Promise<void> {
    if (!payload.apiKey || typeof payload.apiKey !== "string") {
      throw new ProviderConfigError(
        "AzureOpenAI credential requires a valid apiKey string"
      );
    }
  }

  async listModels(_context: ProviderContext): Promise<ProviderModel[]> {
    // Azure OpenAI doesn't have a standard /v1/models endpoint
    // Models are managed via Azure portal deployments
    return [];
  }

  async chatCompletions(
    request: OpenAIChatCompletionRequest,
    context: ProviderRequestContext
  ): Promise<NormalizedOpenAIResponse | ProviderStream> {
    const config = context.providerInstance.config as AzureOpenAIConfig;
    const credential = (context.credentialPayload ?? {}) as AzureOpenAICredential;
    const url = this.buildChatCompletionsUrl(config);

    const abortController = new AbortController();
    const timeoutMs = context.providerInstance.defaultTimeoutMs || DEFAULT_TIMEOUT_MS;
    const timeout = setTimeout(() => abortController.abort(), timeoutMs);

    try {
      const response = await this.fetchImpl(url, {
        method: "POST",
        headers: {
          "api-key": credential.apiKey,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(request),
        signal: abortController.signal
      });

      if (!response.ok) {
        throw await this.classifyHttpError(response, config);
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
        const baseUrl = `https://${config.resourceName}.openai.azure.com`;
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
      "AzureOpenAI adapter does not support Anthropic Messages protocol"
    );
  }

  async healthCheck(context: ProviderContext): Promise<ProviderHealth> {
    const config = context.providerInstance.config as AzureOpenAIConfig;
    const credential = (context.credentialPayload ?? {}) as AzureOpenAICredential;
    const url = this.buildChatCompletionsUrl(config);

    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), HEALTH_CHECK_TIMEOUT_MS);

    try {
      // Azure doesn't have /v1/models — use a minimal chat completion request
      const response = await this.fetchImpl(url, {
        method: "POST",
        headers: {
          "api-key": credential.apiKey,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
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
          message: `Authentication failed: api-key is invalid or resource "${config.resourceName}" does not exist`
        };
      }

      if (response.status === 404) {
        return {
          status: "down",
          message: `Deployment "${config.deploymentName}" not found on resource "${config.resourceName}"`
        };
      }

      return {
        status: "degraded",
        message: `Azure OpenAI returned HTTP ${response.status}`
      };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return {
          status: "degraded",
          message: `Health check timed out after ${HEALTH_CHECK_TIMEOUT_MS}ms`
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

  private buildChatCompletionsUrl(config: AzureOpenAIConfig): string {
    const apiVersion = config.apiVersion || DEFAULT_API_VERSION;
    return `https://${config.resourceName}.openai.azure.com/openai/deployments/${config.deploymentName}/chat/completions?api-version=${apiVersion}`;
  }

  private async classifyHttpError(
    response: Response,
    config: AzureOpenAIConfig
  ): Promise<ProviderAuthError | ProviderRateLimitError | ProviderTimeoutError | ProviderUnavailableError> {
    const status = response.status;

    if (status === 401 || status === 403) {
      return new ProviderAuthError(
        this.type,
        `api-key is invalid or resource "${config.resourceName}" does not exist`
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
