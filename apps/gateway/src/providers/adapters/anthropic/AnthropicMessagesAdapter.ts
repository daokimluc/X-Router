import type { AIProviderAdapter } from "../../base/AIProviderAdapter.js";
import type { ProviderCapabilities } from "../../base/ProviderCapabilities.js";
import {
  ProviderAuthError,
  ProviderConfigError,
  ProviderRateLimitError,
  ProviderTimeoutError,
  ProviderUnavailableError
} from "../../base/ProviderErrors.js";
import type {
  AnthropicContentBlock,
  AnthropicMessagesRequest,
  NormalizedAnthropicResponse,
  NormalizedOpenAIResponse,
  OpenAIChatCompletionRequest,
  OpenAIToolCall,
  ProviderContext,
  ProviderHealth,
  ProviderModel,
  ProviderRequestContext,
  ProviderStream,
  ProviderStreamEvent
} from "../../base/types.js";
import { ModelCache } from "../../services/ModelCache.js";
import { applyChannelOverrides, applyChannelInputPolicies, interpretStatusCode } from "../../../utils/channelOverride.js";
import { fetchWithProxy } from "../../../proxy/fetchWithProxy.js";
import type { ProviderInstance } from "../../base/ProviderInstance.js";

const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_TIMEOUT_MS = 30000;

export type AnthropicConfig = {
  baseUrl?: string;
};

export type AnthropicCredential = {
  apiKey: string;
};

export type AnthropicFetch = typeof fetch;

export class AnthropicMessagesAdapter implements AIProviderAdapter {
  readonly type = "anthropic";

  constructor(
    private readonly modelCache = new ModelCache(),
    private readonly fetchImpl: AnthropicFetch = fetch
  ) {}

  getCapabilities(): ProviderCapabilities {
    return {
      protocols: ["anthropic_messages"],
      flags: ["messages", "streaming"]
    };
  }

  async validateConfig(config: Record<string, unknown>): Promise<void> {
    if (config.baseUrl !== undefined && typeof config.baseUrl !== "string") {
      throw new ProviderConfigError("Anthropic config baseUrl must be a string");
    }
  }

  async validateCredential(payload: Record<string, unknown>): Promise<void> {
    if (!payload.apiKey || typeof payload.apiKey !== "string") {
      throw new ProviderConfigError("Anthropic credential must include a valid apiKey string");
    }
  }

