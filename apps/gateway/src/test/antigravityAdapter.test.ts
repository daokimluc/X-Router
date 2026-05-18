import { describe, it, expect, vi } from "vitest";
import { AntigravityAdapter } from "../providers/adapters/antigravity/AntigravityAdapter.js";

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

describe("AntigravityAdapter", () => {
  it("returns provider capabilities", () => {
    const adapter = new AntigravityAdapter();
    const caps = adapter.getCapabilities();
    expect(caps.protocols).toContain("openai_chat_completions");
    expect(caps.flags).toContain("chat");
    expect(caps.flags).toContain("streaming");
  });

  it("transforms OpenAI chat completions to Gemini format and calls correct URL", async () => {
    const geminiResponse = {
      candidates: [{
        content: {
          parts: [{ text: "Hello! How can I help?" }]
        },
        finishReason: "STOP"
      }],
      usageMetadata: {
        promptTokenCount: 10,
        candidatesTokenCount: 8,
        totalTokenCount: 18
      }
    };

    const mockFetch = createMockFetch({ body: geminiResponse });
    const adapter = new AntigravityAdapter(mockFetch);

    const result = await adapter.chatCompletions(
      {
        model: "gemini-3-flash",
        messages: [
          { role: "system", content: "You are helpful" },
          { role: "user", content: "Hello" }
        ],
        stream: false,
        max_tokens: 100
      },
      {
        providerInstance: {
          id: "test-instance",
          type: "antigravity",
          name: "Test",
          enabled: true,
          config: {},
          defaultTimeoutMs: 30000,
          maxRetries: 0,
          cooldownMs: 60000,
          accountSelectionStrategy: "round_robin",
          maxConcurrentRequests: 10,
          maxConcurrentRequestsPerAccount: 3,
          circuitBreaker: { enabled: false, failureThreshold: 5, cooldownMs: 60000, halfOpenMaxRequests: 1 },
          createdAt: new Date(),
          updatedAt: new Date()
        },
        account: { id: "acc-1" } as any,
        requestId: "req-1",
        credentialPayload: {
          accessToken: "ya29.test-token",
          refreshToken: "1//test-refresh"
        }
      }
    );

    // Verify fetch was called with correct URL
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe("https://daily-cloudcode-pa.googleapis.com/v1internal:generateContent");
    expect(options.method).toBe("POST");

    // Verify headers
    const headers = options.headers;
    expect(headers["Authorization"]).toBe("Bearer ya29.test-token");
    expect(headers["x-request-source"]).toBe("local");
    expect(headers["Content-Type"]).toBe("application/json");

    // Verify request body format (Gemini wrapper)
    const body = JSON.parse(options.body);
    expect(body.model).toBe("gemini-3-flash");
    expect(body.userAgent).toBe("antigravity");
    expect(body.requestType).toBe("agent");
    expect(body.requestId).toMatch(/^agent-/);
    expect(body.request.contents).toBeDefined();
    expect(body.request.generationConfig.maxOutputTokens).toBe(100);
    expect(body.request.sessionId).toBeDefined();

    // Verify system message is converted to user message
    expect(body.request.contents[0].role).toBe("user");
    expect(body.request.contents[0].parts[0].text).toContain("System Instructions");
    expect(body.request.contents[0].parts[0].text).toContain("You are helpful");

    // Verify response is normalized to OpenAI format
    const normalized = result as any;
    expect(normalized.object).toBe("chat.completion");
    expect(normalized.choices[0].message.role).toBe("assistant");
    expect(normalized.choices[0].message.content).toBe("Hello! How can I help?");
    expect(normalized.choices[0].finish_reason).toBe("stop");
    expect(normalized.usage.prompt_tokens).toBe(10);
    expect(normalized.usage.completion_tokens).toBe(8);
  });

  it("uses streaming URL with alt=sse when stream=true", async () => {
    const sseChunks = [
      'data: {"candidates":[{"content":{"parts":[{"text":"Hi"}]},"finishReason":"STOP"}]}\n\n',
      'data: [DONE]\n\n'
    ];

    const mockFetch = createMockFetch({ stream: sseChunks });
    const adapter = new AntigravityAdapter(mockFetch);

    const result = await adapter.chatCompletions(
      {
        model: "gemini-3-flash",
        messages: [{ role: "user", content: "Hi" }],
        stream: true
      },
      {
        providerInstance: {
          id: "test-instance",
          type: "antigravity",
          name: "Test",
          enabled: true,
          config: {},
          defaultTimeoutMs: 30000,
          maxRetries: 0,
          cooldownMs: 60000,
          accountSelectionStrategy: "round_robin",
          maxConcurrentRequests: 10,
          maxConcurrentRequestsPerAccount: 3,
          circuitBreaker: { enabled: false, failureThreshold: 5, cooldownMs: 60000, halfOpenMaxRequests: 1 },
          createdAt: new Date(),
          updatedAt: new Date()
        },
        account: { id: "acc-1" } as any,
        requestId: "req-1",
        credentialPayload: { accessToken: "ya29.test" }
      }
    );

    // Verify streaming URL
    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe("https://daily-cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse");

    // Verify result is async iterable (ProviderStream)
    expect(Symbol.asyncIterator in (result as any)).toBe(true);

    // Collect stream chunks
    const chunks: string[] = [];
    for await (const chunk of result as AsyncIterable<string>) {
      chunks.push(chunk);
    }
    expect(chunks.length).toBeGreaterThan(0);
    // Should contain OpenAI-format SSE
    expect(chunks.some(c => c.includes("chat.completion.chunk"))).toBe(true);
  });

  it("refreshes Google OAuth token", async () => {
    const tokenResponse = {
      access_token: "ya29.new-token",
      refresh_token: "1//new-refresh",
      expires_in: 3600
    };

    const mockFetch = createMockFetch({ body: tokenResponse });
    const adapter = new AntigravityAdapter(mockFetch);

    const result = await adapter.refreshSession(
      { id: "acc-1" } as any,
      {
        providerInstance: {
          id: "test-instance",
          type: "antigravity",
          name: "Test",
          enabled: true,
          config: {},
          defaultTimeoutMs: 30000,
          maxRetries: 0,
          cooldownMs: 60000,
          accountSelectionStrategy: "round_robin",
          maxConcurrentRequests: 10,
          maxConcurrentRequestsPerAccount: 3,
          circuitBreaker: { enabled: false, failureThreshold: 5, cooldownMs: 60000, halfOpenMaxRequests: 1 },
          createdAt: new Date(),
          updatedAt: new Date()
        },
        credentialPayload: {
          accessToken: "ya29.old",
          refreshToken: "1//old-refresh"
        }
      }
    );

    expect(result.refreshed).toBe(true);
    expect(result.credentialPayload?.accessToken).toBe("ya29.new-token");
    expect(result.credentialPayload?.refreshToken).toBe("1//new-refresh");

    // Verify token endpoint called
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe("https://oauth2.googleapis.com/token");
    expect(options.body).toContain("grant_type=refresh_token");
    expect(options.body).toContain("refresh_token=1%2F%2Fold-refresh");
  });

  it("throws auth error on 401/403", async () => {
    const mockFetch = createMockFetch({ status: 401 });
    const adapter = new AntigravityAdapter(mockFetch);

    await expect(
      adapter.chatCompletions(
        { model: "gemini-3-flash", messages: [{ role: "user", content: "hi" }] },
        {
          providerInstance: {
            id: "test", type: "antigravity", name: "Test", enabled: true, config: {},
            defaultTimeoutMs: 30000, maxRetries: 0, cooldownMs: 60000,
            accountSelectionStrategy: "round_robin", maxConcurrentRequests: 10,
            maxConcurrentRequestsPerAccount: 3,
            circuitBreaker: { enabled: false, failureThreshold: 5, cooldownMs: 60000, halfOpenMaxRequests: 1 },
            createdAt: new Date(), updatedAt: new Date()
          },
          account: { id: "acc-1" } as any,
          requestId: "req-1",
          credentialPayload: { accessToken: "expired" }
        }
      )
    ).rejects.toThrow("Access token expired or invalid");
  });
});
