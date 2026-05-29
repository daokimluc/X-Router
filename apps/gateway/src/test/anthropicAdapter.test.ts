import { describe, expect, it } from "vitest";
import { AnthropicMessagesAdapter } from "../providers/adapters/anthropic/AnthropicMessagesAdapter.js";
import { ModelCache } from "../providers/services/ModelCache.js";
import type { ProviderInstance } from "../providers/base/ProviderInstance.js";
import type { NormalizedOpenAIResponse } from "../providers/base/types.js";

const providerInstance: ProviderInstance = {
  id: "provider_anthropic_main",
  type: "anthropic",
  name: "Anthropic Main",
  enabled: true,
  config: { baseUrl: "https://api.anthropic.test" },
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

const credential = { apiKey: "sk-test" };

describe("AnthropicMessagesAdapter chatCompletions tool calling", () => {
  it("forwards tools, tool_choice, system, and temperature to upstream", async () => {
    let upstreamBody: Record<string, unknown> | undefined;
    const adapter = new AnthropicMessagesAdapter(new ModelCache(), async (_url, init) => {
      upstreamBody = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({
          id: "msg_1",
          model: "claude-sonnet-4-5",
          content: [{ type: "text", text: "ok" }],
          stop_reason: "end_turn",
          usage: { input_tokens: 1, output_tokens: 1 }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    });

    await adapter.chatCompletions(
      {
        model: "claude-sonnet-4-5",
        max_tokens: 256,
        temperature: 0.5,
        messages: [
          { role: "system", content: "be terse" },
          { role: "user", content: "hi" }
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "list_dir",
              description: "List a directory",
              parameters: {
                type: "object",
                properties: { path: { type: "string" } },
                required: ["path"]
              }
            }
          }
        ],
        tool_choice: "required"
      },
      {
        providerInstance,
        requestId: "req_anthropic_tools",
        credentialPayload: credential
      }
    );

    expect(upstreamBody).toMatchObject({
      model: "claude-sonnet-4-5",
      max_tokens: 256,
      temperature: 0.5,
      system: "be terse",
      tool_choice: { type: "any" }
    });
    const tools = (upstreamBody as { tools: Array<Record<string, unknown>> }).tools;
    expect(tools).toHaveLength(1);
    expect(tools[0]).toMatchObject({
      name: "list_dir",
      description: "List a directory",
      input_schema: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"]
      }
    });
    // System role must NOT appear in messages array (Anthropic uses top-level system)
    const messages = (upstreamBody as { messages: Array<{ role: string }> }).messages;
    expect(messages.every((m) => m.role !== "system")).toBe(true);
  });

  it("translates OpenAI assistant tool_calls into Anthropic tool_use blocks", async () => {
    let upstreamBody: Record<string, unknown> | undefined;
    const adapter = new AnthropicMessagesAdapter(new ModelCache(), async (_url, init) => {
      upstreamBody = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({
          id: "msg_2",
          model: "claude-sonnet-4-5",
          content: [{ type: "text", text: "done" }],
          stop_reason: "end_turn",
          usage: { input_tokens: 1, output_tokens: 1 }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    });

    await adapter.chatCompletions(
      {
        model: "claude-sonnet-4-5",
        max_tokens: 256,
        messages: [
          { role: "user", content: "list ." },
          {
            role: "assistant",
            content: "calling list_dir",
            // OpenAI assistant message with tool_calls
            tool_calls: [
              {
                id: "call_1",
                type: "function",
                function: { name: "list_dir", arguments: '{"path":"."}' }
              }
            ]
          } as unknown as { role: "assistant"; content: string },
          {
            role: "tool",
            content: "a.txt\nb.txt",
            tool_call_id: "call_1"
          } as unknown as { role: "user"; content: string }
        ]
      },
      {
        providerInstance,
        requestId: "req_anthropic_tool_call_history",
        credentialPayload: credential
      }
    );

    const messages = (upstreamBody as { messages: Array<Record<string, unknown>> }).messages;
    // Find assistant message with tool_use
    const assistantMsg = messages.find((m) => m.role === "assistant");
    expect(assistantMsg).toBeDefined();
    const assistantBlocks = assistantMsg!.content as Array<Record<string, unknown>>;
    const toolUseBlock = assistantBlocks.find((b) => b.type === "tool_use");
    expect(toolUseBlock).toMatchObject({
      type: "tool_use",
      id: "call_1",
      name: "list_dir",
      input: { path: "." }
    });
    // Tool message should become user message with tool_result block
    const toolResultMsg = messages.find(
      (m) =>
        m.role === "user" &&
        Array.isArray(m.content) &&
        (m.content as Array<Record<string, unknown>>).some((b) => b.type === "tool_result")
    );
    expect(toolResultMsg).toBeDefined();
    const trBlock = (toolResultMsg!.content as Array<Record<string, unknown>>).find(
      (b) => b.type === "tool_result"
    );
    expect(trBlock).toMatchObject({
      type: "tool_result",
      tool_use_id: "call_1",
      content: "a.txt\nb.txt"
    });
  });

  it("accepts assistant content:null tool-call turns (multi-turn round-trip)", async () => {
    let upstreamBody: Record<string, unknown> | undefined;
    const adapter = new AnthropicMessagesAdapter(new ModelCache(), async (_url, init) => {
      upstreamBody = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({
          id: "msg_5",
          model: "claude-sonnet-4-5",
          content: [{ type: "text", text: "done" }],
          stop_reason: "end_turn",
          usage: { input_tokens: 1, output_tokens: 1 }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    });

    // OpenAI spec: an assistant turn that made tool calls comes back with
    // content: null. This must not crash the OpenAI→Anthropic translation.
    await adapter.chatCompletions(
      {
        model: "claude-sonnet-4-5",
        max_tokens: 256,
        messages: [
          { role: "user", content: "list ." },
          {
            role: "assistant",
            content: null,
            tool_calls: [
              { id: "call_9", type: "function", function: { name: "list_dir", arguments: '{"path":"."}' } }
            ]
          },
          { role: "tool", content: "a.txt", tool_call_id: "call_9" }
        ]
      },
      {
        providerInstance,
        requestId: "req_anthropic_null_content",
        credentialPayload: credential
      }
    );

    const messages = (upstreamBody as { messages: Array<Record<string, unknown>> }).messages;
    const assistantMsg = messages.find((m) => m.role === "assistant");
    const blocks = assistantMsg!.content as Array<Record<string, unknown>>;
    // No spurious empty text block — only the tool_use survives.
    expect(blocks).toEqual([
      { type: "tool_use", id: "call_9", name: "list_dir", input: { path: "." } }
    ]);
  });

  it("emits tool_calls in OpenAI response when upstream returns tool_use", async () => {
    const adapter = new AnthropicMessagesAdapter(new ModelCache(), async () =>
      new Response(
        JSON.stringify({
          id: "msg_3",
          model: "claude-sonnet-4-5",
          content: [
            { type: "text", text: "calling tool" },
            {
              type: "tool_use",
              id: "toolu_01",
              name: "list_dir",
              input: { path: "./src" }
            }
          ],
          stop_reason: "tool_use",
          usage: { input_tokens: 5, output_tokens: 10 }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );

    const result = (await adapter.chatCompletions(
      {
        model: "claude-sonnet-4-5",
        max_tokens: 256,
        messages: [{ role: "user", content: "list" }],
        tools: [
          {
            type: "function",
            function: {
              name: "list_dir",
              description: "list",
              parameters: { type: "object", properties: {} }
            }
          }
        ]
      },
      {
        providerInstance,
        requestId: "req_anthropic_tool_response",
        credentialPayload: credential
      }
    )) as NormalizedOpenAIResponse;

    expect(result.choices[0].finish_reason).toBe("tool_calls");
    expect(result.choices[0].message.content).toBe("calling tool");
    expect(result.choices[0].message.tool_calls).toHaveLength(1);
    expect(result.choices[0].message.tool_calls?.[0]).toMatchObject({
      id: "toolu_01",
      type: "function",
      function: {
        name: "list_dir",
        arguments: '{"path":"./src"}'
      }
    });
  });
});

describe("AnthropicMessagesAdapter messages() (native protocol)", () => {
  it("preserves tool_use content blocks and tool_use stop_reason in native messages() path", async () => {
    const adapter = new AnthropicMessagesAdapter(new ModelCache(), async () =>
      new Response(
        JSON.stringify({
          id: "msg_4",
          model: "claude-sonnet-4-5",
          content: [
            { type: "text", text: "ok" },
            {
              type: "tool_use",
              id: "toolu_02",
              name: "calc",
              input: { x: 1, y: 2 }
            }
          ],
          stop_reason: "tool_use",
          usage: { input_tokens: 3, output_tokens: 4 }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );

    const result = (await adapter.messages(
      {
        model: "claude-sonnet-4-5",
        max_tokens: 256,
        messages: [{ role: "user", content: "add" }],
        tools: [
          {
            name: "calc",
            description: "calc",
            input_schema: { type: "object", properties: {} }
          }
        ]
      },
      {
        providerInstance,
        requestId: "req_anthropic_native",
        credentialPayload: credential
      }
    )) as { content: Array<Record<string, unknown>>; stop_reason: string };

    expect(result.stop_reason).toBe("tool_use");
    expect(result.content).toHaveLength(2);
    expect(result.content[0]).toEqual({ type: "text", text: "ok" });
    expect(result.content[1]).toEqual({
      type: "tool_use",
      id: "toolu_02",
      name: "calc",
      input: { x: 1, y: 2 }
    });
  });

  it("parses upstream SSE into structured events() (text + tool_use)", async () => {
    const sse = [
      'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_x","usage":{"input_tokens":3,"output_tokens":0}}}\n\n',
      'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hi"}}\n\n',
      'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
      'event: content_block_start\ndata: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_9","name":"calc"}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"x\\":"}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"1}"}}\n\n',
      'event: content_block_stop\ndata: {"type":"content_block_stop","index":1}\n\n',
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":7}}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n'
    ].join("");
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(sse));
        controller.close();
      }
    });
    const adapter = new AnthropicMessagesAdapter(new ModelCache(), async () =>
      new Response(stream, {
        status: 200,
        headers: { "content-type": "text/event-stream" }
      })
    );

    const result = (await adapter.messages(
      {
        model: "claude-sonnet-4-5",
        max_tokens: 256,
        stream: true,
        messages: [{ role: "user", content: "calc" }],
        tools: [{ name: "calc", description: "calc", input_schema: { type: "object", properties: {} } }]
      },
      {
        providerInstance,
        requestId: "req_anthropic_stream_tool",
        credentialPayload: credential
      }
    )) as { events?: () => AsyncIterable<unknown> };

    expect(typeof result.events).toBe("function");
    const events: unknown[] = [];
    for await (const ev of result.events!()) events.push(ev);

    expect(events).toEqual([
      { type: "text_delta", text: "Hi" },
      { type: "tool_use_start", id: "toolu_9", name: "calc" },
      { type: "tool_use_delta", id: "toolu_9", partial_json: '{"x":' },
      { type: "tool_use_delta", id: "toolu_9", partial_json: "1}" },
      { type: "tool_use_stop", id: "toolu_9" },
      { type: "message_stop", stop_reason: "tool_use" }
    ]);
  });
});
