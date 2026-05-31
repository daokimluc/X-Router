import type { FastifyInstance, FastifyReply } from "fastify";
import { compressToolOutput } from "../../services/TokenSaverService.js";
import type { AIProviderAdapter } from "../../providers/base/AIProviderAdapter.js";
import type {
  AnthropicMessagesRequest,
  NormalizedAnthropicResponse,
  NormalizedOpenAIResponse,
  OpenAIChatCompletionRequest,
  ProviderStream
} from "../../providers/base/types.js";
import { isProviderStream } from "../../utils/sse.js";
import type {
  AdapterCallContext,
  DecodedResponse,
  PipelineUsage,
  ProtocolHandler
} from "./ProtocolHandler.js";

type AnthropicBody = AnthropicMessagesRequest & Record<string, unknown>;

/**
 * Protocol encode/decode for `/v1/messages`. Prefers the adapter's native
 * `messages()` (lossless tool round-trips); falls back to `chatCompletions`
 * translation when an adapter declares anthropic_messages support but does not
 * implement messages(). The shared pipeline drives the lifecycle.
 */
export class AnthropicProtocolHandler implements ProtocolHandler {
  readonly protocol = "anthropic" as const;
  readonly model: string;

  /** Set during invoke() so decode() knows whether the body is already Anthropic-shaped. */
  private usedNativeMessages = false;

  constructor(
    private readonly app: FastifyInstance,
    private readonly body: AnthropicBody,
    private readonly cache: { key: string | null; mode: "use" | "skip" | "refresh"; ttl?: number }
  ) {
    this.model = body.model;
  }

  async invoke(
    adapter: AIProviderAdapter,
    upstreamModel: string,
    ctx: AdapterCallContext
  ): Promise<unknown | ProviderStream> {
    const compressedMessages = this.app.tokenSaverService.getSettings().compressToolOutput
      ? compressMessagesToolOutput(this.body.messages)
      : this.body.messages;

    this.usedNativeMessages = typeof adapter.messages === "function";
    if (this.usedNativeMessages) {
      const anthropicRequest: AnthropicMessagesRequest = {
        model: upstreamModel,
        max_tokens: this.body.max_tokens,
        messages: compressedMessages,
        system: this.body.system,
        stream: this.body.stream,
        temperature: this.body.temperature,
        tools: this.body.tools,
        tool_choice: this.body.tool_choice
      };
      return adapter.messages!(anthropicRequest, ctx);
    }

    const openAIRequest = toOpenAIChatRequest({
      model: upstreamModel,
      maxTokens: this.body.max_tokens,
      stream: this.body.stream,
      temperature: this.body.temperature,
      system: this.body.system,
      messages: compressedMessages,
      tools: this.body.tools,
      tool_choice: this.body.tool_choice
    });
    return adapter.chatCompletions(openAIRequest, ctx);
  }

  async writeStream(
    reply: FastifyReply,
    stream: ProviderStream,
    requestId: string
  ): Promise<PipelineUsage> {
    const { outputChars } = await writeAnthropicStream({
      reply,
      stream,
      model: this.model,
      requestId
    });
    const reported = stream.usage?.();
    if (reported) {
      return {
        promptTokens: reported.prompt_tokens,
        completionTokens: reported.completion_tokens,
        cachedTokens: reported.cached_tokens
      };
    }
    // Estimation fallback (anthropic char ratios) so usage is always settled.
    const inputChars = JSON.stringify(this.body.messages).length;
    return {
      promptTokens: Math.ceil(inputChars * 0.42),
      completionTokens: Math.ceil(outputChars * 0.4)
    };
  }