  async listModels(context: ProviderContext): Promise<ProviderModel[]> {
    const accountId = context.providerInstance.id;
    const cached = this.modelCache.get(accountId);
    if (cached) {
      return cached;
    }

    const baseUrl = this.resolveBaseUrl(context);
    const apiKey = this.resolveApiKey(context);
    const url = `${baseUrl}/v1/models`;

    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), DEFAULT_TIMEOUT_MS);

    try {
      const response = await this.fetchImpl(url, {
        method: "GET",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": ANTHROPIC_VERSION
        },
        signal: abortController.signal
      });

      if (response.status === 404) {
        return [];
      }

      if (response.status === 401 || response.status === 403) {
        throw new ProviderAuthError("anthropic", "Invalid API key for model discovery");
      }

      if (!response.ok) {
        return [];
      }

      const body = (await response.json()) as { data?: Array<{ id: string }> };
      const models: ProviderModel[] = (body.data ?? []).map((m) => ({
        id: m.id,
        upstreamModel: m.id
      }));

      this.modelCache.set(accountId, models);
      return models;
    } catch (error) {
      if (error instanceof ProviderAuthError) {
        throw error;
      }
      if (error instanceof Error && error.name === "AbortError") {
        return [];
      }
      return [];
    } finally {
      clearTimeout(timeout);
    }
  }

  async messages(
    request: AnthropicMessagesRequest,
    context: ProviderRequestContext
  ): Promise<NormalizedAnthropicResponse | ProviderStream> {
    const baseUrl = this.resolveBaseUrl(context);
    const apiKey = this.resolveApiKey(context);
    const url = `${baseUrl}/v1/messages`;
    const timeoutMs = context.providerInstance.defaultTimeoutMs || DEFAULT_TIMEOUT_MS;

    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), timeoutMs);

    try {
      // Inject thinking budget if reasoning effort is specified
      let requestBody: Record<string, unknown> = request as unknown as Record<string, unknown>;
      if (context.reasoningEffort) {
        const budgetMap = { high: 10000, medium: 5000, low: 2000 };
        requestBody = {
          ...requestBody,
          thinking: {
            type: "enabled",
            budget_tokens: budgetMap[context.reasoningEffort]
          }
        };
      }

      const baseHeaders: Record<string, string> = {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION
      };
      const policied = applyChannelInputPolicies(requestBody, context.providerInstance);
      const { body: finalBody, headers: finalHeaders } = applyChannelOverrides(
        policied,
        baseHeaders,
        context.providerInstance
      );

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
        throw await this.classifyHttpError(response, baseUrl, timeoutMs, context.providerInstance);
      }

      if (request.stream) {
        if (!response.body) {
          throw new ProviderConfigError("Anthropic returned an empty stream body");
        }
        return this.createAnthropicStream(response.body, () => clearTimeout(timeout));
      }

      clearTimeout(timeout);
      const body = await response.json();
      return this.normalizeAnthropicResponse(body);
    } catch (error) {
      clearTimeout(timeout);

      if (
        error instanceof ProviderAuthError ||
        error instanceof ProviderRateLimitError ||
        error instanceof ProviderTimeoutError ||
        error instanceof ProviderUnavailableError ||
        error instanceof ProviderConfigError
      ) {
        throw error;
      }

      if (error instanceof Error && error.name === "AbortError") {
        throw new ProviderTimeoutError("anthropic", baseUrl, timeoutMs);
      }

      throw new ProviderUnavailableError("anthropic", 502);
    }
  }

  async chatCompletions(
    request: OpenAIChatCompletionRequest,
    context: ProviderRequestContext
  ): Promise<NormalizedOpenAIResponse | ProviderStream> {
    // Translate OpenAI format to Anthropic format
    const anthropicRequest = this.translateOpenAIToAnthropic(request);
    const result = await this.messages(anthropicRequest, context);

    // If streaming, return the stream directly
    if (isProviderStream(result)) {
      return result;
    }

    // Translate Anthropic response back to OpenAI format
    return this.translateAnthropicToOpenAI(result, request.model);
  }

  async healthCheck(context: ProviderContext): Promise<ProviderHealth> {
    const baseUrl = this.resolveBaseUrl(context);
    const apiKey = this.resolveApiKey(context);
    const url = `${baseUrl}/v1/models`;

    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), 10000);

    try {
      const response = await this.fetchImpl(url, {
        method: "GET",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": ANTHROPIC_VERSION
        },
        signal: abortController.signal
      });

      if (response.status === 200) {
        return { status: "ok" };
      }

      if (response.status === 401 || response.status === 403) {
        return { status: "down", message: "Invalid API key" };
      }

      // Fallback: try a minimal messages request
      if (response.status === 404) {
        return await this.healthCheckFallback(baseUrl, apiKey, abortController.signal);
      }

      return { status: "degraded", message: `HTTP ${response.status}` };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return { status: "degraded", message: "Health check timed out" };
      }
      return { status: "down", message: "Connection failed" };
    } finally {
      clearTimeout(timeout);
    }
  }

  private async healthCheckFallback(
    baseUrl: string,
    apiKey: string,
    signal: AbortSignal
  ): Promise<ProviderHealth> {
    try {
      const response = await this.fetchImpl(`${baseUrl}/v1/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": ANTHROPIC_VERSION
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1,
          messages: [{ role: "user", content: "hi" }]
        }),
        signal
      });

      if (response.status === 200) {
        return { status: "ok" };
      }

      if (response.status === 401 || response.status === 403) {
        return { status: "down", message: "Invalid API key" };
      }

      return { status: "ok" };
    } catch {
      return { status: "down", message: "Connection failed" };
    }
  }

  private async classifyHttpError(
    response: Response,
    baseUrl: string,
    timeoutMs: number,
    instance?: ProviderInstance
  ): Promise<ProviderAuthError | ProviderRateLimitError | ProviderTimeoutError | ProviderUnavailableError> {
    const status = response.status;

    // Phase 20c — instance-level statusCodeMapping override
    if (instance) {
      const action = interpretStatusCode(instance, status);
      if (action === "disable") {
        const body = await safeResponseText(response);
        return new ProviderAuthError("anthropic", `Status ${status} mapped to disable${body ? `: ${body.slice(0, 200)}` : ""}`);
      }
      if (action === "retry") {
        return new ProviderRateLimitError("anthropic", undefined);
      }
    }

    if (status === 401 || status === 403) {
      const body = await safeResponseText(response);
      return new ProviderAuthError(
        "anthropic",
        `Invalid API key${body ? `: ${body.slice(0, 200)}` : ""}`
      );
    }

    if (status === 429) {
      const retryAfterHeader = response.headers.get("retry-after");
      const retryAfterSeconds = retryAfterHeader ? parseInt(retryAfterHeader, 10) : undefined;
      return new ProviderRateLimitError(
        "anthropic",
        Number.isNaN(retryAfterSeconds) ? undefined : retryAfterSeconds
      );
    }

    if (status >= 500) {
      return new ProviderUnavailableError("anthropic", status);
    }

    return new ProviderUnavailableError("anthropic", status);
  }

  /**
   * Parse the upstream Anthropic SSE stream into the gateway's uniform
   * ProviderStream. Exposes:
   *  - `[Symbol.asyncIterator]` → text deltas only (for the OpenAI text path)
   *  - `events()` → structured ProviderStreamEvent (text + tool_use), used by
   *    the /v1/messages route to re-emit Anthropic SSE without double-wrapping,
   *    and by the events-aware OpenAI stream writer to surface tool_calls.
   * Only one iterator may be consumed per stream.
   */
  private createAnthropicStream(
    body: ReadableStream<Uint8Array>,
    onDone: () => void
  ): ProviderStream {
    let consumed = false;
    let capturedUsage: { input: number; output: number } | null = null;

    async function* dataObjects(): AsyncGenerator<Record<string, unknown>> {
      if (consumed) throw new Error("ProviderStream already consumed");
      consumed = true;
      const reader = body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            const obj = parseSSEDataLine(line);
            if (obj) yield obj;
          }
        }
        const finalChunk = decoder.decode();
        if (finalChunk) buffer += finalChunk;
        const obj = parseSSEDataLine(buffer);
        if (obj) yield obj;
      } finally {
        onDone();
        reader.releaseLock();
      }
    }

    function captureUsage(obj: Record<string, unknown>): void {
      if (obj.type === "message_start") {
        const msg = obj.message as { usage?: { input_tokens?: number; output_tokens?: number } } | undefined;
        if (msg?.usage) {
          capturedUsage = {
            input: msg.usage.input_tokens ?? 0,
            output: msg.usage.output_tokens ?? 0
          };
        }
      } else if (obj.type === "message_delta") {
        const usage = obj.usage as { output_tokens?: number } | undefined;
        if (usage?.output_tokens !== undefined) {
          capturedUsage = {
            input: capturedUsage?.input ?? 0,
            output: usage.output_tokens
          };
        }
      }
    }

    async function* textIter(): AsyncGenerator<string> {
      for await (const obj of dataObjects()) {
        captureUsage(obj);
        if (obj.type === "content_block_delta") {
          const delta = obj.delta as { type?: string; text?: string } | undefined;
          if (delta?.type === "text_delta" && typeof delta.text === "string") {
            yield delta.text;
          }
        }
      }
    }

    async function* eventIter(): AsyncGenerator<ProviderStreamEvent> {
      const toolBlocks = new Map<number, string>();
      let stopReason: "end_turn" | "max_tokens" | "stop_sequence" | "tool_use" = "end_turn";
      for await (const obj of dataObjects()) {
        captureUsage(obj);
        const type = obj.type as string;
        if (type === "content_block_start") {
          const index = obj.index as number;
          const block = obj.content_block as { type?: string; id?: string; name?: string } | undefined;
          if (block?.type === "tool_use" && typeof block.id === "string") {
            toolBlocks.set(index, block.id);
            yield { type: "tool_use_start", id: block.id, name: block.name ?? "" };
          }
        } else if (type === "content_block_delta") {
          const index = obj.index as number;
          const delta = obj.delta as { type?: string; text?: string; partial_json?: string } | undefined;
          if (delta?.type === "text_delta" && typeof delta.text === "string") {
            yield { type: "text_delta", text: delta.text };
          } else if (delta?.type === "input_json_delta" && typeof delta.partial_json === "string") {
            const id = toolBlocks.get(index);
            if (id) yield { type: "tool_use_delta", id, partial_json: delta.partial_json };
          }
        } else if (type === "content_block_stop") {
          const index = obj.index as number;
          const id = toolBlocks.get(index);
          if (id) yield { type: "tool_use_stop", id };
        } else if (type === "message_delta") {
          const delta = obj.delta as { stop_reason?: string } | undefined;
          const sr = delta?.stop_reason;
          if (sr === "tool_use" || sr === "max_tokens" || sr === "stop_sequence" || sr === "end_turn") {
            stopReason = sr;
          }
        }
      }
      yield { type: "message_stop", stop_reason: stopReason };
    }

    return {
      [Symbol.asyncIterator]: () => textIter(),
      usage: () =>
        capturedUsage
          ? {
              prompt_tokens: capturedUsage.input,
              completion_tokens: capturedUsage.output,
              total_tokens: capturedUsage.input + capturedUsage.output
            }
          : undefined,
      events: () => ({ [Symbol.asyncIterator]: () => eventIter() })
    };
  }

  private normalizeAnthropicResponse(body: unknown): NormalizedAnthropicResponse {
    const raw = body as Record<string, unknown>;

    return {
      id: (raw.id as string) ?? `msg_${Date.now()}`,
      type: "message",
      role: "assistant",
      model: (raw.model as string) ?? "unknown",
      content: normalizeAnthropicContent(raw.content),
      stop_reason: normalizeStopReason(raw.stop_reason),
      usage: normalizeAnthropicUsage(raw.usage)
    };
  }

  private translateOpenAIToAnthropic(request: OpenAIChatCompletionRequest): AnthropicMessagesRequest {
    let system: string | undefined;
    const messages: AnthropicMessagesRequest["messages"] = [];

    for (const msg of request.messages as Array<Record<string, unknown>>) {
      const role = msg.role as string;
      const rawContent = msg.content;

      if (role === "system") {
        // Anthropic uses a top-level `system` field, not a system role in messages.
        const text =
          typeof rawContent === "string" ? rawContent : JSON.stringify(rawContent);
        system = system ? `${system}\n${text}` : text;
        continue;
      }

      if (role === "tool") {
        // OpenAI tool-result message → Anthropic user message with tool_result block.
        const toolCallId = (msg.tool_call_id as string | undefined) ?? "";
        const text =
          typeof rawContent === "string" ? rawContent : JSON.stringify(rawContent);
        messages.push({
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: toolCallId,
              content: text
            }
          ]
        });
        continue;
      }

      if (role === "assistant") {
        // OpenAI assistant message may have tool_calls — translate to Anthropic
        // tool_use content blocks alongside any text content.
        const toolCalls = msg.tool_calls as
          | Array<{ id?: string; function?: { name?: string; arguments?: string } }>
          | undefined;
        if (toolCalls && toolCalls.length > 0) {
          const blocks: Array<Record<string, unknown>> = [];
          if (typeof rawContent === "string" && rawContent.length > 0) {
            blocks.push({ type: "text", text: rawContent });
          } else if (Array.isArray(rawContent)) {
            for (const part of rawContent as Array<Record<string, unknown>>) {
              if (part.type === "text" && typeof part.text === "string") {
                blocks.push({ type: "text", text: part.text });
              }
            }
          }
          for (const call of toolCalls) {
            const id = call.id ?? "";
            const name = call.function?.name ?? "";
            let input: unknown = {};
            const argsStr = call.function?.arguments ?? "";
            if (argsStr.trim().length > 0) {
              try {
                input = JSON.parse(argsStr);
              } catch {
                input = { _raw: argsStr };
              }
            }
            blocks.push({ type: "tool_use", id, name, input });
          }
          messages.push({ role: "assistant", content: blocks });
          continue;
        }
        messages.push({
          role: "assistant",
          content:
            typeof rawContent === "string"
              ? rawContent
              : Array.isArray(rawContent)
                ? (rawContent as Array<Record<string, unknown>>)
                : ""
        });
        continue;
      }

      if (role === "user") {
        messages.push({
          role: "user",
          content:
            typeof rawContent === "string"
              ? rawContent
              : Array.isArray(rawContent)
                ? (rawContent as Array<Record<string, unknown>>)
                : ""
        });
      }
    }

    const sanitized = ensureAlternatingMessages(messages);

    const out: AnthropicMessagesRequest = {
      model: request.model,
      max_tokens: request.max_tokens ?? 4096,
      messages: sanitized,
      stream: request.stream
    };
    if (system !== undefined) out.system = system;
    if (request.temperature !== undefined) out.temperature = request.temperature;
    if (request.tools && request.tools.length > 0) {
      out.tools = request.tools.map(translateOpenAIToolToAnthropic);
    }
    if (request.tool_choice !== undefined) {
      out.tool_choice = translateToolChoice(request.tool_choice);
    }
    return out;
  }

  private translateAnthropicToOpenAI(
    response: NormalizedAnthropicResponse,
    requestedModel: string
  ): NormalizedOpenAIResponse {
    const textParts: string[] = [];
    const toolCalls: OpenAIToolCall[] = [];
    for (const block of response.content) {
      if (block.type === "text") {
        textParts.push(block.text);
      } else if (block.type === "tool_use") {
        toolCalls.push({
          id: block.id,
          type: "function",
          function: {
            name: block.name,
            arguments: JSON.stringify(block.input ?? {})
          }
        });
      }
    }

    const message: NormalizedOpenAIResponse["choices"][number]["message"] = {
      role: "assistant",
      content: textParts.join("")
    };
    if (toolCalls.length > 0) {
      message.tool_calls = toolCalls;
    }

    return {
      id: response.id,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: requestedModel,
      choices: [
        {
          index: 0,
          message,
          finish_reason: mapAnthropicStopReason(response.stop_reason)
        }
      ],
      usage: response.usage
        ? {
            prompt_tokens: response.usage.input_tokens,
            completion_tokens: response.usage.output_tokens,
            total_tokens: response.usage.input_tokens + response.usage.output_tokens,
            cached_tokens: response.usage.cache_read_input_tokens
          }
        : undefined
    };
  }

  private resolveBaseUrl(context: ProviderContext): string {
    const config = context.providerInstance.config as AnthropicConfig;
    return (
      config.baseUrl ??
      context.providerInstance.baseUrl ??
      "https://api.anthropic.com"
    );
  }

  private resolveApiKey(context: ProviderContext): string {
    const credential = (context as ProviderRequestContext).credentialPayload as
      | AnthropicCredential
      | undefined;
    return credential?.apiKey ?? "";
  }
}

/**
 * Parse one SSE line of the form `data: {...}` into its JSON object.
 * Returns null for blank lines, comments (`:`), `event:` lines, or `[DONE]`.
 */
function parseSSEDataLine(line: string): Record<string, unknown> | null {
  const trimmed = line.trim();
  if (!trimmed || !trimmed.startsWith("data:")) return null;
  const payload = trimmed.slice(5).trim();
  if (!payload || payload === "[DONE]") return null;
  try {
    const obj = JSON.parse(payload);
    return obj && typeof obj === "object" ? (obj as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function normalizeAnthropicContent(content: unknown): AnthropicContentBlock[] {
  if (!Array.isArray(content)) {
    return [{ type: "text", text: "" }];
  }

  const out: AnthropicContentBlock[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const b = block as Record<string, unknown>;
    if (b.type === "text") {
      out.push({ type: "text", text: typeof b.text === "string" ? b.text : "" });
    } else if (b.type === "tool_use") {
      const id = typeof b.id === "string" ? b.id : "";
      const name = typeof b.name === "string" ? b.name : "";
      if (!id || !name) continue;
      const input =
        b.input && typeof b.input === "object" ? (b.input as Record<string, unknown>) : {};
      out.push({ type: "tool_use", id, name, input });
    }
    // Other block types (e.g. thinking) are dropped — the gateway's normalized
    // shape only models text and tool_use today.
  }
  return out.length > 0 ? out : [{ type: "text", text: "" }];
}

function normalizeStopReason(
  reason: unknown
): "end_turn" | "max_tokens" | "stop_sequence" | "tool_use" | null {
  if (
    reason === "end_turn" ||
    reason === "max_tokens" ||
    reason === "stop_sequence" ||
    reason === "tool_use"
  ) {
    return reason;
  }
  return null;
}

function normalizeAnthropicUsage(
  usage: unknown
): { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number } | undefined {
  if (!usage || typeof usage !== "object") {
    return undefined;
  }

  const raw = usage as Record<string, unknown>;
  const result: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number } = {
    input_tokens: typeof raw.input_tokens === "number" ? raw.input_tokens : 0,
    output_tokens: typeof raw.output_tokens === "number" ? raw.output_tokens : 0
  };

  if (typeof raw.cache_read_input_tokens === "number" && raw.cache_read_input_tokens > 0) {
    result.cache_read_input_tokens = raw.cache_read_input_tokens;
  }
  if (typeof raw.cache_creation_input_tokens === "number" && raw.cache_creation_input_tokens > 0) {
    result.cache_creation_input_tokens = raw.cache_creation_input_tokens;
  }

  return result;
}

function mapAnthropicStopReason(
  reason: "end_turn" | "max_tokens" | "stop_sequence" | "tool_use" | null | undefined
): "stop" | "length" | "tool_calls" | null {
  if (reason === "end_turn" || reason === "stop_sequence") {
    return "stop";
  }
  if (reason === "max_tokens") {
    return "length";
  }
  if (reason === "tool_use") {
    return "tool_calls";
  }
  return null;
}

/**
 * OpenAI tool shape: `{ type: "function", function: { name, description, parameters } }`.
 * Anthropic tool shape: `{ name, description, input_schema }`.
 * If the input doesn't match the OpenAI shape (e.g. caller already passed an
 * Anthropic-style tool through), return it unchanged so we don't break
 * pass-through usage.
 */
function translateOpenAIToolToAnthropic(tool: Record<string, unknown>): Record<string, unknown> {
  if (tool.type === "function" && tool.function && typeof tool.function === "object") {
    const fn = tool.function as Record<string, unknown>;
    const out: Record<string, unknown> = {
      name: typeof fn.name === "string" ? fn.name : "",
      description: typeof fn.description === "string" ? fn.description : "",
      input_schema:
        fn.parameters && typeof fn.parameters === "object"
          ? (fn.parameters as Record<string, unknown>)
          : { type: "object", properties: {} }
    };
    return out;
  }
  return tool;
}

/**
 * OpenAI `tool_choice`: "auto" | "none" | "required" | { type: "function", function: { name } }.
 * Anthropic: { type: "auto" | "any" | "tool", name? }.
 */
function translateToolChoice(choice: string | Record<string, unknown>): Record<string, unknown> {
  if (typeof choice === "string") {
    if (choice === "none") return { type: "none" };
    if (choice === "required") return { type: "any" };
    return { type: "auto" };
  }
  if (choice.type === "function" && choice.function && typeof choice.function === "object") {
    const fn = choice.function as { name?: unknown };
    return { type: "tool", name: typeof fn.name === "string" ? fn.name : "" };
  }
  return choice;
}

function ensureAlternatingMessages(
  messages: AnthropicMessagesRequest["messages"]
): AnthropicMessagesRequest["messages"] {
  if (messages.length === 0) {
    return [{ role: "user", content: "hi" }];
  }

  // Ensure first message is from user
  const result: AnthropicMessagesRequest["messages"] = [];
  let lastRole: string | null = null;

  for (const msg of messages) {
    if (lastRole === msg.role) {
      // Merge consecutive same-role messages
      const last = result[result.length - 1];
      const lastContent = typeof last.content === "string" ? last.content : JSON.stringify(last.content);
      const currentContent = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
      last.content = `${lastContent}\n${currentContent}`;
    } else {
      result.push({ ...msg });
      lastRole = msg.role;
    }
  }

  // Ensure starts with user
  if (result.length > 0 && result[0].role !== "user") {
    result.unshift({ role: "user", content: "." });
  }

  return result;
}

function isProviderStream(value: unknown): value is ProviderStream {
  return (
    value !== null &&
    typeof value === "object" &&
    Symbol.asyncIterator in (value as object)
  );
}

async function safeResponseText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}
