import { describe, expect, it } from "vitest";
import { KiroClient } from "../providers/adapters/kiro/KiroClient.js";
import { KiroProviderAdapter } from "../providers/adapters/kiro/KiroProviderAdapter.js";
import { KiroSessionManager } from "../providers/adapters/kiro/KiroSessionManager.js";
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

describe("KiroProviderAdapter", () => {
  it("normalizes non-streaming OpenAI-compatible responses", async () => {
    const fetchImpl = async () =>
      new Response(
        JSON.stringify({
          id: "upstream_1",
          choices: [
            {
              message: {
                role: "assistant",
                content: "hello from kiro"
              },
              finish_reason: "stop"
            }
          ],
          usage: {
            prompt_tokens: 1,
            completion_tokens: 2,
            total_tokens: 3
          }
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      );
    const adapter = new KiroProviderAdapter(new KiroClient(fetchImpl));

    const response = await adapter.chatCompletions(
      {
        model: "kiro-sonnet",
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
          accessToken: "access-token"
        }
      }
    );

    expect(response).toMatchObject({
      id: "upstream_1",
      object: "chat.completion",
      model: "kiro-sonnet",
      choices: [
        {
          message: {
            role: "assistant",
            content: "hello from kiro"
          }
        }
      ],
      usage: {
        prompt_tokens: 1,
        completion_tokens: 2,
        total_tokens: 3
      }
    });
  });

  it("returns provider stream deltas for streaming responses", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("hello"));
        controller.enqueue(new TextEncoder().encode(" stream"));
        controller.close();
      }
    });
    const adapter = new KiroProviderAdapter(
      new KiroClient(async () => new Response(stream, { status: 200 }))
    );

    const response = await adapter.chatCompletions(
      {
        model: "kiro-sonnet",
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
          accessToken: "access-token"
        }
      }
    );

    const chunks: string[] = [];

    for await (const chunk of response as AsyncIterable<string>) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual(["hello", " stream"]);
  });

  it("classifies rate limits as retryable provider errors", async () => {
    const fetchImpl = async () => new Response("{}", { status: 429 });
    const adapter = new KiroProviderAdapter(new KiroClient(fetchImpl));

    await expect(
      adapter.chatCompletions(
        {
          model: "kiro-sonnet",
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
            accessToken: "access-token"
          }
        }
      )
    ).rejects.toMatchObject({
      code: "provider_rate_limited",
      retryable: true
    });
  });
});

describe("KiroSessionManager", () => {
  it("builds the desktop refresh endpoint from credential region", () => {
    const manager = new KiroSessionManager();

    expect(
      manager.getDesktopRefreshUrl({
        region: "us-west-2"
      })
    ).toBe("https://prod.us-west-2.auth.desktop.kiro.dev/refreshToken");
  });
});
