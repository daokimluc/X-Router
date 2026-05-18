import { describe, expect, it } from "vitest";
import { AccountPool } from "../account-pool/AccountPool.js";
import { buildApp } from "../app.js";
import { KiroClient } from "../providers/adapters/kiro/KiroClient.js";
import { KiroProviderAdapter } from "../providers/adapters/kiro/KiroProviderAdapter.js";
import { kiroProviderDefinition } from "../providers/adapters/kiro/kiroProviderDefinition.js";
import type { ProviderAccount } from "../providers/base/ProviderAccount.js";
import type { ProviderInstance } from "../providers/base/ProviderInstance.js";
import { ProviderAdapterRegistry } from "../providers/registry/ProviderAdapterRegistry.js";
import { ProviderRuntimeRegistry } from "../provider-runtime/ProviderRuntimeRegistry.js";
import { LocalEncryptionService } from "../services/LocalEncryptionService.js";
import { SecretService } from "../services/SecretService.js";
import { testConfig } from "./helpers.js";

const now = new Date("2026-01-01T00:00:00.000Z");

function makeAccount(id: string): ProviderAccount {
  return {
    id,
    providerInstanceId: "provider_kiro_main",
    providerType: "kiro",
    displayName: id,
    status: "active",
    weight: 1,
    maxConcurrency: 1,
    credentialRef: `secret_${id}`,
    allowedModels: ["kiro-sonnet"],
    runtime: {
      activeRequests: 0,
      totalRequests: 0,
      failedRequests: 0,
      consecutiveFailures: 0
    },
    createdAt: now,
    updatedAt: now
  };
}

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
  cooldownMs: 60000,
  accountSelectionStrategy: "round_robin",
  maxConcurrentRequests: 20,
  maxConcurrentRequestsPerAccount: 3,
  circuitBreaker: {
    enabled: true,
    failureThreshold: 5,
    cooldownMs: 60000,
    halfOpenMaxRequests: 1
  },
  createdAt: now,
  updatedAt: now
};

function buildSecretService(): SecretService {
  const encryptionService = new LocalEncryptionService("test-key");
  const secretService = new SecretService(encryptionService);
  secretService.addSecret({
    id: "secret_kiro_1",
    accountId: "kiro-1",
    credentialType: "refresh_token",
    encryptedPayload: encryptionService.encryptJson({
      accessToken: "access-token"
    }),
    updatedAt: now
  });
  return secretService;
}

function buildProviderRuntimeRegistry(accountPool: AccountPool): ProviderRuntimeRegistry {
  return new ProviderRuntimeRegistry(
    [providerInstance],
    [
      {
        providerInstanceId: "provider_kiro_main",
        accountPool
      }
    ]
  );
}

describe("POST /v1/messages", () => {
  it("returns Anthropic-compatible non-streaming responses", async () => {
    let upstreamBody: unknown;
    const providerRegistry = new ProviderAdapterRegistry();
    providerRegistry.register(
      kiroProviderDefinition,
      new KiroProviderAdapter(
        new KiroClient(async (_url, init) => {
          upstreamBody = JSON.parse(String(init?.body));
          return new Response(
            JSON.stringify({
              id: "chatcmpl_1",
              choices: [
                {
                  message: {
                    role: "assistant",
                    content: "anthropic response"
                  },
                  finish_reason: "stop"
                }
              ],
              usage: {
                prompt_tokens: 4,
                completion_tokens: 5,
                total_tokens: 9
              }
            }),
            {
              status: 200,
              headers: {
                "content-type": "application/json"
              }
            }
          );
        })
      )
    );
    const accountPool = new AccountPool([makeAccount("kiro-1")]);
    const app = await buildApp(testConfig({ requestBodyLimit: "16kb" }), {
      providerRegistry,
      providerRuntimeRegistry: buildProviderRuntimeRegistry(accountPool),
      secretService: buildSecretService()
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/messages",
      headers: {
        authorization: "Bearer dev-key-1"
      },
      payload: {
        model: "kiro-sonnet",
        max_tokens: 128,
        system: "You are concise.",
        messages: [
          {
            role: "user",
            content: "hello"
          }
        ]
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      id: "msg_1",
      type: "message",
      role: "assistant",
      model: "kiro-sonnet",
      content: [
        {
          type: "text",
          text: "anthropic response"
        }
      ],
      stop_reason: "end_turn",
      usage: {
        input_tokens: 4,
        output_tokens: 5
      }
    });
    // KiroClient transforms OpenAI format into Kiro's internal payload format
    expect(upstreamBody).toMatchObject({
      conversationState: {
        chatTriggerType: "MANUAL",
        currentMessage: {
          userInputMessage: {
            content: expect.stringContaining("hello"),
            modelId: "claude-sonnet-4.5"
          }
        },
        history: expect.arrayContaining([
          {
            userInputMessage: {
              content: "System: You are concise.",
              modelId: "claude-sonnet-4.5"
            }
          }
        ])
      },
      inferenceConfig: {
        maxTokens: 128
      }
    });

    await app.close();
  });

  it("returns Anthropic SSE events for streaming responses", async () => {
    const upstream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("hello"));
        controller.enqueue(new TextEncoder().encode(" anthropic"));
        controller.close();
      }
    });
    const providerRegistry = new ProviderAdapterRegistry();
    providerRegistry.register(
      kiroProviderDefinition,
      new KiroProviderAdapter(
        new KiroClient(async () => new Response(upstream, { status: 200 }))
      )
    );
    const app = await buildApp(testConfig({ requestBodyLimit: "16kb" }), {
      providerRegistry,
      providerRuntimeRegistry: buildProviderRuntimeRegistry(
        new AccountPool([makeAccount("kiro-1")])
      ),
      secretService: buildSecretService()
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/messages",
      headers: {
        authorization: "Bearer dev-key-1"
      },
      payload: {
        model: "kiro-sonnet",
        max_tokens: 128,
        stream: true,
        messages: [
          {
            role: "user",
            content: "hello"
          }
        ]
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/event-stream");
    expect(response.body).toContain("event: message_start");
    expect(response.body).toContain("event: content_block_delta");
    expect(response.body).toContain("\"text\":\"hello\"");
    expect(response.body).toContain("\"text\":\" anthropic\"");
    expect(response.body).toContain("event: message_stop");

    await app.close();
  });

  it("requires internal API auth", async () => {
    const app = await buildApp(testConfig({ requestBodyLimit: "16kb" }));

    const response = await app.inject({
      method: "POST",
      url: "/v1/messages",
      payload: {
        model: "kiro-sonnet",
        max_tokens: 128,
        messages: [
          {
            role: "user",
            content: "hello"
          }
        ]
      }
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      error: {
        type: "authentication_error",
        message: "Missing or invalid API key",
        code: "invalid_api_key"
      }
    });

    await app.close();
  });
});