  decode(response: unknown): DecodedResponse {
    const normalized = normalizeUsageShape((response as { usage?: unknown }).usage);
    // F4 — always produce usage. When the upstream reported none, estimate from
    // the request + (for the OpenAI fallback shape) the response text.
    let usage: PipelineUsage;
    if (normalized) {
      usage = {
        promptTokens: normalized.prompt_tokens,
        completionTokens: normalized.completion_tokens,
        cachedTokens: normalized.cached_tokens
      };
    } else {
      const inputChars = JSON.stringify(this.body.messages).length;
      const promptTokens = Math.ceil(inputChars * 0.42);
      let completionChars = 0;
      if (!this.usedNativeMessages) {
        const text = (response as NormalizedOpenAIResponse).choices?.[0]?.message?.content ?? "";
        completionChars = typeof text === "string" ? text.length : 0;
      } else {
        for (const block of (response as NormalizedAnthropicResponse).content ?? []) {
          if (block.type === "text" && typeof block.text === "string") completionChars += block.text.length;
        }
      }
      usage = { promptTokens, completionTokens: Math.ceil(completionChars * 0.4) };
    }

    // F5/F6b — never cache tool_use responses, and the cached/returned body must
    // be Anthropic-shaped. The native path is already Anthropic-shaped; the
    // fallback path is translated to Anthropic before returning.
    const body = this.usedNativeMessages
      ? { ...(response as NormalizedAnthropicResponse), model: this.model }
      : toAnthropicResponse(response as NormalizedOpenAIResponse, this.model);
    const hasToolUse = (body.content ?? []).some((b) => b.type === "tool_use");

    return {
      body,
      usage,
      cacheable: this.cache.key !== null && this.cache.mode !== "skip" && !hasToolUse
    };
  }

  writeCache(response: unknown): void {
    if (!this.cache.key) return;
    // Cache the Anthropic-shaped body so a cache hit returns the correct wire
    // shape to an Anthropic client (F6b).
    const body = this.usedNativeMessages
      ? { ...(response as NormalizedAnthropicResponse), model: this.model }
      : toAnthropicResponse(response as NormalizedOpenAIResponse, this.model);
    this.app.responseCacheService.write(this.cache.key, body, this.model, this.cache.ttl);
  }
}

// ============================================================================
// Protocol encode/decode helpers (moved out of routes/anthropic.ts)
// ============================================================================

export function toOpenAIChatRequest(options: {
  model: string;
  maxTokens: number;
  stream?: boolean;
  temperature?: number;
  system?: string | Array<Record<string, unknown>>;
  messages: Array<{ role: "user" | "assistant"; content: string | Array<Record<string, unknown>> }>;
  tools?: Array<Record<string, unknown>>;
  tool_choice?: Record<string, unknown>;
}): OpenAIChatCompletionRequest {
  const out: OpenAIChatCompletionRequest = {
    model: options.model,
    max_tokens: options.maxTokens,
    stream: options.stream,
    temperature: options.temperature,
    messages: [
      ...(options.system ? [{ role: "system" as const, content: options.system }] : []),
      ...options.messages.map((message) => ({ role: message.role, content: message.content }))
    ]
  };
  if (options.tools && options.tools.length > 0) {
    out.tools = options.tools.map(translateAnthropicToolToOpenAI);
  }
  if (options.tool_choice !== undefined) {
    out.tool_choice = translateAnthropicToolChoice(options.tool_choice);
  }
  return out;
}

function translateAnthropicToolToOpenAI(tool: Record<string, unknown>): Record<string, unknown> {
  if (typeof tool.name === "string" && tool.input_schema && typeof tool.input_schema === "object") {
    return {
      type: "function",
      function: {
        name: tool.name,
        description: typeof tool.description === "string" ? tool.description : "",
        parameters: tool.input_schema as Record<string, unknown>
      }
    };
  }
  return tool;
}

function translateAnthropicToolChoice(
  choice: Record<string, unknown>
): string | Record<string, unknown> {
  const t = choice.type;
  if (t === "auto") return "auto";
  if (t === "none") return "none";
  if (t === "any") return "required";
  if (t === "tool" && typeof choice.name === "string") {
    return { type: "function", function: { name: choice.name } };
  }
  return "auto";
}

