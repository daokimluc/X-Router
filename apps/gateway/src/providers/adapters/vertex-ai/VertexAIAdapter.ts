import { createSign } from "node:crypto";
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
  OpenAIChatMessage,
  ProviderContext,
  ProviderHealth,
  ProviderModel,
  ProviderRequestContext,
  ProviderStream
} from "../../base/types.js";
import type { ProviderInstance } from "../../base/ProviderInstance.js";
import { applyChannelOverrides, interpretStatusCode } from "../../../utils/channelOverride.js";

// --- Types ---

export type VertexAIConfig = {
  projectId: string;
  region: string;
};

export type VertexAICredential = {
  serviceAccountJson: string;
  accessToken?: string;
  tokenExpiresAt?: string;
};

export type ServiceAccountJSON = {
  type: "service_account";
  project_id: string;
  private_key_id: string;
  private_key: string;
  client_email: string;
  token_uri: string;
};

type GeminiContent = {
  role: "user" | "model";
  parts: Array<{ text: string }>;
};

type GeminiRequest = {
  contents: GeminiContent[];
  systemInstruction?: { parts: Array<{ text: string }> };
  generationConfig?: {
    temperature?: number;
    maxOutputTokens?: number;
    stopSequences?: string[];
  };
};

type GeminiCandidate = {
  content: {
    role: string;
    parts: Array<{ text: string }>;
  };
  finishReason?: string;
};

type GeminiResponse = {
  candidates?: GeminiCandidate[];
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
};

type CachedToken = {
  accessToken: string;
  expiresAt: number;
};

// --- Constants ---

const DEFAULT_TIMEOUT_MS = 30_000;
const HEALTH_CHECK_TIMEOUT_MS = 10_000;
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000; // 5 minutes
const TOKEN_LIFETIME_SECONDS = 3600; // 1 hour
const GOOGLE_OAUTH_SCOPE = "https://www.googleapis.com/auth/cloud-platform";

/**
 * VertexAIAdapter — adapter for Google Vertex AI (Gemini models).
 *
 * Handles:
 * - Service account JSON → JWT → OAuth2 access token generation
 * - OpenAI format → Gemini generateContent format transformation
 * - Gemini response → NormalizedOpenAIResponse transformation
 * - Auto-refresh token when < 5 minutes remaining
 * - Permission denied (403) → message about aiplatform.endpoints.predict
 */
export class VertexAIAdapter implements AIProviderAdapter {
  readonly type = "vertex_ai";

  private tokenCache: Map<string, CachedToken> = new Map();

  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  getCapabilities(): ProviderCapabilities {
    return {
      protocols: ["openai_chat_completions"],
      flags: ["chat", "streaming"]
    };
  }

  async validateConfig(config: Record<string, unknown>): Promise<void> {
    if (!config.projectId || typeof config.projectId !== "string") {
      throw new ProviderConfigError(
        "Vertex AI config requires a valid projectId string"
      );
    }
    if (!config.region || typeof config.region !== "string") {
      throw new ProviderConfigError(
        "Vertex AI config requires a valid region string"
      );
    }
  }

  async validateCredential(payload: Record<string, unknown>): Promise<void> {
    if (!payload.serviceAccountJson || typeof payload.serviceAccountJson !== "string") {
      throw new ProviderConfigError(
        "Vertex AI credential requires a valid serviceAccountJson string"
      );
    }

    try {
      const sa = JSON.parse(payload.serviceAccountJson as string) as Record<string, unknown>;
      if (sa.type !== "service_account") {
        throw new ProviderConfigError(
          "Vertex AI service account JSON must have type \"service_account\""
        );
      }
      if (!sa.private_key || typeof sa.private_key !== "string") {
        throw new ProviderConfigError(
          "Vertex AI service account JSON must contain a valid private_key"
        );
      }
      if (!sa.client_email || typeof sa.client_email !== "string") {
        throw new ProviderConfigError(
          "Vertex AI service account JSON must contain a valid client_email"
        );
      }
      if (!sa.token_uri || typeof sa.token_uri !== "string") {
        throw new ProviderConfigError(
          "Vertex AI service account JSON must contain a valid token_uri"
        );
      }
    } catch (error) {
      if (error instanceof ProviderConfigError) {
        throw error;
      }
      throw new ProviderConfigError(
        "Vertex AI serviceAccountJson is not valid JSON"
      );
    }
  }

  async listModels(_context: ProviderContext): Promise<ProviderModel[]> {
    // Vertex AI model discovery is complex and not standard.
    // Return empty array as per task instructions.
    return [];
  }

