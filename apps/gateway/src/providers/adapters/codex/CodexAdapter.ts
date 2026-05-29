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

    for (const msg of request.messages as Array<Record<string, unknown>>) {
      const role = msg.role as string;
      if (role === "system") {
        instructions =
          typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
        continue;
      }

      // OpenAI tool-result message → Codex function_call_output input item.
      if (role === "tool") {
        const toolCallId = (msg.tool_call_id as string | undefined) ?? "";
        const text =
          typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
        input.push({
          type: "function_call_output",
          call_id: toolCallId,
          output: text
        });
        continue;
      }

      // OpenAI assistant with tool_calls → Codex function_call input items.
      if (role === "assistant") {
        const toolCalls = msg.tool_calls as
          | Array<{ id?: string; function?: { name?: string; arguments?: string } }>
          | undefined;
        if (toolCalls && toolCalls.length > 0) {
          // Emit any text content first, then each function_call as a separate item.
          if (typeof msg.content === "string" && msg.content.length > 0) {
            input.push({
              type: "message",
              role: "assistant",
              content: [{ type: "input_text", text: msg.content }]
            });
          }
          for (const call of toolCalls) {
            input.push({
              type: "function_call",
              call_id: call.id ?? "",
              name: call.function?.name ?? "",
              arguments: call.function?.arguments ?? "{}"
            });
          }
          continue;
        }
      }

      const content: Array<Record<string, unknown>> = [];
      if (typeof msg.content === "string") {
        content.push({ type: "input_text", text: msg.content });
      } else if (Array.isArray(msg.content)) {
        for (const part of msg.content as Array<Record<string, unknown>>) {
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
          role: role === "assistant" ? "assistant" : "user",
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

    const out: Record<string, unknown> = {
      model: request.model,
      instructions,
      input,
      stream: true,
      store: false,
      reasoning: { effort: "low", summary: "auto" },
      include: ["reasoning.encrypted_content"]
    };
    // Codex Responses API tools: flat shape `[{type:"function", name, description, parameters}]`.
    if (request.tools && request.tools.length > 0) {
      out.tools = request.tools.map(translateOpenAIToolToCodex);
    }
    if (request.tool_choice !== undefined) {
      out.tool_choice = request.tool_choice;
    }
    return out;
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
    /**
     * Maps a Codex output_item index → OpenAI tool_calls index. Codex emits
     * function calls as separate output items; OpenAI streams them in
     * `choices[0].delta.tool_calls[<idx>]`. We assign indices in arrival order.
     */
    const toolCallIndex = new Map<number, number>();

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
            const evt = extractCodexEvent(event, toolCallIndex);
            if (!evt) continue;

            const delta: Record<string, unknown> = {};
            if (evt.kind === "text") delta.content = evt.text;
            else if (evt.kind === "tool_call_start") {
              delta.tool_calls = [
                {
                  index: evt.index,
                  id: evt.id,
                  type: "function",
                  function: { name: evt.name, arguments: "" }
                }
              ];
            } else if (evt.kind === "tool_call_delta") {
              delta.tool_calls = [
                {
                  index: evt.index,
                  function: { arguments: evt.partial }
                }
              ];
            }

            const finishReason: string | null = evt.kind === "done"
              ? evt.tool_calls
                ? "tool_calls"
                : "stop"
              : null;

            if (Object.keys(delta).length === 0 && finishReason === null) continue;

            const openaiChunk = {
              id: completionId,
              object: "chat.completion.chunk",
              created: Math.floor(Date.now() / 1000),
              model,
              choices: [
                {
                  index: 0,
                  delta,
                  finish_reason: finishReason
                }
              ]
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
    const toolCallIndex = new Map<number, number>();
    const toolCalls: Array<{ id: string; name: string; argsBuf: string }> = [];

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
            const evt = extractCodexEvent(event, toolCallIndex);
            if (!evt) continue;
            if (evt.kind === "text") {
              fullContent += evt.text;
            } else if (evt.kind === "tool_call_start") {
              toolCalls[evt.index] = { id: evt.id, name: evt.name, argsBuf: "" };
            } else if (evt.kind === "tool_call_delta") {
              if (toolCalls[evt.index]) {
                toolCalls[evt.index].argsBuf += evt.partial;
              }
            }
          } catch {
            // Skip
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    const message: NormalizedOpenAIResponse["choices"][number]["message"] = {
      role: "assistant",
      content: fullContent
    };
    const finishedToolCalls = toolCalls.filter(Boolean);
    if (finishedToolCalls.length > 0) {
      message.tool_calls = finishedToolCalls.map((tc) => ({
        id: tc.id,
        type: "function",
        function: {
          name: tc.name,
          arguments: tc.argsBuf
        }
      }));
    }

    return {
      id: `chatcmpl-cx-${randomUUID().slice(0, 8)}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [
        {
          index: 0,
          message,
          finish_reason: finishedToolCalls.length > 0 ? "tool_calls" : "stop"
        }
      ]
    };
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

/**
 * Translate an OpenAI-shape tool definition into Codex Responses API shape.
 * OpenAI: `{ type: "function", function: { name, description, parameters } }`.
 * Codex Responses API: `{ type: "function", name, description, parameters }`
 * (the function fields are flat, not nested).
 */
function translateOpenAIToolToCodex(tool: Record<string, unknown>): Record<string, unknown> {
  if (tool.type === "function" && tool.function && typeof tool.function === "object") {
    const fn = tool.function as Record<string, unknown>;
    return {
      type: "function",
      name: typeof fn.name === "string" ? fn.name : "",
      description: typeof fn.description === "string" ? fn.description : "",
      parameters:
        fn.parameters && typeof fn.parameters === "object"
          ? (fn.parameters as Record<string, unknown>)
          : { type: "object", properties: {} }
    };
  }
  return tool;
}

type CodexEvent =
  | { kind: "text"; text: string }
  | { kind: "tool_call_start"; index: number; id: string; name: string }
  | { kind: "tool_call_delta"; index: number; partial: string }
  | { kind: "done"; tool_calls: boolean };

/**
 * Translate a single Codex Responses API SSE event into the gateway's
 * uniform stream-event shape. Returns null for events we don't surface
 * (e.g. reasoning summaries, status pings).
 */
function extractCodexEvent(
  event: Record<string, unknown>,
  toolCallIndex: Map<number, number>
): CodexEvent | null {
  const type = event.type as string | undefined;
  if (!type) return null;

  if (type === "response.output_text.delta") {
    return { kind: "text", text: typeof event.delta === "string" ? event.delta : "" };
  }
  if (type === "response.content_part.delta") {
    const delta = event.delta as Record<string, unknown> | undefined;
    if (typeof delta?.text === "string") return { kind: "text", text: delta.text };
  }

  if (type === "response.output_item.added") {
    const item = event.item as Record<string, unknown> | undefined;
    if (item && item.type === "function_call") {
      const outputIndex =
        typeof event.output_index === "number" ? event.output_index : 0;
      const idx = toolCallIndex.size;
      toolCallIndex.set(outputIndex, idx);
      return {
        kind: "tool_call_start",
        index: idx,
        id: typeof item.call_id === "string" ? item.call_id : "",
        name: typeof item.name === "string" ? item.name : ""
      };
    }
  }

  if (type === "response.function_call_arguments.delta") {
    const outputIndex =
      typeof event.output_index === "number" ? event.output_index : 0;
    const idx = toolCallIndex.get(outputIndex);
    if (idx === undefined) return null;
    return {
      kind: "tool_call_delta",
      index: idx,
      partial: typeof event.delta === "string" ? event.delta : ""
    };
  }

  if (type === "response.completed" || type === "response.done") {
    return { kind: "done", tool_calls: toolCallIndex.size > 0 };
  }

  return null;
}