export function toAnthropicResponse(
  response: NormalizedOpenAIResponse,
  requestedModel: string
): NormalizedAnthropicResponse {
  const firstChoice = response.choices[0];
  const blocks: NormalizedAnthropicResponse["content"] = [];
  const text = firstChoice?.message.content ?? "";
  if (text.length > 0) {
    blocks.push({ type: "text", text });
  }
  const toolCalls = firstChoice?.message.tool_calls;
  if (toolCalls && toolCalls.length > 0) {
    for (const tc of toolCalls) {
      let input: Record<string, unknown> = {};
      const argsStr = tc.function?.arguments ?? "";
      if (argsStr.trim().length > 0) {
        try {
          const parsed = JSON.parse(argsStr);
          input = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : { _raw: argsStr };
        } catch {
          input = { _raw: argsStr };
        }
      }
      blocks.push({ type: "tool_use", id: tc.id, name: tc.function?.name ?? "", input });
    }
  }
  if (blocks.length === 0) blocks.push({ type: "text", text: "" });

  let stopReason: NormalizedAnthropicResponse["stop_reason"];
  if (firstChoice?.finish_reason === "length") stopReason = "max_tokens";
  else if (firstChoice?.finish_reason === "tool_calls") stopReason = "tool_use";
  else stopReason = "end_turn";

  return {
    id: response.id.replace(/^chatcmpl/, "msg"),
    type: "message",
    role: "assistant",
    model: requestedModel,
    content: blocks,
    stop_reason: stopReason,
    usage: response.usage
      ? { input_tokens: response.usage.prompt_tokens, output_tokens: response.usage.completion_tokens }
      : undefined
  };
}

export async function writeAnthropicStream(options: {
  reply: FastifyReply;
  stream: ProviderStream;
  model: string;
  requestId: string;
}): Promise<{ outputChars: number }> {
  options.reply.raw.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-request-id": options.requestId
  });

  const messageId = "msg_stream";
  options.reply.raw.write(
    `event: message_start\ndata: ${JSON.stringify({
      type: "message_start",
      message: {
        id: messageId,
        type: "message",
        role: "assistant",
        model: options.model,
        content: [],
        stop_reason: null,
        usage: { input_tokens: 0, output_tokens: 0 }
      }
    })}\n\n`
  );

  if (typeof options.stream.events === "function") {
    let outputChars = 0;
    let blockIndex = -1;
    let textBlockOpen = false;
    let toolBlockOpen = false;
    let stopReason: "end_turn" | "max_tokens" | "stop_sequence" | "tool_use" = "end_turn";

    const closeOpenBlock = () => {
      if (textBlockOpen || toolBlockOpen) {
        options.reply.raw.write(
          `event: content_block_stop\ndata: ${JSON.stringify({ type: "content_block_stop", index: blockIndex })}\n\n`
        );
        textBlockOpen = false;
        toolBlockOpen = false;
      }
    };

    for await (const ev of options.stream.events()) {
      if (ev.type === "text_delta") {
        if (toolBlockOpen) closeOpenBlock();
        if (!textBlockOpen) {
          blockIndex += 1;
          textBlockOpen = true;
          options.reply.raw.write(
            `event: content_block_start\ndata: ${JSON.stringify({
              type: "content_block_start",
              index: blockIndex,
              content_block: { type: "text", text: "" }
            })}\n\n`
          );
        }
        outputChars += ev.text.length;
        options.reply.raw.write(
          `event: content_block_delta\ndata: ${JSON.stringify({
            type: "content_block_delta",
            index: blockIndex,
            delta: { type: "text_delta", text: ev.text }
          })}\n\n`
        );
      } else if (ev.type === "tool_use_start") {
        if (textBlockOpen || toolBlockOpen) closeOpenBlock();
        blockIndex += 1;
        toolBlockOpen = true;
        options.reply.raw.write(
          `event: content_block_start\ndata: ${JSON.stringify({
            type: "content_block_start",
            index: blockIndex,
            content_block: { type: "tool_use", id: ev.id, name: ev.name, input: {} }
          })}\n\n`
        );
      } else if (ev.type === "tool_use_delta") {
        if (!toolBlockOpen) continue;
        options.reply.raw.write(
          `event: content_block_delta\ndata: ${JSON.stringify({
            type: "content_block_delta",
            index: blockIndex,
            delta: { type: "input_json_delta", partial_json: ev.partial_json }
          })}\n\n`
        );
      } else if (ev.type === "tool_use_stop") {
        closeOpenBlock();
      } else if (ev.type === "message_stop") {
        stopReason = ev.stop_reason;
      }
    }

    closeOpenBlock();
    options.reply.raw.write(
      `event: message_delta\ndata: ${JSON.stringify({
        type: "message_delta",
        delta: { stop_reason: stopReason },
        usage: { output_tokens: 0 }
      })}\n\n`
    );
    options.reply.raw.write(`event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`);
    options.reply.raw.end();
    return { outputChars };
  }

  options.reply.raw.write(
    `event: content_block_start\ndata: ${JSON.stringify({
      type: "content_block_start",
      index: 0,
      content_block: { type: "text", text: "" }
    })}\n\n`
  );

  let outputChars = 0;
  for await (const text of options.stream) {
    outputChars += text.length;
    options.reply.raw.write(
      `event: content_block_delta\ndata: ${JSON.stringify({
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text }
      })}\n\n`
    );
  }

  options.reply.raw.write(
    `event: content_block_stop\ndata: ${JSON.stringify({ type: "content_block_stop", index: 0 })}\n\n`
  );
  options.reply.raw.write(
    `event: message_delta\ndata: ${JSON.stringify({
      type: "message_delta",
      delta: { stop_reason: "end_turn" },
      usage: { output_tokens: 0 }
    })}\n\n`
  );
  options.reply.raw.write(`event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`);
  options.reply.raw.end();
  return { outputChars };
}

