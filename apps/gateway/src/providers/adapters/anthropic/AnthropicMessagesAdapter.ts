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

  private async *createAnthropicStream(
    body: ReadableStream<Uint8Array>,
    onDone: () => void
  ): ProviderStream {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });

        // Process complete SSE lines
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith(":")) {
            continue;
          }

          // Forward the raw SSE line
          yield `${trimmed}\n`;
        }
      }

      // Process any remaining buffer
      const finalChunk = decoder.decode();
      if (finalChunk) {
        buffer += finalChunk;
      }

      if (buffer.trim()) {
        yield `${buffer.trim()}\n`;
      }
    } finally {
      onDone();
      reader.releaseLock();
    }
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
    // Extract system message if present
    const messages: AnthropicMessagesRequest["messages"] = [];

    for (const msg of request.messages) {
      if (msg.role === "system") {
        // Anthropic handles system differently, prepend to first user message or skip
        // For simplicity, convert system to user message with prefix
        messages.push({
          role: "user",
          content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content)
        });
        continue;
      }

      if (msg.role === "user" || msg.role === "assistant") {
        messages.push({
          role: msg.role,
          content: msg.content
        });
      }
    }

    // Ensure messages alternate and start with user
    const sanitized = ensureAlternatingMessages(messages);

    return {
      model: request.model,
      max_tokens: request.max_tokens ?? 4096,
      messages: sanitized,
      stream: request.stream
    };
  }

  private translateAnthropicToOpenAI(
    response: NormalizedAnthropicResponse,
    requestedModel: string
  ): NormalizedOpenAIResponse {
    const content = response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("");

    return {
      id: response.id,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: requestedModel,
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content
          },
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

function normalizeAnthropicContent(
  content: unknown
): Array<{ type: "text"; text: string }> {
  if (!Array.isArray(content)) {
    return [{ type: "text", text: "" }];
  }

  return content
    .filter(
      (block: unknown) =>
        block && typeof block === "object" && (block as Record<string, unknown>).type === "text"
    )
    .map((block: unknown) => ({
      type: "text" as const,
      text: ((block as Record<string, unknown>).text as string) ?? ""
    }));
}

function normalizeStopReason(
  reason: unknown
): "end_turn" | "max_tokens" | "stop_sequence" | null {
  if (reason === "end_turn" || reason === "max_tokens" || reason === "stop_sequence") {
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
  reason: "end_turn" | "max_tokens" | "stop_sequence" | null | undefined
): "stop" | "length" | null {
  if (reason === "end_turn" || reason === "stop_sequence") {
    return "stop";
  }
  if (reason === "max_tokens") {
    return "length";
  }
  return null;
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