  async chatCompletions(
    request: OpenAIChatCompletionRequest,
    context: ProviderRequestContext
  ): Promise<NormalizedOpenAIResponse | ProviderStream> {
    const config = context.providerInstance.config as unknown as VertexAIConfig;
    const credential = (context.credentialPayload ?? {}) as VertexAICredential;

    const serviceAccount = this.parseServiceAccount(credential.serviceAccountJson);
    const accessToken = await this.getAccessToken(serviceAccount);

    const { region, projectId } = config;
    const model = request.model;

    // Determine endpoint based on streaming
    const action = request.stream ? "streamGenerateContent" : "generateContent";
    let url = `https://${region}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${region}/publishers/google/models/${model}:${action}`;

    if (request.stream) {
      url += "?alt=sse";
    }

    const geminiRequest = this.transformToGemini(request);
    const baseHeaders: Record<string, string> = {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    };
    const { body: finalBody, headers: finalHeaders } = applyChannelOverrides(
      geminiRequest as unknown as Record<string, unknown>,
      baseHeaders,
      context.providerInstance
    );

    const abortController = new AbortController();
    const timeoutMs = context.providerInstance.defaultTimeoutMs || DEFAULT_TIMEOUT_MS;
    const timeout = setTimeout(() => abortController.abort(), timeoutMs);

    try {
      const response = await this.fetchImpl(url, {
        method: "POST",
        headers: finalHeaders,
        body: JSON.stringify(finalBody),
        signal: abortController.signal
      });

      if (!response.ok) {
        throw await this.classifyHttpError(response, url, timeoutMs, context.providerInstance);
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
      const body = (await response.json()) as GeminiResponse;
      return this.transformFromGemini(body, model);
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
        throw new ProviderTimeoutError(this.type, url, timeoutMs);
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
      "VertexAI adapter does not support Anthropic Messages protocol"
    );
  }

  async healthCheck(context: ProviderContext): Promise<ProviderHealth> {
    const config = context.providerInstance.config as unknown as VertexAIConfig;
    const credential = (context.credentialPayload ?? {}) as VertexAICredential;

    try {
      const serviceAccount = this.parseServiceAccount(credential.serviceAccountJson);
      const accessToken = await this.getAccessToken(serviceAccount);

      const { region, projectId } = config;
      const url = `https://${region}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${region}/publishers/google/models`;

      const abortController = new AbortController();
      const timeout = setTimeout(() => abortController.abort(), HEALTH_CHECK_TIMEOUT_MS);

      try {
        const response = await this.fetchImpl(url, {
          method: "GET",
          headers: {
            "Authorization": `Bearer ${accessToken}`
          },
          signal: abortController.signal
        });

        if (response.ok) {
          return { status: "ok" };
        }

        if (response.status === 401 || response.status === 403) {
          return {
            status: "down",
            message: "Authentication failed: service account lacks aiplatform.endpoints.predict permission"
          };
        }

        return {
          status: "degraded",
          message: `Vertex AI returned HTTP ${response.status}`
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
    } catch (error) {
      return {
        status: "down",
        message: `Service account error: ${error instanceof Error ? error.message : "unknown error"}`
      };
    }
  }

  // --- Token Management ---

  /**
   * Get a valid OAuth2 access token, using cache if available and not expired.
   * Auto-refreshes when token has less than 5 minutes remaining.
   */
  async getAccessToken(serviceAccount: ServiceAccountJSON): Promise<string> {
    const cacheKey = serviceAccount.client_email;
    const cached = this.tokenCache.get(cacheKey);

    if (cached && cached.expiresAt - Date.now() > TOKEN_REFRESH_BUFFER_MS) {
      return cached.accessToken;
    }

    // Generate new token
    const jwt = this.createSignedJWT(serviceAccount);
    const accessToken = await this.exchangeJWTForToken(jwt, serviceAccount.token_uri);

    this.tokenCache.set(cacheKey, {
      accessToken,
      expiresAt: Date.now() + TOKEN_LIFETIME_SECONDS * 1000
    });

    return accessToken;
  }

  /**
   * Create a signed JWT for Google OAuth2 token exchange.
   */
  private createSignedJWT(serviceAccount: ServiceAccountJSON): string {
    const now = Math.floor(Date.now() / 1000);

    const header = {
      alg: "RS256",
      typ: "JWT",
      kid: serviceAccount.private_key_id
    };

    const payload = {
      iss: serviceAccount.client_email,
      scope: GOOGLE_OAUTH_SCOPE,
      aud: serviceAccount.token_uri,
      iat: now,
      exp: now + TOKEN_LIFETIME_SECONDS
    };

    const encodedHeader = this.base64urlEncode(JSON.stringify(header));
    const encodedPayload = this.base64urlEncode(JSON.stringify(payload));
    const signingInput = `${encodedHeader}.${encodedPayload}`;

    const sign = createSign("RSA-SHA256");
    sign.update(signingInput);
    const signature = sign.sign(serviceAccount.private_key, "base64url");

    return `${signingInput}.${signature}`;
  }

  /**
   * Exchange a signed JWT for an OAuth2 access token.
   */
  private async exchangeJWTForToken(jwt: string, tokenUri: string): Promise<string> {
    const body = new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt
    });

    const response = await this.fetchImpl(tokenUri, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: body.toString()
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new ProviderAuthError(
        this.type,
        `Failed to exchange JWT for access token (HTTP ${response.status}): ${errorText}`
      );
    }

    const data = (await response.json()) as { access_token?: string; expires_in?: number };

    if (!data.access_token) {
      throw new ProviderAuthError(
        this.type,
        "Token exchange response did not contain access_token"
      );
    }

    return data.access_token;
  }

  // --- Format Transformation ---

  /**
   * Transform OpenAI Chat Completions request to Gemini generateContent format.
   *
   * - system messages → systemInstruction
   * - user/assistant messages → contents with role mapping (assistant → model)
   * - temperature, max_tokens → generationConfig
   */
  transformToGemini(request: OpenAIChatCompletionRequest): GeminiRequest {
    const contents: GeminiContent[] = [];
    let systemInstruction: { parts: Array<{ text: string }> } | undefined;

    for (const message of request.messages) {
      if (message.role === "system") {
        const text = this.extractTextContent(message);
        systemInstruction = { parts: [{ text }] };
        continue;
      }

      const role = message.role === "assistant" ? "model" : "user";
      const text = this.extractTextContent(message);
      contents.push({ role, parts: [{ text }] });
    }

    const geminiRequest: GeminiRequest = { contents };

    if (systemInstruction) {
      geminiRequest.systemInstruction = systemInstruction;
    }

    // Map generation config
    if (request.temperature !== undefined || request.max_tokens !== undefined) {
      geminiRequest.generationConfig = {};
      if (request.temperature !== undefined) {
        geminiRequest.generationConfig.temperature = request.temperature;
      }
      if (request.max_tokens !== undefined) {
        geminiRequest.generationConfig.maxOutputTokens = request.max_tokens;
      }
    }

    return geminiRequest;
  }

  /**
   * Transform Gemini generateContent response to NormalizedOpenAIResponse.
   */
  transformFromGemini(response: GeminiResponse, model: string): NormalizedOpenAIResponse {
    const candidate = response.candidates?.[0];
    const text = candidate?.content?.parts?.[0]?.text ?? "";
    const finishReason = this.mapFinishReason(candidate?.finishReason);

    const result: NormalizedOpenAIResponse = {
      id: `chatcmpl-vertex-${Date.now()}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: text
          },
          finish_reason: finishReason
        }
      ]
    };

    if (response.usageMetadata) {
      result.usage = {
        prompt_tokens: response.usageMetadata.promptTokenCount ?? 0,
        completion_tokens: response.usageMetadata.candidatesTokenCount ?? 0,
        total_tokens: response.usageMetadata.totalTokenCount ?? 0
      };
    }

    return result;
  }

  // --- Private Helpers ---

  private parseServiceAccount(serviceAccountJson: string): ServiceAccountJSON {
    try {
      const sa = JSON.parse(serviceAccountJson) as ServiceAccountJSON;
      if (sa.type !== "service_account" || !sa.private_key || !sa.client_email || !sa.token_uri) {
        throw new ProviderConfigError(
          "Invalid service account JSON: missing required fields"
        );
      }
      return sa;
    } catch (error) {
      if (error instanceof ProviderConfigError) {
        throw error;
      }
      throw new ProviderConfigError(
        "Vertex AI serviceAccountJson is not valid JSON"
      );
    }
  }

  private extractTextContent(message: OpenAIChatMessage): string {
    if (typeof message.content === "string") {
      return message.content;
    }
    // For array content, extract text parts
    if (Array.isArray(message.content)) {
      return message.content
        .filter((part) => (part as Record<string, unknown>).type === "text")
        .map((part) => (part as Record<string, unknown>).text as string)
        .join("");
    }
    return "";
  }

  private mapFinishReason(
    geminiReason?: string
  ): "stop" | "length" | "tool_calls" | "content_filter" | null {
    if (!geminiReason) return null;

    switch (geminiReason) {
      case "STOP":
        return "stop";
      case "MAX_TOKENS":
        return "length";
      case "SAFETY":
      case "RECITATION":
        return "content_filter";
      default:
        return "stop";
    }
  }

  private async classifyHttpError(
    response: Response,
    url: string,
    timeoutMs: number,
    instance?: ProviderInstance
  ): Promise<ProviderAuthError | ProviderRateLimitError | ProviderTimeoutError | ProviderUnavailableError> {
    const status = response.status;

    if (instance) {
      const action = interpretStatusCode(instance, status);
      if (action === "disable") {
        return new ProviderAuthError(this.type, `Status ${status} mapped to disable`);
      }
      if (action === "retry") {
        return new ProviderRateLimitError(this.type, undefined);
      }
    }

    if (status === 401) {
      return new ProviderAuthError(
        this.type,
        "Service account credentials are invalid or expired"
      );
    }

    if (status === 403) {
      return new ProviderAuthError(
        this.type,
        "Permission denied. Ensure the service account has the aiplatform.endpoints.predict permission"
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

  private base64urlEncode(str: string): string {
    return Buffer.from(str, "utf8")
      .toString("base64url");
  }
}