export function normalizeUsageShape(
  raw: unknown
): { prompt_tokens: number; completion_tokens: number; total_tokens: number; cached_tokens?: number } | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const promptTokens =
    typeof r.prompt_tokens === "number" ? r.prompt_tokens : typeof r.input_tokens === "number" ? r.input_tokens : null;
  const completionTokens =
    typeof r.completion_tokens === "number"
      ? r.completion_tokens
      : typeof r.output_tokens === "number"
        ? r.output_tokens
        : null;
  if (promptTokens === null && completionTokens === null) return null;
  const p = promptTokens ?? 0;
  const c = completionTokens ?? 0;
  const total = typeof r.total_tokens === "number" ? r.total_tokens : p + c;
  const cached =
    typeof r.cached_tokens === "number"
      ? r.cached_tokens
      : typeof r.cache_read_input_tokens === "number"
        ? r.cache_read_input_tokens
        : undefined;
  return {
    prompt_tokens: p,
    completion_tokens: c,
    total_tokens: total,
    ...(cached !== undefined ? { cached_tokens: cached } : {})
  };
}

function compressMessagesToolOutput(
  messages: Array<{ role: "user" | "assistant"; content: string | Array<Record<string, unknown>> }>
): Array<{ role: "user" | "assistant"; content: string | Array<Record<string, unknown>> }> {
  return messages.map((msg) => {
    if (typeof msg.content === "string") return msg;
    if (!Array.isArray(msg.content)) return msg;
    const compressed = msg.content.map((block) => {
      if (block.type === "tool_result" && typeof block.content === "string") {
        return { ...block, content: compressToolOutput(block.content) };
      }
      return block;
    });
    return { ...msg, content: compressed };
  });
}

// Re-exported so the direct-routing helper (handleDirectAnthropicRouting) can
// share the same translation + stream writer.
export { isProviderStream };
