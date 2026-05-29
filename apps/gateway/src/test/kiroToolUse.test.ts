import { describe, expect, it } from "vitest";
import { KiroClient } from "../providers/adapters/kiro/KiroClient.js";
import { KiroProviderAdapter } from "../providers/adapters/kiro/KiroProviderAdapter.js";
import type { ProviderInstance } from "../providers/base/ProviderInstance.js";

const providerInstance: ProviderInstance = {
  id: "provider_kiro_main",
  type: "kiro",
  name: "Kiro Main",
  enabled: true,
  config: {
    baseUrl: "https://kiro.test",
    chatCompletionsPath: "/chat",
    defaultModel: "sonnet"
  },
  defaultTimeoutMs: 30000,
  maxRetries: 1,
  cooldownMs: 30000,
  accountSelectionStrategy: "round_robin",
  maxConcurrentRequests: 10,
  maxConcurrentRequestsPerAccount: 3,
  circuitBreaker: {
    enabled: true,
    failureThreshold: 5,
    cooldownMs: 30000,
    halfOpenMaxRequests: 1
  },
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z")
};

/**
 * Build an AWS event-stream frame the KiroClient parser understands.
 * Layout: [totalLen u32 BE][headersLen u32 BE][preludeCrc u32 BE=0]
 *         [headers...][payload utf8][messageCrc u32 BE=0]
 * Each header entry: [nameLen u8][name][type u8 = 7 (string)][valueLen u16 BE][value]
 */
function buildFrame(eventType: string, payload: object): Uint8Array {
  const enc = new TextEncoder();
  const headerName = ":event-type";
  const nameBytes = enc.encode(headerName);
  const valueBytes = enc.encode(eventType);
  const headersLen = 1 + nameBytes.length + 1 + 2 + valueBytes.length;

  const payloadStr = JSON.stringify(payload);
  const payloadBytes = enc.encode(payloadStr);
  const totalLen = 12 + headersLen + payloadBytes.length + 4;

  const buf = new Uint8Array(totalLen);
  const view = new DataView(buf.buffer);
  view.setUint32(0, totalLen, false);
  view.setUint32(4, headersLen, false);
  // prelude crc at 8..12 zeroed
  let off = 12;
  buf[off] = nameBytes.length;
  off += 1;
  buf.set(nameBytes, off);
  off += nameBytes.length;
  buf[off] = 7;
  off += 1;
  view.setUint16(off, valueBytes.length, false);
  off += 2;
  buf.set(valueBytes, off);
  off += valueBytes.length;
  buf.set(payloadBytes, off);
  // message crc at last 4 bytes zeroed
  return buf;
}

function frameBody(...frames: Uint8Array[]): ArrayBuffer {
  const total = frames.reduce((s, f) => s + f.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const f of frames) {
    out.set(f, off);
    off += f.length;
  }
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer;
}

describe("Kiro tool_use payload (Anthropic protocol)", () => {
  it("forwards request.tools as userInputMessageContext.tools to upstream", async () => {
    let upstreamBody: Record<string, unknown> | undefined;
    const fetchImpl = async (_url: URL | RequestInfo, init?: RequestInit) => {
      upstreamBody = JSON.parse(String(init?.body));
      return new Response(
        frameBody(
          buildFrame("assistantResponseEvent", { content: "ack" }),
          buildFrame("contextUsageEvent", { contextUsage: { inputTokens: 1, outputTokens: 1 } })
        ),
        { status: 200, headers: { "content-type": "application/vnd.amazon.eventstream" } }
      );
    };
    const adapter = new KiroProviderAdapter(new KiroClient(fetchImpl as typeof fetch));

    await adapter.messages(
      {
        model: "kiro-sonnet",
        max_tokens: 256,
        messages: [{ role: "user", content: "list files" }],
        tools: [
          {
            name: "list_dir",
            description: "List files in a directory",
            input_schema: { type: "object", properties: { path: { type: "string" } } }
          }
        ]
      },
      {
        providerInstance,
        requestId: "req_tool_payload",
        credentialPayload: { accessToken: "access-token" }
      }
    );

    const conv = (upstreamBody as { conversationState?: Record<string, unknown> }).conversationState;
    const ctx = (
      conv?.currentMessage as { userInputMessage?: { userInputMessageContext?: Record<string, unknown> } }
    )?.userInputMessage?.userInputMessageContext;
    expect(ctx).toBeDefined();
    expect(ctx?.tools).toBeDefined();
    const tools = ctx!.tools as Array<Record<string, unknown>>;
    expect(tools).toHaveLength(1);
    expect(tools[0]).toMatchObject({
      toolSpecification: {
        name: "list_dir",
        description: "List files in a directory",
        inputSchema: { json: { type: "object", properties: { path: { type: "string" } } } }
      }
    });
  });

  it("encodes tool_result blocks into userInputMessageContext.toolResults", async () => {
    let upstreamBody: Record<string, unknown> | undefined;
    const fetchImpl = async (_url: URL | RequestInfo, init?: RequestInit) => {
      upstreamBody = JSON.parse(String(init?.body));
      return new Response(
        frameBody(buildFrame("assistantResponseEvent", { content: "done" })),
        { status: 200, headers: { "content-type": "application/vnd.amazon.eventstream" } }
      );
    };
    const adapter = new KiroProviderAdapter(new KiroClient(fetchImpl as typeof fetch));

    await adapter.messages(
      {
        model: "kiro-sonnet",
        max_tokens: 256,
        messages: [
          { role: "user", content: "list" },
          {
            role: "assistant",
            content: [
              { type: "text", text: "calling tool" },
              { type: "tool_use", id: "tu_1", name: "list_dir", input: { path: "." } }
            ]
          },
          {
            role: "user",
            content: [
              { type: "tool_result", tool_use_id: "tu_1", content: "a.txt\nb.txt" }
            ]
          }
        ]
      },
      {
        providerInstance,
        requestId: "req_tool_result",
        credentialPayload: { accessToken: "access-token" }
      }
    );

    const conv = (upstreamBody as { conversationState?: { currentMessage?: { userInputMessage?: { userInputMessageContext?: Record<string, unknown> } }; history?: Array<Record<string, unknown>> } }).conversationState;
    const ctx = conv?.currentMessage?.userInputMessage?.userInputMessageContext;
    const toolResults = ctx?.toolResults as Array<Record<string, unknown>>;
    expect(toolResults).toHaveLength(1);
    expect(toolResults[0]).toMatchObject({
      toolUseId: "tu_1",
      status: "success",
      content: [{ text: "a.txt\nb.txt" }]
    });

    // Assistant tool_use should land in history with toolUses entries
    const history = conv?.history as Array<Record<string, unknown>>;
    const assistantWithToolUse = history.find(
      (h) => "assistantResponseMessage" in h && (h.assistantResponseMessage as { toolUses?: unknown }).toolUses
    );
    expect(assistantWithToolUse).toBeDefined();
    const toolUses = (assistantWithToolUse!.assistantResponseMessage as { toolUses: Array<Record<string, unknown>> }).toolUses;
    expect(toolUses[0]).toMatchObject({ toolUseId: "tu_1", name: "list_dir", input: { path: "." } });
  });
});

