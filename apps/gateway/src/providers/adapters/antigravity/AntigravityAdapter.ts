import { randomUUID } from "node:crypto";
import type { AIProviderAdapter } from "../../base/AIProviderAdapter.js";
import type { ProviderCapabilities } from "../../base/ProviderCapabilities.js";
import type { ProviderAccount } from "../../base/ProviderAccount.js";
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
  ProviderStream,
  SessionRefreshResult
} from "../../base/types.js";

// ─── Types ─────────────────────────────────────────────────

export type AntigravityCredential = {
  accessToken: string;
  refreshToken?: string;
  projectId?: string;
  expiresAt?: string;
};

type GeminiContent = {
  role: "user" | "model";
  parts: GeminiPart[];
};

type GeminiPart =
  | { text: string }
  | { functionCall: { name: string; args: Record<string, unknown> } }
  | { functionResponse: { name: string; response: Record<string, unknown> } };

type GeminiRequest = {
  project: string;
  model: string;
  userAgent: string;
  requestType: string;
  requestId: string;
  request: {
    contents: GeminiContent[];
    generationConfig?: {
      maxOutputTokens?: number;
      temperature?: number;
      topP?: number;
      stopSequences?: string[];
    };
    tools?: Array<{
      functionDeclarations: Array<{
        name: string;
        description?: string;
        parameters?: Record<string, unknown>;
      }>;
    }>;
    toolConfig?: {
      functionCallingConfig: { mode: string };
    };
    sessionId?: string;
  };
};

