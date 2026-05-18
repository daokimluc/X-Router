import { describe, it, expect } from "vitest";
import { buildApp } from "../app.js";
import { ProviderAdapterRegistry } from "../providers/registry/ProviderAdapterRegistry.js";
import { ProviderRuntimeRegistry } from "../provider-runtime/ProviderRuntimeRegistry.js";
import { AccountPool } from "../account-pool/AccountPool.js";
import { SecretService } from "../services/SecretService.js";
import { LocalEncryptionService } from "../services/LocalEncryptionService.js";
import { MockProviderAdapter } from "../providers/adapters/mock/MockProviderAdapter.js";
import { mockProviderDefinition } from "../providers/adapters/mock/mockProviderDefinition.js";
import type { ProviderAccount } from "../providers/base/ProviderAccount.js";
import type { ProviderInstance } from "../providers/base/ProviderInstance.js";
import type { ProviderTypeDefinition } from "../providers/registry/ProviderTypeDefinition.js";
import type { AIProviderAdapter } from "../providers/base/AIProviderAdapter.js";
import type {
  NormalizedAnthropicResponse,
  NormalizedOpenAIResponse,
  ProviderStream
} from "../providers/base/types.js";
import { testConfig } from "./helpers.js";

// A minimal adapter that only supports openai_chat_completions
const openaiOnlyAdapter: AIProviderAdapter = {
  type: "openai_only_test",
  getCapabilities: () => ({
    protocols: ["openai_chat_completions"],
    flags: ["chat", "streaming"]
  }),
  validateConfig: async () => {},
  validateCredential: async () => {},
  listModels: async () => [],
  chatCompletions: async () => ({
    id: "chatcmpl-test",
    object: "chat.completion" as const,
    created: Date.now(),
    model: "test-model",
    choices: [
      {
        index: 0,
        message: { role: "assistant" as const, content: "hello from openai adapter" },
        finish_reason: "stop" as const
      }
    ],
    usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 }
  }),
  messages: async () => ({
    id: "msg-test",
    type: "message" as const,
    role: "assistant" as const,
    model: "test-model",
    content: [{ type: "text" as const, text: "not supported" }],
    stop_reason: "end_turn" as const
  }),
  healthCheck: async () => ({ status: "ok" as const })
};

// A minimal adapter that only supports anthropic_messages
const anthropicOnlyAdapter: AIProviderAdapter = {
  type: "anthropic_only_test",
  getCapabilities: () => ({
    protocols: ["anthropic_messages"],
    flags: ["messages", "streaming"]
  }),
  validateConfig: async () => {},
  validateCredential: async () => {},
  listModels: async () => [],
  chatCompletions: async () => ({
    id: "chatcmpl-test",
    object: "chat.completion" as const,
    created: Date.now(),
    model: "test-model",
    choices: [
      {
        index: 0,
        message: { role: "assistant" as const, content: "not supported" },
        finish_reason: "stop" as const
      }
    ],
    usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 }
  }),
  messages: async () => ({
    id: "msg-test",
    type: "message" as const,
    role: "assistant" as const,
    model: "test-model",
    content: [{ type: "text" as const, text: "hello from anthropic adapter" }],
    stop_reason: "end_turn" as const
  }),
  healthCheck: async () => ({ status: "ok" as const })
};

const openaiOnlyDefinition: ProviderTypeDefinition = {
  type: "openai_only_test",
  displayName: "OpenAI Only Test",
  adapterName: "openai_only_test",
  authMethods: ["api_key"],
  supportedProtocols: ["openai_chat_completions"],
  capabilities: { protocols: ["openai_chat_completions"], flags: ["chat", "streaming"] },
  configSchema: { type: "object", properties: {} },
  credentialSchema: { type: "object", properties: { apiKey: { type: "string" } }, required: ["apiKey"] }
};

const anthropicOnlyDefinition: ProviderTypeDefinition = {
  type: "anthropic_only_test",
  displayName: "Anthropic Only Test",
  adapterName: "anthropic_only_test",
  authMethods: ["api_key"],
  supportedProtocols: ["anthropic_messages"],
  capabilities: { protocols: ["anthropic_messages"], flags: ["messages", "streaming"] },
  configSchema: { type: "object", properties: {} },
  credentialSchema: { type: "object", properties: { apiKey: { type: "string" } }, required: ["apiKey"] }
};

function makeAccount(id: string, providerType: string, providerInstanceId: string): ProviderAccount {
  return {
    id,
    providerInstanceId,
    providerType,
    displayName: `Test Account ${id}`,
    status: "active",
    weight: 1,
    maxConcurrency: 10,
    credentialRef: `secret-${id}`,
    runtime: {
      activeRequests: 0,
      totalRequests: 0,
      failedRequests: 0,
      consecutiveFailures: 0
    },
    createdAt: new Date(),
    updatedAt: new Date()
  };
}

