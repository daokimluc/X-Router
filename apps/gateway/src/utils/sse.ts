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

  let outputChars = 0;
  for await (const content of options.stream) {
    outputChars += content.length;
    options.reply.raw.write(
      `data: ${JSON.stringify(createOpenAIChunk(options.model, content))}\n\n`
    );
  }

  options.reply.raw.write("data: [DONE]\n\n");
  options.reply.raw.end();
  return outputChars;
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

