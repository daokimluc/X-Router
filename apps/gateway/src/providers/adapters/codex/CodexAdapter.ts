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
import type { ProviderInstance } from "../../base/ProviderInstance.js";
import { applyChannelOverrides, applyChannelInputPolicies, interpretStatusCode } from "../../../utils/channelOverride.js";
import { fetchWithProxy } from "../../../proxy/fetchWithProxy.js";

// ─── Types ─────────────────────────────────────────────────

export type CodexCredential = {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
};

// ─── Constants ─────────────────────────────────────────────

const CODEX_BASE_URL = "https://chatgpt.com/backend-api/codex/responses";
const CODEX_TOKEN_ENDPOINT = "https://auth.openai.com/oauth/token";
const CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const DEFAULT_TIMEOUT_MS = 60_000;

const CODEX_HEADERS = {
  "originator": "codex-cli",
  "User-Agent": "codex-cli/1.0.18 (Windows; x64)"
};

const DEFAULT_INSTRUCTIONS = "You are a helpful coding assistant. Follow the user's instructions carefully.";

// ─── Adapter ───────────────────────────────────────────────

export class CodexAdapter implements AIProviderAdapter {
  readonly type = "codex";

  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  getCapabilities(): ProviderCapabilities {
    return {
      protocols: ["openai_chat_completions"],
      flags: ["chat", "streaming", "tool_calling"]
    };
  }

  async validateConfig(_config: Record<string, unknown>): Promise<void> {}

  async validateCredential(payload: Record<string, unknown>): Promise<void> {
    if (!payload.accessToken || typeof payload.accessToken !== "string") {
      throw new ProviderConfigError("Codex credential requires a valid accessToken string");
    }
  }

  async listModels(_context: ProviderContext): Promise<ProviderModel[]> {
    return [
      { id: "gpt-5.4", displayName: "GPT-5.4", upstreamModel: "gpt-5.4" },
      { id: "gpt-5.3-codex", displayName: "GPT-5.3 Codex", upstreamModel: "gpt-5.3-codex" },
      { id: "o4-mini", displayName: "o4-mini", upstreamModel: "o4-mini" },
      { id: "o3", displayName: "o3", upstreamModel: "o3" },
    ];
  }

