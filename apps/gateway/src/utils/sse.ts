import type { FastifyReply } from "fastify";
import type { ProviderStream } from "../providers/base/types.js";

export function isProviderStream(value: unknown): value is ProviderStream {
  return Boolean(
    value &&
      typeof value === "object" &&
      Symbol.asyncIterator in (value as Record<PropertyKey, unknown>)
  );
}

export async function writeOpenAIStream(options: {
  reply: FastifyReply;
  stream: ProviderStream;
  model: string;
  requestId: string;
}): Promise<number> {
  options.reply.raw.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-request-id": options.requestId
  });

  // Structured-event path: adapters that expose events() (Anthropic, Kiro)
  // produce text and tool_use deltas we can render as proper OpenAI chunks
  // with delta.tool_calls — preserving tool calling on the OpenAI route.
  if (typeof options.stream.events === "function") {
    return writeFromEvents(options);
  }

  let outputChars = 0;
  let sawDoneSentinel = false;
  // An adapter's text stream is uniform for its whole lifetime: it either
  // proxies upstream SSE blocks (`data: {...}\n\n`) or yields plain-text model
  // deltas — it never mixes the two. Decide the mode once from the first
  // non-empty chunk, then stick with it. Classifying per-chunk would misfire
  // when a `data:` block is split across network reads (the continuation chunk
  // wouldn't start with `data:` and would be wrongly wrapped as text content).
  let passthroughMode: boolean | null = null;
  for await (const chunk of options.stream) {
    outputChars += chunk.length;
    if (passthroughMode === null && chunk.trim().length > 0) {
      passthroughMode = looksLikeSSEPayload(chunk);
    }
    if (passthroughMode) {
      // Relay SSE blocks verbatim so structured fields like tool_calls, role,
      // finish_reason, refusal etc. survive — wrapping them again into
      // delta.content would collapse the structured payload to a text string.
      options.reply.raw.write(chunk);
      if (chunk.includes("[DONE]")) sawDoneSentinel = true;
    } else {
      options.reply.raw.write(
        `data: ${JSON.stringify(createOpenAIChunk(options.model, chunk))}\n\n`
      );
    }
  }

  if (!sawDoneSentinel) {
    options.reply.raw.write("data: [DONE]\n\n");
  }
  options.reply.raw.end();
  return outputChars;
}

/**
 * Render a structured ProviderStreamEvent stream as OpenAI chat.completion.chunk
 * SSE. Text deltas become `delta.content`; tool_use blocks become
 * `delta.tool_calls[]` with the function name on start and argument fragments
 * (input_json_delta) appended via `function.arguments`.
 */
async function writeFromEvents(options: {
  reply: FastifyReply;
  stream: ProviderStream;
  model: string;
  requestId: string;
}): Promise<number> {
  const completionId = "chatcmpl_stream";
  let outputChars = 0;
  let toolCount = 0;
  // Maps tool_use id → tool_calls array index assigned in arrival order.
  const toolIndex = new Map<string, number>();
  let finishReason: "stop" | "tool_calls" | "length" = "stop";

  const emit = (delta: Record<string, unknown>, finish: string | null = null): void => {
    options.reply.raw.write(
      `data: ${JSON.stringify({
        id: completionId,
        object: "chat.completion.chunk",
        created: Math.floor(Date.now() / 1000),
        model: options.model,
        choices: [{ index: 0, delta, finish_reason: finish }]
      })}\n\n`
    );
  };

  for await (const ev of options.stream.events!()) {
    if (ev.type === "text_delta") {
      outputChars += ev.text.length;
      emit({ content: ev.text });
    } else if (ev.type === "tool_use_start") {
      const idx = toolCount;
      toolCount += 1;
      toolIndex.set(ev.id, idx);
      emit({
        tool_calls: [
          { index: idx, id: ev.id, type: "function", function: { name: ev.name, arguments: "" } }
        ]
      });
    } else if (ev.type === "tool_use_delta") {
      const idx = toolIndex.get(ev.id);
      if (idx !== undefined) {
        outputChars += ev.partial_json.length;
        emit({ tool_calls: [{ index: idx, function: { arguments: ev.partial_json } }] });
      }
    } else if (ev.type === "message_stop") {
      finishReason = ev.stop_reason === "tool_use" ? "tool_calls" : ev.stop_reason === "max_tokens" ? "length" : "stop";
    }
    // tool_use_stop needs no OpenAI-side event
  }

  if (toolCount > 0 && finishReason === "stop") finishReason = "tool_calls";
  emit({}, finishReason);
  options.reply.raw.write("data: [DONE]\n\n");
  options.reply.raw.end();
  return outputChars;
}

/**
 * Heuristic: an upstream-formatted SSE block starts with `data:` (or one or
 * more `event:` lines followed by `data:`). Plain-text deltas — what Kiro and
 * other text-only adapters yield — never start with `data:` because they're
 * raw model output.
 */
function looksLikeSSEPayload(chunk: string): boolean {
  const trimmedStart = chunk.trimStart();
  return trimmedStart.startsWith("data:") || trimmedStart.startsWith("event:");
}

function createOpenAIChunk(model: string, content: string): Record<string, unknown> {
  return {
    id: "chatcmpl_stream",
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        delta: {
          content
        },
        finish_reason: null
      }
    ]
  };
}