function makeProviderInstance(id: string, type: string): ProviderInstance {
  return {
    id,
    type,
    name: `Test Instance ${id}`,
    enabled: true,
    priority: 1,
    config: {},
    defaultTimeoutMs: 30000,
    maxRetries: 0,
    cooldownMs: 5000,
    accountSelectionStrategy: "round_robin",
    maxConcurrentRequests: 10,
    maxConcurrentRequestsPerAccount: 5,
    circuitBreaker: {
      enabled: false,
      failureThreshold: 5,
      cooldownMs: 30000,
      halfOpenMaxRequests: 1
    },
    createdAt: new Date(),
    updatedAt: new Date()
  };
}

function buildSecretService(): SecretService {
  const encryptionService = new LocalEncryptionService("test-key");
  const service = new SecretService(encryptionService);
  service.addSecret({
    id: "secret-openai-account-1",
    accountId: "openai-account-1",
    credentialType: "api_key",
    encryptedPayload: encryptionService.encryptJson({ apiKey: "sk-test-key" }),
    updatedAt: new Date()
  });
  service.addSecret({
    id: "secret-anthropic-account-1",
    accountId: "anthropic-account-1",
    credentialType: "api_key",
    encryptedPayload: encryptionService.encryptJson({ apiKey: "sk-ant-test-key" }),
    updatedAt: new Date()
  });
  return service;
}

