import { describe, expect, it } from "vitest";
import { MockProviderAdapter } from "../providers/adapters/mock/MockProviderAdapter.js";
import { UnsupportedCapabilityError } from "../providers/base/ProviderErrors.js";
import type { ProviderInstance } from "../providers/base/ProviderInstance.js";

const providerInstance: ProviderInstance = {
  id: "provider_mock_main",
  type: "mock",
  name: "Mock Main",
  enabled: true,
  config: {},
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

describe("MockProviderAdapter", () => {
  it("returns provider capabilities", () => {
    const adapter = new MockProviderAdapter();

    expect(adapter.getCapabilities()).toMatchObject({
      protocols: ["openai_chat_completions", "anthropic_messages"],
      flags: ["chat", "messages", "streaming"]
    });
  });

  it("lists mock models", async () => {
    const adapter = new MockProviderAdapter();

    await expect(
      adapter.listModels({ providerInstance })
    ).resolves.toMatchObject([
      {
        id: "mock-fast",
        upstreamModel: "mock-fast"
      },
      {
        id: "mock-stream",
        upstreamModel: "mock-stream"
      }
    ]);
  });

  it("returns normalized OpenAI-compatible chat responses", async () => {
    const adapter = new MockProviderAdapter();

    const response = await adapter.chatCompletions(
      {
        model: "mock-fast",
        messages: [
          {
            role: "user",
            content: "hello"
          }
        ]
      },
      {
        providerInstance,
        requestId: "req_1"
      }
    );

    expect(response).toMatchObject({
      object: "chat.completion",
      model: "mock-fast",
      choices: [
        {
          message: {
            role: "assistant",
            content: "mock response"
          }
        }
      ]
    });
  });

  it("returns normalized Anthropic-compatible messages responses", async () => {
    const adapter = new MockProviderAdapter();

    const response = await adapter.messages(
      {
        model: "mock-fast",
        max_tokens: 128,
        messages: [
          {
            role: "user",
            content: "hello"
          }
        ]
      },
      {
        providerInstance,
        requestId: "req_1"
      }
    );

    expect(response).toMatchObject({
      type: "message",
      role: "assistant",
      model: "mock-fast",
      content: [
        {
          type: "text",
          text: "mock response"
        }
      ]
    });
  });

  it("reports healthy status", async () => {
    const adapter = new MockProviderAdapter();

    await expect(adapter.healthCheck({ providerInstance })).resolves.toEqual({
      status: "ok"
    });
  });

  it("can throw unsupported capability errors for tests", async () => {
    const adapter = new MockProviderAdapter();

    await expect(adapter.unsupportedCapability()).rejects.toBeInstanceOf(
      UnsupportedCapabilityError
    );
  });
});

