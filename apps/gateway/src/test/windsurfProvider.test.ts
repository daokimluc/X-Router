import { describe, expect, it } from "vitest";
import type { ProviderInstance } from "../providers/base/ProviderInstance.js";
import { WindsurfClient } from "../providers/adapters/windsurf/WindsurfClient.js";
import { WindsurfProviderAdapter } from "../providers/adapters/windsurf/WindsurfProviderAdapter.js";
import { WindsurfSessionManager } from "../providers/adapters/windsurf/WindsurfSessionManager.js";

const providerInstance: ProviderInstance = {
  id: "provider_windsurf_main",
  type: "windsurf",
  name: "Windsurf Main",
  enabled: true,
  config: {
    baseUrl: "https://windsurf.test",
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

// These tests cover the legacy cloud-chat path (HTTP POST to
// `server.self-serve.windsurf.com`), which has been replaced by the
// local language-server flow. The cloud `GetChatMessage` endpoint
// rejects external clients with `invalid_argument`. The new flow
// requires an actual Windsurf LS subprocess, which is not available in
// CI; targeted unit tests live in `internal/proto.test.ts` etc. and
// integration coverage is via the `apps/gateway` end-to-end harness.
// Re-enable here only if you re-introduce a cloud-chat fallback.
describe.skip("WindsurfProviderAdapter (legacy cloud-chat path)", () => {
  it("normalizes non-streaming OpenAI-compatible responses", async () => {
    const fetchImpl = async () =>
      new Response(
        JSON.stringify({
          id: "windsurf_upstream_1",
          choices: [
            {
              message: {
                role: "assistant",
                content: "hello from windsurf"
              },
              finish_reason: "stop"
            }
          ],
          usage: {
            prompt_tokens: 2,
            completion_tokens: 3,
            total_tokens: 5
          }
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      );
    const adapter = new WindsurfProviderAdapter(new WindsurfClient(fetchImpl));

    const response = await adapter.chatCompletions(
      {
        model: "windsurf-sonnet",
        messages: [
          {
            role: "user",
            content: "hello"
          }
        ]
      },
      {
        providerInstance,
        requestId: "req_1",
        credentialPayload: {
          token: "windsurf-token"
        }
      }
    );

    expect(response).toMatchObject({
      id: "windsurf_upstream_1",
      object: "chat.completion",
      model: "windsurf-sonnet",
      choices: [
        {
          message: {
            role: "assistant",
            content: "hello from windsurf"
          }
        }
      ],
      usage: {
        prompt_tokens: 2,
        completion_tokens: 3,
        total_tokens: 5
      }
    });
  });

  it("returns provider stream deltas for streaming responses", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("hello"));
        controller.enqueue(new TextEncoder().encode(" windsurf"));
        controller.close();
      }
    });
    const adapter = new WindsurfProviderAdapter(
      new WindsurfClient(async () => new Response(stream, { status: 200 }))
    );

    const response = await adapter.chatCompletions(
      {
        model: "windsurf-sonnet",
        messages: [
          {
            role: "user",
            content: "hello"
          }
        ],
        stream: true
      },
      {
        providerInstance,
        requestId: "req_1",
        credentialPayload: {
          token: "windsurf-token"
        }
      }
    );

    const chunks: string[] = [];

    for await (const chunk of response as AsyncIterable<string>) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual(["hello", " windsurf"]);
  });

  it("classifies auth errors as non-retryable provider errors", async () => {
    const fetchImpl = async () => new Response("{}", { status: 401 });
    const adapter = new WindsurfProviderAdapter(new WindsurfClient(fetchImpl));

    await expect(
      adapter.chatCompletions(
        {
          model: "windsurf-sonnet",
          messages: [
            {
              role: "user",
              content: "hello"
            }
          ]
        },
        {
          providerInstance,
          requestId: "req_1",
          credentialPayload: {
            token: "windsurf-token"
          }
        }
      )
    ).rejects.toMatchObject({
      code: "provider_auth_error",
      retryable: false
    });
  });
});

describe("WindsurfSessionManager", () => {
  it("returns a non-refresh result for now", async () => {
    const manager = new WindsurfSessionManager();

    await expect(
      manager.refreshSession(
        {
          id: "windsurf-1",
          providerInstanceId: "provider_windsurf_main",
          providerType: "windsurf",
          displayName: "Windsurf 1",
          status: "active",
          weight: 1,
          maxConcurrency: 1,
          credentialRef: "secret_windsurf_1",
          runtime: {
            activeRequests: 0,
            totalRequests: 0,
            failedRequests: 0,
            consecutiveFailures: 0
          },
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
          updatedAt: new Date("2026-01-01T00:00:00.000Z")
        },
        {
          providerInstance
        }
      )
    ).resolves.toMatchObject({
      refreshed: false
    });
  });
});
