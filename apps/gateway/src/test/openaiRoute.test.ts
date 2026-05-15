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

function makeAccount(id: string): ProviderAccount {
  const now = new Date("2026-01-01T00:00:00.000Z");

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
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z")
};

describe("POST /v1/chat/completions", () => {
  it("routes kiro-sonnet to the Kiro adapter with account pool credentials", async () => {
    const fetchImpl = async () =>
      new Response(
        JSON.stringify({
          content: "kiro response"
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      );
    const providerRegistry = new ProviderAdapterRegistry();
    providerRegistry.register(
      kiroProviderDefinition,
      new KiroProviderAdapter(new KiroClient(fetchImpl))
    );
    const accountPool = new AccountPool([makeAccount("kiro-1")]);
    const providerRuntimeRegistry = new ProviderRuntimeRegistry(
      [providerInstance],
      [
        {
          providerInstanceId: "provider_kiro_main",
          accountPool
        }
      ]
    );
    const encryptionService = new LocalEncryptionService("test-key");
    const secretService = new SecretService(encryptionService);
    secretService.addSecret({
      id: "secret_kiro_1",
      accountId: "kiro-1",
      credentialType: "refresh_token",
      encryptedPayload: encryptionService.encryptJson({
        accessToken: "access-token",
        refreshToken: "refresh-token"
      }),
      updatedAt: new Date("2026-01-01T00:00:00.000Z")
    });
    const app = await buildApp(testConfig({ requestBodyLimit: "16kb" }), {
      providerRegistry,
      providerRuntimeRegistry,
      secretService
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: {
        authorization: "Bearer dev-key-1"
      },
      payload: {
        model: "kiro-sonnet",
        messages: [
          {
            role: "user",
            content: "hello"
          }
        ]
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      object: "chat.completion",
      model: "kiro-sonnet",
      choices: [
        {
          message: {
            role: "assistant",
            content: "kiro response"
          }
        }
      ]
    });
    expect(accountPool.getAccount("kiro-1")?.runtime.totalRequests).toBe(1);

    await app.close();
  });

  it("puts rate-limited Kiro accounts into cooldown and retries another account", async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;

      if (calls === 1) {
        return new Response("{}", { status: 429 });
      }

      return new Response(JSON.stringify({ content: "second account" }), {
        status: 200,
        headers: {
          "content-type": "application/json"
        }
      });
    };
    const providerRegistry = new ProviderAdapterRegistry();
    providerRegistry.register(
      kiroProviderDefinition,
      new KiroProviderAdapter(new KiroClient(fetchImpl))
    );
    const accountPool = new AccountPool([makeAccount("kiro-1"), makeAccount("kiro-2")]);
    const providerRuntimeRegistry = new ProviderRuntimeRegistry(
      [providerInstance],
      [
        {
          providerInstanceId: "provider_kiro_main",
          accountPool
        }
      ]
    );
    const encryptionService = new LocalEncryptionService("test-key");
    const secretService = new SecretService(encryptionService);

    for (const accountId of ["kiro-1", "kiro-2"]) {
      secretService.addSecret({
        id: `secret_${accountId}`,
        accountId,
        credentialType: "refresh_token",
        encryptedPayload: encryptionService.encryptJson({
          accessToken: `${accountId}-token`
        }),
        updatedAt: new Date("2026-01-01T00:00:00.000Z")
      });
    }

    const app = await buildApp(testConfig({ requestBodyLimit: "16kb" }), {
      providerRegistry,
      providerRuntimeRegistry,
      secretService
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: {
        authorization: "Bearer dev-key-1"
      },
      payload: {
        model: "kiro-sonnet",
        messages: [
          {
            role: "user",
            content: "hello"
          }
        ]
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().choices[0].message.content).toBe("second account");
    expect(accountPool.getAccount("kiro-1")?.status).toBe("cooldown");
    expect(accountPool.getAccount("kiro-2")?.runtime.totalRequests).toBe(1);

    await app.close();
  });
});