  async chatCompletions(
    request: OpenAIChatCompletionRequest,
    context: ProviderRequestContext
  ): Promise<NormalizedOpenAIResponse | ProviderStream> {
    const credential = (context.credentialPayload ?? {}) as CodexCredential;

    // Phase 25 — apply maxInputTokens + systemPromptOverride on the OpenAI-shape
    // request before converting to Codex format.
    const policied = applyChannelInputPolicies(
      request as unknown as Record<string, unknown>,
      context.providerInstance
    );

    // Transform OpenAI chat completions → Codex Responses API format
    const codexBody = this.transformToCodexFormat(policied as OpenAIChatCompletionRequest);
    const url = CODEX_BASE_URL;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${credential.accessToken}`,
      ...CODEX_HEADERS,
      "session_id": `sess_${randomUUID().slice(0, 8)}`,
      "Accept": "text/event-stream"
    };

    const { body: finalBody, headers: finalHeaders } = applyChannelOverrides(
      codexBody as unknown as Record<string, unknown>,
      headers,
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

      // Codex always streams — parse SSE and convert to OpenAI format
      if (!response.body) {
        throw new ProviderUnavailableError(this.type, 502);
      }
      clearTimeout(timeout);

      // If caller wants streaming, return as ProviderStream (OpenAI SSE format)
      if (request.stream) {
        return this.createOpenAIStreamFromCodexSSE(response.body, request.model);
      }

      // Non-streaming: collect all chunks and build final response
      return await this.collectCodexResponse(response.body, request.model);
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
    throw new UnsupportedCapabilityError("Codex adapter does not support Anthropic Messages protocol");
  }

  async healthCheck(context: ProviderContext): Promise<ProviderHealth> {
    const credential = (context.credentialPayload ?? {}) as CodexCredential;
    if (!credential.accessToken) {
      return { status: "down", message: "No access token" };
    }
    // Simple validation — try a minimal request
    try {
      const response = await this.fetchImpl(CODEX_BASE_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${credential.accessToken}`,
          ...CODEX_HEADERS,
          "session_id": "health-check"
        },
        body: JSON.stringify({
          model: "gpt-5.4",
          instructions: "Reply OK",
          input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] }],
          stream: true,
          store: false,
          reasoning: { effort: "none", summary: "auto" }
        })
      });
      if (response.status === 200) return { status: "ok" };
      if (response.status === 401 || response.status === 403) {
        return { status: "down", message: "Access token expired" };
      }
      return { status: "degraded", message: `HTTP ${response.status}` };
    } catch {
      return { status: "down", message: "Connection failed" };
    }
  }

  async refreshSession(
    _account: ProviderAccount,
    context: ProviderContext
  ): Promise<SessionRefreshResult> {
    const credential = (context.credentialPayload ?? {}) as CodexCredential;

    if (!credential.refreshToken) {
      return { refreshed: false, disabled: true, message: "No refresh token", authError: true };
    }

    try {
      const response = await this.fetchImpl(CODEX_TOKEN_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: credential.refreshToken,
          client_id: CODEX_CLIENT_ID
        }).toString()
      });

      if (response.status === 400 || response.status === 401) {
        return { refreshed: false, disabled: true, message: "Refresh token expired", authError: true };
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

  // ─── Transform OpenAI Chat Completions → Codex Responses API ───

  private transformToCodexFormat(request: OpenAIChatCompletionRequest): Record<string, unknown> {
    // Convert messages to Responses API input format
    const input: Array<Record<string, unknown>> = [];
    let instructions = DEFAULT_INSTRUCTIONS;

    for (const msg of request.messages) {
      if (msg.role === "system") {
        instructions = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
        continue;
      }

      const content: Array<Record<string, unknown>> = [];
      if (typeof msg.content === "string") {
        content.push({ type: "input_text", text: msg.content });
      } else if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (part.type === "text") {
            content.push({ type: "input_text", text: part.text as string });
          } else {
            content.push({ type: "input_text", text: JSON.stringify(part) });
          }
        }
      }

      if (content.length > 0) {
        input.push({
          type: "message",
          role: msg.role === "assistant" ? "assistant" : "user",
          content
        });
      }
    }

    // Ensure input is non-empty
    if (input.length === 0) {
      input.push({
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "..." }]
      });
    }

    return {
      model: request.model,
      instructions,
      input,
      stream: true,
      store: false,
      reasoning: { effort: "low", summary: "auto" },
      include: ["reasoning.encrypted_content"]
    };
  }

  // ─── Parse Codex SSE → OpenAI SSE format ───────────────────

  private async *createOpenAIStreamFromCodexSSE(
    body: ReadableStream<Uint8Array>,
    model: string
  ): ProviderStream {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const completionId = `chatcmpl-cx-${randomUUID().slice(0, 8)}`;

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
            const event = JSON.parse(jsonStr);
            const delta = this.extractDeltaFromCodexEvent(event);
            if (!delta) continue;

            const openaiChunk = {
              id: completionId,
              object: "chat.completion.chunk",
              created: Math.floor(Date.now() / 1000),
              model,
              choices: [{
                index: 0,
                delta: delta.content ? { content: delta.content } : {},
                finish_reason: delta.done ? "stop" : null
              }]
            };

            yield `data: ${JSON.stringify(openaiChunk)}\n\n`;
          } catch {
            // Skip malformed events
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  // ─── Collect full response (non-streaming) ─────────────────

  private async collectCodexResponse(
    body: ReadableStream<Uint8Array>,
    model: string
  ): Promise<NormalizedOpenAIResponse> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let fullContent = "";

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
          if (jsonStr === "[DONE]") continue;

          try {
            const event = JSON.parse(jsonStr);
            const delta = this.extractDeltaFromCodexEvent(event);
            if (delta?.content) {
              fullContent += delta.content;
            }
          } catch {
            // Skip
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    return {
      id: `chatcmpl-cx-${randomUUID().slice(0, 8)}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [{
        index: 0,
        message: { role: "assistant", content: fullContent },
        finish_reason: "stop"
      }]
    };
  }

  // ─── Extract text delta from Codex SSE event ───────────────

  private extractDeltaFromCodexEvent(event: Record<string, unknown>): { content?: string; done?: boolean } | null {
    // Codex Responses API events:
    // response.output_text.delta → { type: "response.output_text.delta", delta: "text" }
    // response.completed → done
    const type = event.type as string;

    if (type === "response.output_text.delta") {
      return { content: event.delta as string };
    }

    if (type === "response.output_text.done") {
      return { done: true };
    }

    if (type === "response.completed" || type === "response.done") {
      return { done: true };
    }

    // Also handle output_item content parts
    if (type === "response.content_part.delta") {
      const delta = event.delta as Record<string, unknown> | undefined;
      if (delta?.text) return { content: delta.text as string };
    }

    return null;
  }

  // ─── Error classification ──────────────────────────────────

  private async classifyHttpError(response: Response, url: string, timeoutMs: number, instance?: ProviderInstance) {
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