type GeminiCandidate = {
  content?: {
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

// ─── Constants ─────────────────────────────────────────────

const ANTIGRAVITY_BASE_URL = "https://daily-cloudcode-pa.googleapis.com";
const ANTIGRAVITY_STREAM_PATH = "/v1internal:streamGenerateContent?alt=sse";
const ANTIGRAVITY_GENERATE_PATH = "/v1internal:generateContent";
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GOOGLE_CLIENT_ID = "1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com";
const GOOGLE_CLIENT_SECRET = "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";
const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_OUTPUT_TOKENS = 16384;

const INTERNAL_HEADERS = {
  "User-Agent": "antigravity/1.107.0 win32/x64",
  "x-request-source": "local",
  "X-Server-Timeout": "600"
};

// ─── Adapter ───────────────────────────────────────────────

export class AntigravityAdapter implements AIProviderAdapter {
  readonly type = "antigravity";

  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  getCapabilities(): ProviderCapabilities {
    return {
      protocols: ["openai_chat_completions"],
      flags: ["chat", "streaming", "tool_calling"]
    };
  }

  async validateConfig(config: Record<string, unknown>): Promise<void> {
    // Antigravity uses Google OAuth, no special config needed
  }

  async validateCredential(payload: Record<string, unknown>): Promise<void> {
    if (!payload.accessToken || typeof payload.accessToken !== "string") {
      throw new ProviderConfigError(
        "Antigravity credential requires a valid accessToken string"
      );
    }
  }

  async listModels(_context: ProviderContext): Promise<ProviderModel[]> {
    return [
      { id: "gemini-2.5-pro", displayName: "Gemini 2.5 Pro", upstreamModel: "gemini-2.5-pro" },
      { id: "gemini-2.5-flash", displayName: "Gemini 2.5 Flash", upstreamModel: "gemini-2.5-flash" },
      { id: "gemini-2.0-flash", displayName: "Gemini 2.0 Flash", upstreamModel: "gemini-2.0-flash" },
      { id: "claude-sonnet-4-5", displayName: "Claude Sonnet 4.5", upstreamModel: "claude-sonnet-4-5" },
    ];
  }

  async chatCompletions(
    request: OpenAIChatCompletionRequest,
    context: ProviderRequestContext
  ): Promise<NormalizedOpenAIResponse | ProviderStream> {
    const credential = (context.credentialPayload ?? {}) as AntigravityCredential;
    const model = request.model;
    const stream = request.stream ?? false;

    const geminiRequest = this.transformToGemini(request, credential);
    const url = `${ANTIGRAVITY_BASE_URL}${stream ? ANTIGRAVITY_STREAM_PATH : ANTIGRAVITY_GENERATE_PATH}`;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${credential.accessToken}`,
      ...INTERNAL_HEADERS,
      "Accept": stream ? "text/event-stream" : "application/json"
    };

    const requestBody = JSON.stringify(geminiRequest);

    const abortController = new AbortController();
    const timeoutMs = context.providerInstance.defaultTimeoutMs || DEFAULT_TIMEOUT_MS;
    const timeout = setTimeout(() => abortController.abort(), timeoutMs);

    try {
      const response = await this.fetchImpl(url, {
        method: "POST",
        headers,
        body: requestBody,
        signal: abortController.signal
      });

      if (!response.ok) {
        throw await this.classifyHttpError(response, url, timeoutMs);
      }

      if (stream) {
        if (!response.body) {
          throw new ProviderUnavailableError(this.type, 502);
        }
        clearTimeout(timeout);
        return this.createOpenAIStreamFromGeminiSSE(response.body, model);
      }

      // Non-streaming: parse Gemini response and convert to OpenAI format
      const geminiResponse = (await response.json()) as GeminiResponse;
      return this.transformFromGemini(geminiResponse, model);
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
      "Antigravity adapter does not support Anthropic Messages protocol"
    );
  }

  async healthCheck(context: ProviderContext): Promise<ProviderHealth> {
    const credential = (context.credentialPayload ?? {}) as AntigravityCredential;
    if (!credential.accessToken) {
      return { status: "down", message: "No access token" };
    }

    // Simple token validation via a lightweight request
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), 10_000);

    try {
      const response = await this.fetchImpl(
        `${ANTIGRAVITY_BASE_URL}/v1internal:generateContent`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${credential.accessToken}`,
            ...INTERNAL_HEADERS
          },
          body: JSON.stringify({
            project: "health-check",
            model: "gemini-2.5-flash",
            userAgent: "antigravity",
            requestType: "agent",
            requestId: `health-${randomUUID()}`,
            request: {
              contents: [{ role: "user", parts: [{ text: "hi" }] }],
              generationConfig: { maxOutputTokens: 1 }
            }
          }),
          signal: abortController.signal
        }
      );

      if (response.status === 200) return { status: "ok" };
      if (response.status === 401 || response.status === 403) {
        return { status: "down", message: "Access token expired" };
      }
      return { status: "degraded", message: `HTTP ${response.status}` };
    } catch {
      return { status: "down", message: "Connection failed" };
    } finally {
      clearTimeout(timeout);
    }
  }

  async refreshSession(
    _account: ProviderAccount,
    context: ProviderContext
  ): Promise<SessionRefreshResult> {
    const credential = (context.credentialPayload ?? {}) as AntigravityCredential;

    if (!credential.refreshToken) {
      return { refreshed: false, disabled: true, message: "No refresh token", authError: true };
    }

    try {
      const response = await this.fetchImpl(GOOGLE_TOKEN_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: credential.refreshToken,
          client_id: GOOGLE_CLIENT_ID,
          client_secret: GOOGLE_CLIENT_SECRET
        }).toString()
      });

      if (response.status === 400 || response.status === 401) {
        return { refreshed: false, disabled: true, message: "Refresh token revoked", authError: true };
      }

      if (!response.ok) {
        return { refreshed: false, message: `Token refresh failed (HTTP ${response.status})` };
      }

      const tokens = (await response.json()) as {
        access_token: string;
        refresh_token?: string;
        expires_in?: number;
      };

      const expiresAt = tokens.expires_in
        ? new Date(Date.now() + tokens.expires_in * 1000)
        : undefined;

      return {
        refreshed: true,
        credentialPayload: {
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token ?? credential.refreshToken,
          projectId: credential.projectId,
          expiresAt: expiresAt?.toISOString()
        },
        expiresAt
      };
    } catch (error) {
      return {
        refreshed: false,
        message: `Refresh error: ${error instanceof Error ? error.message : "unknown"}`
      };
    }
  }

  // ─── Transform OpenAI → Gemini ─────────────────────────────

  private transformToGemini(
    request: OpenAIChatCompletionRequest,
    credential: AntigravityCredential
  ): Record<string, unknown> {
    const contents: GeminiContent[] = [];
    let systemInstruction = "";

    for (const msg of request.messages) {
      if (msg.role === "system") {
        systemInstruction += typeof msg.content === "string"
          ? msg.content
          : JSON.stringify(msg.content);
        continue;
      }

      const role: "user" | "model" = msg.role === "assistant" ? "model" : "user";
      const parts: GeminiPart[] = [];

      if (typeof msg.content === "string") {
        parts.push({ text: msg.content });
      } else if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (part.type === "text") {
            parts.push({ text: part.text as string });
          } else {
            parts.push({ text: JSON.stringify(part) });
          }
        }
      }

      if (parts.length > 0) {
        contents.push({ role, parts });
      }
    }

    // Prepend system instruction as first user message if present
    if (systemInstruction) {
      contents.unshift({
        role: "user",
        parts: [{ text: `[System Instructions]\n${systemInstruction}` }]
      });
      // Add a model acknowledgment to maintain alternating roles
      if (contents.length > 1 && contents[1].role === "user") {
        contents.splice(1, 0, {
          role: "model",
          parts: [{ text: "Understood." }]
        });
      }
    }

    const generationConfig: Record<string, unknown> = {};
    if (request.max_tokens) {
      generationConfig.maxOutputTokens = Math.min(request.max_tokens, MAX_OUTPUT_TOKENS);
    } else {
      generationConfig.maxOutputTokens = MAX_OUTPUT_TOKENS;
    }
    if (request.temperature !== undefined) {
      generationConfig.temperature = request.temperature;
    }

    // Antigravity uses a wrapper format with project/model/request fields
    return {
      project: credential.projectId ?? this.generateProjectId(),
      model: request.model,
      userAgent: "antigravity",
      requestType: "agent",
      requestId: `agent-${randomUUID()}`,
      request: {
        contents,
        generationConfig,
        sessionId: randomUUID()
      }
    };
  }

  // ─── Transform Gemini → OpenAI ─────────────────────────────

  private transformFromGemini(
    geminiResponse: GeminiResponse,
    requestedModel: string
  ): NormalizedOpenAIResponse {
    const candidate = geminiResponse.candidates?.[0];
    const textParts = candidate?.content?.parts
      ?.filter((p): p is { text: string } => "text" in p)
      .map((p) => p.text) ?? [];

    const content = textParts.join("");
    const finishReason = this.mapFinishReason(candidate?.finishReason);

    return {
      id: `chatcmpl-ag-${randomUUID().slice(0, 8)}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: requestedModel,
      choices: [{
        index: 0,
        message: { role: "assistant", content },
        finish_reason: finishReason
      }],
      usage: {
        prompt_tokens: geminiResponse.usageMetadata?.promptTokenCount ?? 0,
        completion_tokens: geminiResponse.usageMetadata?.candidatesTokenCount ?? 0,
        total_tokens: geminiResponse.usageMetadata?.totalTokenCount ?? 0
      }
    };
  }

  // ─── Streaming: Gemini SSE → OpenAI SSE ────────────────────

  private async *createOpenAIStreamFromGeminiSSE(
    body: ReadableStream<Uint8Array>,
    model: string
  ): ProviderStream {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const completionId = `chatcmpl-ag-${randomUUID().slice(0, 8)}`;

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
            const textParts = candidate?.content?.parts
              ?.filter((p): p is { text: string } => "text" in p)
              .map((p) => p.text) ?? [];

            const delta = textParts.join("");
            if (!delta && !candidate?.finishReason) continue;

            const openaiChunk = {
              id: completionId,
              object: "chat.completion.chunk",
              created: Math.floor(Date.now() / 1000),
              model,
              choices: [{
                index: 0,
                delta: delta ? { content: delta } : {},
                finish_reason: candidate?.finishReason
                  ? this.mapFinishReason(candidate.finishReason)
                  : null
              }]
            };

            yield `data: ${JSON.stringify(openaiChunk)}\n\n`;
          } catch {
            // Skip malformed JSON chunks
          }
        }
      }

      // Process remaining buffer
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

  // ─── Helpers ───────────────────────────────────────────────

  private mapFinishReason(
    geminiReason?: string
  ): "stop" | "length" | "tool_calls" | "content_filter" | null {
    if (!geminiReason) return null;
    switch (geminiReason) {
      case "STOP": return "stop";
      case "MAX_TOKENS": return "length";
      case "SAFETY": return "content_filter";
      case "TOOL_CALLS": return "tool_calls";
      default: return "stop";
    }
  }

  private generateProjectId(): string {
    const adj = ["useful", "bright", "swift", "calm", "bold"][Math.floor(Math.random() * 5)];
    const noun = ["fuze", "wave", "spark", "flow", "core"][Math.floor(Math.random() * 5)];
    return `${adj}-${noun}-${randomUUID().slice(0, 5)}`;
  }

  private async classifyHttpError(
    response: Response,
    url: string,
    timeoutMs: number
  ) {
    const status = response.status;
    if (status === 401 || status === 403) {
      return new ProviderAuthError(this.type, "Access token expired or invalid");
    }
    if (status === 429) {
      const retryAfter = response.headers.get("retry-after");
      const seconds = retryAfter ? parseInt(retryAfter, 10) : undefined;
      return new ProviderRateLimitError(this.type, Number.isNaN(seconds) ? undefined : seconds);
    }
    if (status >= 500) {
      return new ProviderUnavailableError(this.type, status);
    }
    return new ProviderUnavailableError(this.type, status);
  }
}
