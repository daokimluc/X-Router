import { describe, it, expect, vi } from "vitest";
import { CodexAdapter } from "../providers/adapters/codex/CodexAdapter.js";

function createMockFetch(response: {
  status?: number;
  body?: unknown;
  stream?: string[];
}) {
  const status = response.status ?? 200;
  const mockResponse = {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    json: async () => response.body,
    text: async () => JSON.stringify(response.body ?? {}),
    body: response.stream
      ? new ReadableStream({
          start(controller) {
            for (const chunk of response.stream!) {
              controller.enqueue(new TextEncoder().encode(chunk));
            }
            controller.close();
          }
        })
      : null
  } as unknown as Response;

  return vi.fn().mockResolvedValue(mockResponse);
}

const baseContext = {
  providerInstance: {
    id: "provider_codex_main",
    type: "codex",
    name: "Codex",
    enabled: true,
    config: { baseUrl: "https://chatgpt.com/backend-api/codex" },
    defaultTimeoutMs: 60000,
    maxRetries: 0,
    cooldownMs: 60000,
    accountSelectionStrategy: "round_robin" as const,
    maxConcurrentRequests: 10,
    maxConcurrentRequestsPerAccount: 3,
    circuitBreaker: { enabled: false, failureThreshold: 5, cooldownMs: 60000, halfOpenMaxRequests: 1 },
    createdAt: new Date(),
    updatedAt: new Date()
  },
  account: { id: "acc-codex-1" } as any,
  requestId: "req-codex-1",
  credentialPayload: { accessToken: "codex-oauth-token-123" }
};

