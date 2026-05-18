import { describe, it, expect, vi } from "vitest";
import { GitHubCopilotAdapter } from "../providers/adapters/github-copilot/GitHubCopilotAdapter.js";

function createMockFetch(responses: Array<{ status?: number; body?: unknown; stream?: string[] }>) {
  let callIndex = 0;
  return vi.fn().mockImplementation(async () => {
    const response = responses[callIndex] ?? responses[responses.length - 1];
    callIndex++;
    const status = response.status ?? 200;
    return {
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
  });
}

const baseContext = {
  providerInstance: {
    id: "provider_github_copilot_main",
    type: "github_copilot",
    name: "GitHub Copilot",
    enabled: true,
    config: {},
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
  account: { id: "acc-gh-1" } as any,
  requestId: "req-gh-1",
  credentialPayload: {
    accessToken: "gho_github_token",
    copilotToken: "tid=copilot-token-123;exp=9999999999"
  }
};

describe("GitHubCopilotAdapter", () => {
  it("returns provider capabilities", () => {
    const adapter = new GitHubCopilotAdapter();
    const caps = adapter.getCapabilities();
    expect(caps.protocols).toContain("openai_chat_completions");
    expect(caps.flags).toContain("chat");
    expect(caps.flags).toContain("streaming");
    expect(caps.flags).toContain("tool_calling");
  });

  it("routes requests to api.githubcopilot.com with correct headers", async () => {
    const chatResponse = {
      id: "chatcmpl-123",
      object: "chat.completion",
      created: 1700000000,
      model: "gpt-4o",
      choices: [{
        index: 0,
        message: { role: "assistant", content: "Hello!" },
        finish_reason: "stop"
      }]
    };

    const mockFetch = createMockFetch([{ body: chatResponse }]);
    const adapter = new GitHubCopilotAdapter(mockFetch);

    const result = await adapter.chatCompletions(
      {
        model: "gpt-4o",
        messages: [{ role: "user", content: "Hello" }],
        stream: false
      },
      baseContext
    );

    // Verify URL
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.githubcopilot.com/chat/completions");
    expect(options.method).toBe("POST");

    // Verify Copilot-specific headers
    const headers = options.headers;
    expect(headers["Authorization"]).toBe("Bearer tid=copilot-token-123;exp=9999999999");
    expect(headers["copilot-integration-id"]).toBe("vscode-chat");
    expect(headers["editor-version"]).toContain("vscode/");
    expect(headers["editor-plugin-version"]).toContain("copilot-chat/");
    expect(headers["user-agent"]).toContain("GitHubCopilotChat");
    expect(headers["x-github-api-version"]).toBeDefined();
    expect(headers["x-request-id"]).toBeDefined();

    // Verify response
    const normalized = result as any;
    expect(normalized.choices[0].message.content).toBe("Hello!");
  });

  it("fetches copilot token when not provided in credentials", async () => {
    // First call: fetch copilot token
    // Second call: actual chat completion
    const mockFetch = createMockFetch([
      { body: { token: "new-copilot-token", expires_at: "2099-01-01T00:00:00Z" } },
      { body: { id: "chatcmpl-1", object: "chat.completion", created: 1, model: "gpt-4o", choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }] } }
    ]);
    const adapter = new GitHubCopilotAdapter(mockFetch);

    const contextWithoutCopilotToken = {
      ...baseContext,
      credentialPayload: { accessToken: "gho_github_token" } // no copilotToken
    };

    const result = await adapter.chatCompletions(
      { model: "gpt-4o", messages: [{ role: "user", content: "hi" }], stream: false },
      contextWithoutCopilotToken
    );

    // First call should be to copilot token endpoint
    expect(mockFetch.mock.calls[0][0]).toBe("https://api.github.com/copilot_internal/v2/token");
    const tokenHeaders = mockFetch.mock.calls[0][1]?.headers;
    expect(tokenHeaders?.["Authorization"]).toBe("token gho_github_token");

    // Second call should use the new copilot token
    expect(mockFetch.mock.calls[1][0]).toBe("https://api.githubcopilot.com/chat/completions");
    expect(mockFetch.mock.calls[1][1]?.headers?.["Authorization"]).toBe("Bearer new-copilot-token");

    expect((result as any).choices[0].message.content).toBe("ok");
  });

  it("sanitizes messages - removes non-text/image_url content types", async () => {
    const mockFetch = createMockFetch([{
      body: { id: "1", object: "chat.completion", created: 1, model: "gpt-4o", choices: [{ index: 0, message: { role: "assistant", content: "done" }, finish_reason: "stop" }] }
    }]);
    const adapter = new GitHubCopilotAdapter(mockFetch);

    await adapter.chatCompletions(
      {
        model: "claude-sonnet-4.6",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "Look at this" },
              { type: "tool_result", content: "some tool output" },
              { type: "image_url", image_url: { url: "data:image/png;base64,..." } }
            ] as any
          }
        ],
        stream: false
      },
      baseContext
    );

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    const content = body.messages[0].content;

    // text and image_url should be kept, tool_result should be converted to text
    expect(content.some((p: any) => p.type === "text" && p.text === "Look at this")).toBe(true);
    expect(content.some((p: any) => p.type === "image_url")).toBe(true);
    // tool_result should be serialized as text
    expect(content.some((p: any) => p.type === "text" && p.text.includes("tool_result"))).toBe(true);
  });

  it("refreshes session by getting new copilot token", async () => {
    const mockFetch = createMockFetch([
      { body: { token: "refreshed-copilot-token", expires_at: "2099-12-31T00:00:00Z" } }
    ]);
    const adapter = new GitHubCopilotAdapter(mockFetch);

    const result = await adapter.refreshSession(
      { id: "acc-1" } as any,
      {
        providerInstance: baseContext.providerInstance,
        credentialPayload: {
          accessToken: "gho_github_token",
          copilotToken: "old-copilot-token"
        }
      }
    );

    expect(result.refreshed).toBe(true);
    expect(result.credentialPayload?.copilotToken).toBe("refreshed-copilot-token");
    expect(result.credentialPayload?.accessToken).toBe("gho_github_token");
  });

  it("throws auth error on 401", async () => {
    const mockFetch = createMockFetch([{ status: 401 }]);
    const adapter = new GitHubCopilotAdapter(mockFetch);

    await expect(
      adapter.chatCompletions(
        { model: "gpt-4o", messages: [{ role: "user", content: "hi" }] },
        baseContext
      )
    ).rejects.toThrow("Copilot token expired or invalid");
  });

  it("supports device code flow start", async () => {
    const mockFetch = createMockFetch([{
      body: {
        device_code: "dc_123",
        user_code: "ABCD-1234",
        verification_uri: "https://github.com/login/device",
        expires_in: 900,
        interval: 5
      }
    }]);
    const adapter = new GitHubCopilotAdapter(mockFetch);

    const result = await adapter.startDeviceCodeFlow();

    expect(result).not.toBeNull();
    expect(result!.deviceCode).toBe("dc_123");
    expect(result!.userCode).toBe("ABCD-1234");
    expect(result!.verificationUri).toBe("https://github.com/login/device");
    expect(result!.expiresIn).toBe(900);
    expect(result!.interval).toBe(5);

    // Verify request
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe("https://github.com/login/device/code");
    const body = JSON.parse(options.body);
    expect(body.client_id).toBe("Iv1.b507a08c87ecfe98");
    expect(body.scope).toBe("read:user");
  });

  it("polls device code and returns token on success", async () => {
    const mockFetch = createMockFetch([{
      body: { access_token: "gho_new_token", refresh_token: "ghr_refresh" }
    }]);
    const adapter = new GitHubCopilotAdapter(mockFetch);

    const result = await adapter.pollDeviceCode("dc_123");

    expect(result).not.toBeNull();
    expect(result!.accessToken).toBe("gho_new_token");
    expect(result!.refreshToken).toBe("ghr_refresh");
  });

  it("returns null when device code poll is still pending", async () => {
    const mockFetch = createMockFetch([{
      body: { error: "authorization_pending" }
    }]);
    const adapter = new GitHubCopilotAdapter(mockFetch);

    const result = await adapter.pollDeviceCode("dc_123");
    expect(result).toBeNull();
  });
});
