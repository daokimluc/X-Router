import { describe, expect, it } from "vitest";
import { AccountPool } from "../account-pool/AccountPool.js";
import { buildApp } from "../app.js";
import { KiroClient } from "../providers/adapters/kiro/KiroClient.js";
import { KiroProviderAdapter } from "../providers/adapters/kiro/KiroProviderAdapter.js";
import { kiroProviderDefinition } from "../providers/adapters/kiro/kiroProviderDefinition.js";
import type { AIProviderAdapter } from "../providers/base/AIProviderAdapter.js";
import type { ProviderAccount } from "../providers/base/ProviderAccount.js";
import type { ProviderInstance } from "../providers/base/ProviderInstance.js";
import type {
  AnthropicMessagesRequest,
  NormalizedAnthropicResponse,
  NormalizedOpenAIResponse,
  OpenAIChatCompletionRequest,
  ProviderContext,
  ProviderHealth,
  ProviderModel,
  ProviderRequestContext,
  ProviderStream
} from "../providers/base/types.js";
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

describe("POST /v1/chat/completions streaming", () => {
  it("forwards provider stream chunks as OpenAI SSE and ends with DONE", async () => {
    const upstream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("hello"));
        controller.enqueue(new TextEncoder().encode(" world"));
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
    const accountPool = new AccountPool([makeAccount("kiro-1")]);
    const app = await buildApp(testConfig({ requestBodyLimit: "16kb" }), {
      providerRegistry,
      providerRuntimeRegistry: new ProviderRuntimeRegistry(
        [providerInstance],
        [
          {
            providerInstanceId: "provider_kiro_main",
            accountPool
          }
        ]
      ),
      secretService: buildSecretService()
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: {
        authorization: "Bearer dev-key-1"
      },
      payload: {
        model: "kiro-sonnet",
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
    expect(response.body).toContain("data: ");
    expect(response.body).toContain("\"object\":\"chat.completion.chunk\"");
    expect(response.body).toContain("\"content\":\"hello\"");
    expect(response.body).toContain("\"content\":\" world\"");
    expect(response.body.trim().endsWith("data: [DONE]")).toBe(true);
    expect(accountPool.getAccount("kiro-1")?.runtime.activeRequests).toBe(0);

    await app.close();
  });

  it("does not retry another account after a stream has started", async () => {
    let calls = 0;
    const adapter: AIProviderAdapter = {
      type: "kiro",
      getCapabilities: () => ({
        protocols: ["openai_chat_completions"],
        flags: ["chat", "streaming"]
      }),
      validateConfig: async () => undefined,
      validateCredential: async () => undefined,
      listModels: async (_context: ProviderContext): Promise<ProviderModel[]> => [],
      chatCompletions: async (
        _request: OpenAIChatCompletionRequest,
        _context: ProviderRequestContext
      ): Promise<NormalizedOpenAIResponse | ProviderStream> => {
        calls += 1;

        return (async function* stream() {
          yield "partial";
          throw new Error("stream broke");
        })();
      },
      messages: async (
        _request: AnthropicMessagesRequest,
        _context: ProviderRequestContext
      ): Promise<NormalizedAnthropicResponse | ProviderStream> => {
        throw new Error("not implemented");
      },
      healthCheck: async (_context: ProviderContext): Promise<ProviderHealth> => ({
        status: "ok"
      })
    };
    const providerRegistry = new ProviderAdapterRegistry();
    providerRegistry.register(kiroProviderDefinition, adapter);
    const accountPool = new AccountPool([makeAccount("kiro-1"), makeAccount("kiro-2")]);
    const app = await buildApp(testConfig({ requestBodyLimit: "16kb" }), {
      providerRegistry,
      providerRuntimeRegistry: new ProviderRuntimeRegistry(
        [providerInstance],
        [
          {
            providerInstanceId: "provider_kiro_main",
            accountPool
          }
        ]
      ),
      secretService: buildSecretService()
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: {
        authorization: "Bearer dev-key-1"
      },
      payload: {
        model: "kiro-sonnet",
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
    expect(response.body).toContain("\"content\":\"partial\"");
    expect(response.body).not.toContain("[DONE]");
    expect(calls).toBe(1);
    expect(accountPool.getAccount("kiro-1")?.runtime.failedRequests).toBe(1);
    expect(accountPool.getAccount("kiro-2")?.runtime.totalRequests).toBe(0);

    await app.close();
  });
});
