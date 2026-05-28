import type { AIProviderAdapter } from "../../base/AIProviderAdapter.js";
import type { ProviderCapabilities } from "../../base/ProviderCapabilities.js";
import {
  ProviderAuthError,
  ProviderRateLimitError,
  ProviderTimeoutError,
  ProviderUnavailableError,
  UnsupportedCapabilityError
} from "../../base/ProviderErrors.js";
import { applyChannelOverrides, applyChannelInputPolicies, interpretStatusCode } from "../../../utils/channelOverride.js";
import { fetchWithProxy } from "../../../proxy/fetchWithProxy.js";
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

/**
 * Headers that MUST NOT be included in outgoing requests.
 * NoAuthAdapter explicitly strips these to ensure no auth leakage.
 */
const AUTH_HEADERS_BLOCKLIST = [
  "authorization",
  "x-api-key",
  "api-key",
  "cookie",
  "x-session-token"
];

/**
 * NoAuthAdapter — adapter for providers that require no authentication.
 * Forwards requests without any auth headers.
 * Used for providers like OpenCode Free.
 */
export class NoAuthAdapter implements AIProviderAdapter {
  readonly type = "no_auth";

  private readonly defaultTimeoutMs = 30_000;
  private readonly healthCheckTimeoutMs = 10_000;

  getCapabilities(): ProviderCapabilities {
    return {
      protocols: ["openai_chat_completions"],
      flags: ["chat", "streaming"]
    };
  }

  async validateConfig(config: Record<string, unknown>): Promise<void> {
    if (!config.baseUrl || typeof config.baseUrl !== "string") {
      throw new Error("NoAuth provider config requires a valid baseUrl string");
    }
  }

  async validateCredential(_payload: Record<string, unknown>): Promise<void> {
    // No credentials required — always passes
  }

  async listModels(context: ProviderContext): Promise<ProviderModel[]> {
    const baseUrl = this.getBaseUrl(context);
    const url = `${baseUrl}/v1/models`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.defaultTimeoutMs);

    try {
      const response = await fetch(url, {
        method: "GET",
        headers: this.buildHeaders(),
        signal: controller.signal
      });

      if (response.status === 404) {
        return [];
      }

      if (response.status >= 500) {
        throw new ProviderUnavailableError("no_auth", response.status);
      }

      if (!response.ok) {
        return [];
      }

      const data = (await response.json()) as {
        object?: string;
        data?: Array<{ id: string; created?: number; owned_by?: string }>;
      };

      if (data.object === "list" && Array.isArray(data.data)) {
        return data.data.map((model) => ({
          id: model.id,
          displayName: model.id,
          upstreamModel: model.id
        }));
      }

      return [];
    } catch (error: unknown) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new ProviderTimeoutError("no_auth", baseUrl, this.defaultTimeoutMs);
      }
      if (error instanceof ProviderUnavailableError) {
        throw error;
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
    const baseUrl = this.getBaseUrl(context);
    const url = `${baseUrl}/v1/chat/completions`;

    const baseHeaders = this.buildHeaders({ "content-type": "application/json" });
    const policied = applyChannelInputPolicies(
      request as unknown as Record<string, unknown>,
      context.providerInstance
    );
    const { body: finalBody, headers: finalHeaders } = applyChannelOverrides(
      policied,
      baseHeaders,
      context.providerInstance
    );

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.defaultTimeoutMs);

    try {
      const response = await fetchWithProxy(
        url,
        {
          method: "POST",
          headers: finalHeaders,
          body: JSON.stringify(finalBody),
          signal: controller.signal
        },
        context.proxyOptions
      );

      if (!response.ok) {
        const action = interpretStatusCode(context.providerInstance, response.status);
        if (action === "disable") {
          throw new ProviderAuthError("no_auth", `Status ${response.status} mapped to disable`);
        }
        if (action === "retry") {
          throw new ProviderRateLimitError("no_auth", undefined);
        }
        throw new ProviderUnavailableError("no_auth", response.status);
      }

      // Streaming response
      if (request.stream && response.body) {
        return this.createStream(response);
      }

      // Non-streaming response
      const data = (await response.json()) as NormalizedOpenAIResponse;
      return data;
    } catch (error: unknown) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new ProviderTimeoutError("no_auth", baseUrl, this.defaultTimeoutMs);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async messages(
    _request: AnthropicMessagesRequest,
    _context: ProviderRequestContext
  ): Promise<NormalizedAnthropicResponse | ProviderStream> {
    throw new UnsupportedCapabilityError(
      "NoAuthAdapter does not support Anthropic Messages protocol"
    );
  }

  async healthCheck(context: ProviderContext): Promise<ProviderHealth> {
    const baseUrl = this.getBaseUrl(context);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.healthCheckTimeoutMs);

    try {
      const response = await fetch(baseUrl, {
        method: "GET",
        headers: this.buildHeaders(),
        signal: controller.signal
      });

      if (response.ok || response.status < 500) {
        return { status: "ok", message: `baseUrl reachable (HTTP ${response.status})` };
      }

      return {
        status: "degraded",
        message: `baseUrl returned HTTP ${response.status}`
      };
    } catch (error: unknown) {
      if (error instanceof Error && error.name === "AbortError") {
        return { status: "down", message: `Health check timeout after ${this.healthCheckTimeoutMs}ms` };
      }
      const msg = error instanceof Error ? error.message : "Unknown error";
      return { status: "down", message: `Cannot reach baseUrl: ${msg}` };
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Build headers ensuring NO auth-related headers are present.
   * Accepts optional extra headers (e.g., content-type).
   */
  private buildHeaders(extra?: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = {};

    if (extra) {
      for (const [key, value] of Object.entries(extra)) {
        const lowerKey = key.toLowerCase();
        // Ensure no auth headers sneak in via extra
        if (!AUTH_HEADERS_BLOCKLIST.includes(lowerKey)) {
          headers[key] = value;
        }
      }
    }

    return headers;
  }

  /**
   * Extract baseUrl from provider context.
   */
  private getBaseUrl(context: ProviderContext): string {
    const baseUrl =
      (context.providerInstance.config.baseUrl as string) ||
      context.providerInstance.baseUrl;

    if (!baseUrl) {
      throw new Error("NoAuthAdapter requires a baseUrl in provider instance config");
    }

    // Remove trailing slash
    return baseUrl.replace(/\/+$/, "");
  }

  /**
   * Create an async iterable stream from a fetch Response for SSE streaming.
   */
  private createStream(response: Response): ProviderStream {
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();

    return {
      async *[Symbol.asyncIterator]() {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            yield decoder.decode(value, { stream: true });
          }
        } finally {
          reader.releaseLock();
        }
      }
    };
  }
}
