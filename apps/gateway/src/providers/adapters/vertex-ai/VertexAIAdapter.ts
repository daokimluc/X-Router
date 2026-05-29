import { createSign, randomUUID } from "node:crypto";
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
import { applyChannelOverrides, applyChannelInputPolicies, interpretStatusCode } from "../../../utils/channelOverride.js";
import { fetchWithProxy } from "../../../proxy/fetchWithProxy.js";

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

type GeminiPart =
  | { text: string }
  | { functionCall: { name: string; args: Record<string, unknown> } }
  | { functionResponse: { name: string; response: Record<string, unknown> } };

type GeminiContent = {
  role: "user" | "model";
  parts: GeminiPart[];
};

type GeminiTool = {
  functionDeclarations: Array<{
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  }>;
};

type GeminiToolConfig = {
  functionCallingConfig: { mode: string; allowedFunctionNames?: string[] };
};

type GeminiRequest = {
  contents: GeminiContent[];
  systemInstruction?: { parts: Array<{ text: string }> };
  generationConfig?: {
    temperature?: number;
    maxOutputTokens?: number;
    stopSequences?: string[];
  };
  tools?: GeminiTool[];
  toolConfig?: GeminiToolConfig;
};

type GeminiCandidate = {
  content?: {
    role?: string;
    parts?: Array<{
      text?: string;
      functionCall?: { name: string; args: Record<string, unknown> };
    }>;
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
      flags: ["chat", "streaming", "tool_calling"]
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

    // Phase 25 — apply input policies on the OpenAI request before transforming
    // to Gemini shape (system prompt + token limit).
    const policiedRequest = applyChannelInputPolicies(
      request as unknown as Record<string, unknown>,
      context.providerInstance
    ) as unknown as OpenAIChatCompletionRequest;

    const geminiRequest = this.transformToGemini(policiedRequest);
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
      const response = await fetchWithProxy(
        url,
        {
          method: "POST",
          headers: finalHeaders,
          body: JSON.stringify(finalBody),
          signal: abortController.signal
        },
        context.proxyOptions,
        this.fetchImpl
      );

      if (!response.ok) {
        throw await this.classifyHttpError(response, url, timeoutMs, context.providerInstance);
      }

      // Streaming response
      if (request.stream) {
        if (!response.body) {
          throw new ProviderUnavailableError(this.type, 502);
        }
        clearTimeout(timeout);
        return this.createSSEStream(response.body, model);
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

    for (const message of request.messages as Array<Record<string, unknown>>) {
      const role = message.role as string;
      const rawContent = message.content;

      if (role === "system") {
        const text =
          typeof rawContent === "string" ? rawContent : JSON.stringify(rawContent);
        systemInstruction = { parts: [{ text }] };
        continue;
      }

      // OpenAI tool result → Gemini functionResponse part.
      if (role === "tool") {
        const toolCallId = (message.tool_call_id as string | undefined) ?? "";
        const text =
          typeof rawContent === "string" ? rawContent : JSON.stringify(rawContent);
        contents.push({
          role: "user",
          parts: [
            {
              functionResponse: {
                name: toolCallId || "tool",
                response: { result: text }
              }
            }
          ]
        });
        continue;
      }

      const geminiRole: "user" | "model" = role === "assistant" ? "model" : "user";
      const parts: GeminiPart[] = [];

      if (role === "assistant") {
        const toolCalls = message.tool_calls as
          | Array<{ id?: string; function?: { name?: string; arguments?: string } }>
          | undefined;
        const text = this.extractTextContent(message as OpenAIChatMessage);
        if (text) parts.push({ text });
        if (toolCalls && toolCalls.length > 0) {
          for (const call of toolCalls) {
            let args: Record<string, unknown> = {};
            const argsStr = call.function?.arguments ?? "";
            if (argsStr.trim().length > 0) {
              try {
                const parsed = JSON.parse(argsStr);
                if (parsed && typeof parsed === "object") args = parsed as Record<string, unknown>;
              } catch {
                args = { _raw: argsStr };
              }
            }
            parts.push({ functionCall: { name: call.function?.name ?? "", args } });
          }
        }
      } else {
        const text = this.extractTextContent(message as OpenAIChatMessage);
        parts.push({ text });
      }

      if (parts.length > 0) {
        contents.push({ role: geminiRole, parts });
      }
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

    if (request.tools && request.tools.length > 0) {
      geminiRequest.tools = [
        { functionDeclarations: request.tools.map(translateOpenAIToolToGemini) }
      ];
    }
    if (request.tool_choice !== undefined) {
      geminiRequest.toolConfig = translateToolChoiceToGemini(request.tool_choice);
    }

    return geminiRequest;
  }

  /**
   * Transform Gemini generateContent response to NormalizedOpenAIResponse.
   */
  transformFromGemini(response: GeminiResponse, model: string): NormalizedOpenAIResponse {
    const candidate = response.candidates?.[0];
    const parts = candidate?.content?.parts ?? [];
    const textParts: string[] = [];
    const toolCalls: Array<{
      id: string;
      type: "function";
      function: { name: string; arguments: string };
    }> = [];
    for (const p of parts) {
      if (typeof p.text === "string") {
        textParts.push(p.text);
      } else if (p.functionCall) {
        toolCalls.push({
          id: `call_${randomUUID().slice(0, 8)}`,
          type: "function",
          function: {
            name: p.functionCall.name,
            arguments: JSON.stringify(p.functionCall.args ?? {})
          }
        });
      }
    }
    const finishReason = this.mapFinishReason(candidate?.finishReason);

    const message: NormalizedOpenAIResponse["choices"][number]["message"] = {
      role: "assistant",
      content: textParts.join("")
    };
    if (toolCalls.length > 0) message.tool_calls = toolCalls;

    const result: NormalizedOpenAIResponse = {
      id: `chatcmpl-vertex-${Date.now()}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [
        {
          index: 0,
          message,
          finish_reason: toolCalls.length > 0 ? "tool_calls" : finishReason
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

  /**
   * Convert the upstream Gemini SSE stream into OpenAI-shaped SSE chunks.
   * Previously this yielded raw Gemini JSON lines, which the route then wrapped
   * into delta.content — corrupting the payload for OpenAI clients. Now each
   * Gemini chunk is translated into a proper chat.completion.chunk, surfacing
   * text deltas and functionCall parts as tool_calls deltas.
   */
  private async *createSSEStream(
    body: ReadableStream<Uint8Array>,
    model: string
  ): ProviderStream {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const completionId = `chatcmpl-vertex-${randomUUID().slice(0, 8)}`;
    let toolCallCount = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("data: ")) continue;

          const jsonStr = trimmed.slice(6);
          if (jsonStr === "[DONE]") {
            yield "data: [DONE]\n\n";
            continue;
          }

          try {
            const geminiChunk = JSON.parse(jsonStr) as GeminiResponse;
            const candidate = geminiChunk.candidates?.[0];
            const parts = candidate?.content?.parts ?? [];
            const textParts: string[] = [];
            const toolCallChunks: Array<{
              index: number;
              id: string;
              name: string;
              arguments: string;
            }> = [];
            for (const p of parts) {
              if (typeof p.text === "string") textParts.push(p.text);
              else if (p.functionCall) {
                const idx = toolCallCount;
                toolCallCount += 1;
                toolCallChunks.push({
                  index: idx,
                  id: `call_${randomUUID().slice(0, 8)}`,
                  name: p.functionCall.name,
                  arguments: JSON.stringify(p.functionCall.args ?? {})
                });
              }
            }

            const delta = textParts.join("");
            if (!delta && toolCallChunks.length === 0 && !candidate?.finishReason) {
              continue;
            }

            const deltaObj: Record<string, unknown> = {};
            if (delta) deltaObj.content = delta;
            if (toolCallChunks.length > 0) {
              deltaObj.tool_calls = toolCallChunks.map((tc) => ({
                index: tc.index,
                id: tc.id,
                type: "function",
                function: { name: tc.name, arguments: tc.arguments }
              }));
            }

            const mappedFinish = candidate?.finishReason
              ? this.mapFinishReason(candidate.finishReason)
              : null;
            const finishReason: "stop" | "length" | "tool_calls" | "content_filter" | null =
              mappedFinish === "stop" && toolCallCount > 0 ? "tool_calls" : mappedFinish;

            const openaiChunk = {
              id: completionId,
              object: "chat.completion.chunk",
              created: Math.floor(Date.now() / 1000),
              model,
              choices: [
                {
                  index: 0,
                  delta: deltaObj,
                  finish_reason: finishReason
                }
              ]
            };

            yield `data: ${JSON.stringify(openaiChunk)}\n\n`;
          } catch {
            // Skip malformed JSON chunks
          }
        }
      }

      const final = decoder.decode();
      if (final) buffer += final;
      if (buffer.trim()) {
        const trimmed = buffer.trim();
        if (trimmed.startsWith("data: ") && trimmed.slice(6) === "[DONE]") {
          yield "data: [DONE]\n\n";
        }
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

/**
 * OpenAI tool `{ type:"function", function:{ name, description, parameters } }`
 * → Gemini functionDeclaration `{ name, description, parameters }`.
 */
function translateOpenAIToolToGemini(tool: Record<string, unknown>): {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
} {
  if (tool.type === "function" && tool.function && typeof tool.function === "object") {
    const fn = tool.function as Record<string, unknown>;
    return {
      name: typeof fn.name === "string" ? fn.name : "",
      description: typeof fn.description === "string" ? fn.description : undefined,
      parameters:
        fn.parameters && typeof fn.parameters === "object"
          ? (fn.parameters as Record<string, unknown>)
          : undefined
    };
  }
  return { name: typeof tool.name === "string" ? tool.name : "" };
}

/**
 * OpenAI tool_choice → Gemini toolConfig.functionCallingConfig.
 * "auto"→AUTO, "none"→NONE, "required"/"any"→ANY, {function:{name}}→ANY+allowedFunctionNames.
 */
function translateToolChoiceToGemini(
  choice: string | Record<string, unknown>
): { functionCallingConfig: { mode: string; allowedFunctionNames?: string[] } } {
  if (typeof choice === "string") {
    const upper = choice.toUpperCase();
    if (upper === "NONE") return { functionCallingConfig: { mode: "NONE" } };
    if (upper === "REQUIRED" || upper === "ANY") return { functionCallingConfig: { mode: "ANY" } };
    return { functionCallingConfig: { mode: "AUTO" } };
  }
  if (choice.type === "function" && choice.function && typeof choice.function === "object") {
    const fn = choice.function as { name?: unknown };
    return {
      functionCallingConfig: {
        mode: "ANY",
        allowedFunctionNames: typeof fn.name === "string" ? [fn.name] : []
      }
    };
  }
  return { functionCallingConfig: { mode: "AUTO" } };
}