describe("Kiro toolUseEvent stream parsing", () => {
  it("emits tool_use_start/delta/stop in order via events()", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(buildFrame("toolUseEvent", { name: "list_dir", toolUseId: "tu_1", input: "{\"pa" }));
        controller.enqueue(buildFrame("toolUseEvent", { name: "list_dir", toolUseId: "tu_1", input: "th\":\".\"}", stop: true }));
        controller.enqueue(buildFrame("contextUsageEvent", { contextUsage: { inputTokens: 5, outputTokens: 3 } }));
        controller.close();
      }
    });
    const adapter = new KiroProviderAdapter(
      new KiroClient(async () =>
        new Response(stream, { status: 200, headers: { "content-type": "application/vnd.amazon.eventstream" } })
      )
    );

    const result = await adapter.messages(
      {
        model: "kiro-sonnet",
        max_tokens: 256,
        messages: [{ role: "user", content: "list" }],
        stream: true,
        tools: [
          { name: "list_dir", description: "list", input_schema: { type: "object", properties: {} } }
        ]
      },
      {
        providerInstance,
        requestId: "req_tool_stream",
        credentialPayload: { accessToken: "access-token" }
      }
    );

    expect(typeof (result as { events?: unknown }).events).toBe("function");
    const events: unknown[] = [];
    for await (const ev of (result as { events: () => AsyncIterable<unknown> }).events()) {
      events.push(ev);
    }

    expect(events).toEqual([
      { type: "tool_use_start", id: "tu_1", name: "list_dir" },
      { type: "tool_use_delta", id: "tu_1", partial_json: '{"pa' },
      { type: "tool_use_delta", id: "tu_1", partial_json: 'th":"."}' },
      { type: "tool_use_stop", id: "tu_1" },
      { type: "message_stop", stop_reason: "tool_use" }
    ]);
  });

  it("collects tool_use entries from non-stream eventstream response", async () => {
    const body = frameBody(
      buildFrame("assistantResponseEvent", { content: "ok" }),
      buildFrame("toolUseEvent", { name: "list_dir", toolUseId: "tu_2", input: "{\"path\":" }),
      buildFrame("toolUseEvent", { name: "list_dir", toolUseId: "tu_2", input: "\"./src\"}", stop: true }),
      buildFrame("contextUsageEvent", { contextUsage: { inputTokens: 2, outputTokens: 1 } })
    );
    const adapter = new KiroProviderAdapter(
      new KiroClient(async () =>
        new Response(body, { status: 200, headers: { "content-type": "application/vnd.amazon.eventstream" } })
      )
    );

    const response = await adapter.messages(
      {
        model: "kiro-sonnet",
        max_tokens: 256,
        messages: [{ role: "user", content: "list" }]
      },
      {
        providerInstance,
        requestId: "req_tool_nonstream",
        credentialPayload: { accessToken: "access-token" }
      }
    );

    expect(response).toMatchObject({
      type: "message",
      stop_reason: "tool_use",
      content: [
        { type: "text", text: "ok" },
        { type: "tool_use", id: "tu_2", name: "list_dir", input: { path: "./src" } }
      ]
    });
  });
});