describe("CodexAdapter", () => {
  it("returns provider capabilities", () => {
    const adapter = new CodexAdapter();
    const caps = adapter.getCapabilities();
    expect(caps.protocols).toContain("openai_chat_completions");
    expect(caps.flags).toContain("chat");
    expect(caps.flags).toContain("streaming");
    expect(caps.flags).toContain("tool_calling");
  });

  it("transforms chat completions to Codex Responses API format", async () => {
    const sseChunks = [
      'data: {"type":"response.output_text.delta","delta":"Hello"}\n\n',
      'data: {"type":"response.output_text.delta","delta":" world"}\n\n',
      'data: {"type":"response.completed"}\n\n',
      'data: [DONE]\n\n'
    ];

    const mockFetch = createMockFetch({ stream: sseChunks });
    const adapter = new CodexAdapter(mockFetch);

    const result = await adapter.chatCompletions(
      {
        model: "gpt-5.4",
        messages: [
          { role: "system", content: "You are a coding assistant" },
          { role: "user", content: "Write hello world" }
        ],
        stream: false,
        max_tokens: 1000
      },
      baseContext
    );

    // Verify fetch called with correct URL
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe("https://chatgpt.com/backend-api/codex/responses");
    expect(options.method).toBe("POST");

    // Verify headers
    const headers = options.headers;
    expect(headers["Authorization"]).toBe("Bearer codex-oauth-token-123");
    expect(headers["originator"]).toBe("codex-cli");
    expect(headers["User-Agent"]).toContain("codex-cli");
    expect(headers["session_id"]).toBeDefined();

    // Verify request body is Responses API format
    const body = JSON.parse(options.body);
    expect(body.model).toBe("gpt-5.4");
    expect(body.stream).toBe(true); // Codex always streams
    expect(body.store).toBe(false);
    expect(body.instructions).toBe("You are a coding assistant");
    expect(body.reasoning).toEqual({ effort: "low", summary: "auto" });
    expect(body.include).toContain("reasoning.encrypted_content");

    // Verify input is Responses API format (not messages)
    expect(body.input).toBeDefined();
    expect(Array.isArray(body.input)).toBe(true);
    expect(body.input[0].type).toBe("message");
    expect(body.input[0].role).toBe("user");
    expect(body.input[0].content[0].type).toBe("input_text");
    expect(body.input[0].content[0].text).toBe("Write hello world");

    // Verify response is normalized to OpenAI format (non-streaming collects all)
    const normalized = result as any;
    expect(normalized.object).toBe("chat.completion");
    expect(normalized.choices[0].message.role).toBe("assistant");
    expect(normalized.choices[0].message.content).toBe("Hello world");
    expect(normalized.choices[0].finish_reason).toBe("stop");
  });

  it("returns ProviderStream when stream=true", async () => {
    const sseChunks = [
      'data: {"type":"response.output_text.delta","delta":"Hi"}\n\n',
      'data: {"type":"response.completed"}\n\n',
      'data: [DONE]\n\n'
    ];

    const mockFetch = createMockFetch({ stream: sseChunks });
    const adapter = new CodexAdapter(mockFetch);

    const result = await adapter.chatCompletions(
      {
        model: "gpt-5.3-codex",
        messages: [{ role: "user", content: "hi" }],
        stream: true
      },
      baseContext
    );

    // Should be async iterable
    expect(Symbol.asyncIterator in (result as any)).toBe(true);

    // Collect chunks
    const chunks: string[] = [];
    for await (const chunk of result as AsyncIterable<string>) {
      chunks.push(chunk);
    }

    // Should produce OpenAI SSE format
    expect(chunks.some(c => c.includes("chat.completion.chunk"))).toBe(true);
    expect(chunks.some(c => c.includes('"content":"Hi"'))).toBe(true);
    expect(chunks.some(c => c.includes("[DONE]"))).toBe(true);
  });

  it("refreshes token via OpenAI OAuth endpoint", async () => {
    const tokenResponse = {
      access_token: "new-codex-token",
      refresh_token: "new-refresh",
      expires_in: 3600
    };

    const mockFetch = createMockFetch({ body: tokenResponse });
    const adapter = new CodexAdapter(mockFetch);

    const result = await adapter.refreshSession(
      { id: "acc-1" } as any,
      {
        providerInstance: baseContext.providerInstance,
        credentialPayload: {
          accessToken: "old-token",
          refreshToken: "old-refresh"
        }
      }
    );

    expect(result.refreshed).toBe(true);
    expect(result.credentialPayload?.accessToken).toBe("new-codex-token");

    // Verify token endpoint
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe("https://auth.openai.com/oauth/token");
    expect(options.body).toContain("grant_type=refresh_token");
    expect(options.body).toContain("client_id=app_EMoamEEZ73f0CkXaXp7hrann");
  });

  it("throws auth error on 401", async () => {
    const mockFetch = createMockFetch({ status: 401 });
    const adapter = new CodexAdapter(mockFetch);

    await expect(
      adapter.chatCompletions(
        { model: "gpt-5.4", messages: [{ role: "user", content: "hi" }] },
        baseContext
      )
    ).rejects.toThrow("Access token expired or invalid");
  });

  it("throws rate limit error on 429", async () => {
    const mockFetch = createMockFetch({ status: 429 });
    const adapter = new CodexAdapter(mockFetch);

    await expect(
      adapter.chatCompletions(
        { model: "gpt-5.4", messages: [{ role: "user", content: "hi" }] },
        baseContext
      )
    ).rejects.toThrow("Rate limited");
  });

  it("system message becomes instructions field", async () => {
    const sseChunks = ['data: {"type":"response.output_text.delta","delta":"ok"}\n\n', 'data: [DONE]\n\n'];
    const mockFetch = createMockFetch({ stream: sseChunks });
    const adapter = new CodexAdapter(mockFetch);

    await adapter.chatCompletions(
      {
        model: "gpt-5.4",
        messages: [
          { role: "system", content: "Custom system prompt" },
          { role: "user", content: "test" }
        ],
        stream: false
      },
      baseContext
    );

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.instructions).toBe("Custom system prompt");
    // System message should NOT appear in input
    expect(body.input.every((i: any) => i.role !== "system")).toBe(true);
  });
});