describe("Request routing with protocol validation", () => {
  it("returns 404 when x-provider-account-id references non-existent account", async () => {
    const providerRegistry = new ProviderAdapterRegistry();
    providerRegistry.register(mockProviderDefinition, new MockProviderAdapter());
    providerRegistry.register(openaiOnlyDefinition, openaiOnlyAdapter);

    const providerInstance = makeProviderInstance("inst-1", "openai_only_test");
    const account = makeAccount("openai-account-1", "openai_only_test", "inst-1");
    const accountPool = new AccountPool([account]);

    const providerRuntimeRegistry = new ProviderRuntimeRegistry(
      [providerInstance],
      [{ providerInstanceId: "inst-1", accountPool }]
    );

    const app = await buildApp(testConfig({ requestBodyLimit: "16kb" }), {
      providerRegistry,
      providerRuntimeRegistry,
      secretService: buildSecretService()
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: {
        authorization: "Bearer dev-key-1",
        "x-provider-account-id": "non-existent-account"
      },
      payload: {
        model: "test-model",
        messages: [{ role: "user", content: "hello" }]
      }
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("account_not_found");
  });

  it("returns 400 when protocol is incompatible (openai endpoint with anthropic-only provider)", async () => {
    const providerRegistry = new ProviderAdapterRegistry();
    providerRegistry.register(mockProviderDefinition, new MockProviderAdapter());
    providerRegistry.register(anthropicOnlyDefinition, anthropicOnlyAdapter);

    const providerInstance = makeProviderInstance("inst-ant", "anthropic_only_test");
    const account = makeAccount("anthropic-account-1", "anthropic_only_test", "inst-ant");
    const accountPool = new AccountPool([account]);

    const providerRuntimeRegistry = new ProviderRuntimeRegistry(
      [providerInstance],
      [{ providerInstanceId: "inst-ant", accountPool }]
    );

    const app = await buildApp(testConfig({ requestBodyLimit: "16kb" }), {
      providerRegistry,
      providerRuntimeRegistry,
      secretService: buildSecretService()
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: {
        authorization: "Bearer dev-key-1",
        "x-provider-account-id": "anthropic-account-1"
      },
      payload: {
        model: "test-model",
        messages: [{ role: "user", content: "hello" }]
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("protocol_not_supported");
    expect(response.json().error.message).toContain("anthropic_messages");
  });

  it("returns 400 when protocol is incompatible (anthropic endpoint with openai-only provider)", async () => {
    const providerRegistry = new ProviderAdapterRegistry();
    providerRegistry.register(mockProviderDefinition, new MockProviderAdapter());
    providerRegistry.register(openaiOnlyDefinition, openaiOnlyAdapter);

    const providerInstance = makeProviderInstance("inst-oai", "openai_only_test");
    const account = makeAccount("openai-account-1", "openai_only_test", "inst-oai");
    const accountPool = new AccountPool([account]);

    const providerRuntimeRegistry = new ProviderRuntimeRegistry(
      [providerInstance],
      [{ providerInstanceId: "inst-oai", accountPool }]
    );

    const app = await buildApp(testConfig({ requestBodyLimit: "16kb" }), {
      providerRegistry,
      providerRuntimeRegistry,
      secretService: buildSecretService()
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/messages",
      headers: {
        authorization: "Bearer dev-key-1",
        "x-provider-account-id": "openai-account-1"
      },
      payload: {
        model: "test-model",
        max_tokens: 100,
        messages: [{ role: "user", content: "hello" }]
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("protocol_not_supported");
    expect(response.json().error.message).toContain("openai_chat_completions");
  });

  it("routes successfully when protocol matches (openai endpoint with openai provider)", async () => {
    const providerRegistry = new ProviderAdapterRegistry();
    providerRegistry.register(mockProviderDefinition, new MockProviderAdapter());
    providerRegistry.register(openaiOnlyDefinition, openaiOnlyAdapter);

    const providerInstance = makeProviderInstance("inst-oai", "openai_only_test");
    const account = makeAccount("openai-account-1", "openai_only_test", "inst-oai");
    const accountPool = new AccountPool([account]);

    const providerRuntimeRegistry = new ProviderRuntimeRegistry(
      [providerInstance],
      [{ providerInstanceId: "inst-oai", accountPool }]
    );

    const app = await buildApp(testConfig({ requestBodyLimit: "16kb" }), {
      providerRegistry,
      providerRuntimeRegistry,
      secretService: buildSecretService()
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: {
        authorization: "Bearer dev-key-1",
        "x-provider-account-id": "openai-account-1"
      },
      payload: {
        model: "test-model",
        messages: [{ role: "user", content: "hello" }]
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().choices[0].message.content).toBe("hello from openai adapter");
  });

  it("routes successfully when protocol matches (anthropic endpoint with anthropic provider)", async () => {
    const providerRegistry = new ProviderAdapterRegistry();
    providerRegistry.register(mockProviderDefinition, new MockProviderAdapter());
    providerRegistry.register(anthropicOnlyDefinition, anthropicOnlyAdapter);

    const providerInstance = makeProviderInstance("inst-ant", "anthropic_only_test");
    const account = makeAccount("anthropic-account-1", "anthropic_only_test", "inst-ant");
    const accountPool = new AccountPool([account]);

    const providerRuntimeRegistry = new ProviderRuntimeRegistry(
      [providerInstance],
      [{ providerInstanceId: "inst-ant", accountPool }]
    );

    const app = await buildApp(testConfig({ requestBodyLimit: "16kb" }), {
      providerRegistry,
      providerRuntimeRegistry,
      secretService: buildSecretService()
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/messages",
      headers: {
        authorization: "Bearer dev-key-1",
        "x-provider-account-id": "anthropic-account-1"
      },
      payload: {
        model: "test-model",
        max_tokens: 100,
        messages: [{ role: "user", content: "hello" }]
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().content[0].text).toBe("hello from anthropic adapter");
  });

  it("does not expose credentials in error responses", async () => {
    const providerRegistry = new ProviderAdapterRegistry();
    providerRegistry.register(mockProviderDefinition, new MockProviderAdapter());
    providerRegistry.register(openaiOnlyDefinition, openaiOnlyAdapter);

    const providerInstance = makeProviderInstance("inst-oai", "openai_only_test");
    const account = makeAccount("openai-account-1", "openai_only_test", "inst-oai");
    const accountPool = new AccountPool([account]);

    const providerRuntimeRegistry = new ProviderRuntimeRegistry(
      [providerInstance],
      [{ providerInstanceId: "inst-oai", accountPool }]
    );

    const secretService = buildSecretService();
    const app = await buildApp(testConfig({ requestBodyLimit: "16kb" }), {
      providerRegistry,
      providerRuntimeRegistry,
      secretService
    });

    // Test 404 error doesn't expose credentials
    const response404 = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: {
        authorization: "Bearer dev-key-1",
        "x-provider-account-id": "non-existent"
      },
      payload: {
        model: "test-model",
        messages: [{ role: "user", content: "hello" }]
      }
    });

    const body404 = JSON.stringify(response404.json());
    expect(body404).not.toContain("sk-test-key");
    expect(body404).not.toContain("sk-ant-test-key");

    // Test 400 error doesn't expose credentials
    const response400 = await app.inject({
      method: "POST",
      url: "/v1/messages",
      headers: {
        authorization: "Bearer dev-key-1",
        "x-provider-account-id": "openai-account-1"
      },
      payload: {
        model: "test-model",
        max_tokens: 100,
        messages: [{ role: "user", content: "hello" }]
      }
    });

    const body400 = JSON.stringify(response400.json());
    expect(body400).not.toContain("sk-test-key");
    expect(body400).not.toContain("sk-ant-test-key");
  });
});
