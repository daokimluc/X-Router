import { describe, expect, it } from "vitest";
import { AccountPool } from "../account-pool/AccountPool.js";
import { buildApp } from "../app.js";
import type { ProviderAccount } from "../providers/base/ProviderAccount.js";
import type { ProviderInstance } from "../providers/base/ProviderInstance.js";
import { ProviderAdapterRegistry } from "../providers/registry/ProviderAdapterRegistry.js";
import { ProviderRuntimeRegistry } from "../provider-runtime/ProviderRuntimeRegistry.js";
import { LocalEncryptionService } from "../services/LocalEncryptionService.js";
import { SecretService } from "../services/SecretService.js";
import { WindsurfClient } from "../providers/adapters/windsurf/WindsurfClient.js";
import { WindsurfProviderAdapter } from "../providers/adapters/windsurf/WindsurfProviderAdapter.js";
import { windsurfProviderDefinition } from "../providers/adapters/windsurf/windsurfProviderDefinition.js";
import { testConfig } from "./helpers.js";

function makeAccount(id: string): ProviderAccount {
  const now = new Date("2026-01-01T00:00:00.000Z");

  return {
    id,
    providerInstanceId: "provider_windsurf_main",
    providerType: "windsurf",
    displayName: id,
    status: "active",
    weight: 1,
    maxConcurrency: 1,
    credentialRef: `secret_${id}`,
    allowedModels: ["windsurf-sonnet"],
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

// Skipped: end-to-end Windsurf chat now runs against a local language
// server subprocess instead of mocked cloud HTTP, so the fetch-injection
// pattern below no longer applies. See WindsurfClient for the new flow.
describe.skip("POST /v1/chat/completions with Windsurf (legacy cloud path)", () => {
  it("routes windsurf-sonnet to the Windsurf adapter", async () => {
    const fetchImpl = async () =>
      new Response(JSON.stringify({ content: "windsurf response" }), {
        status: 200,
        headers: {
          "content-type": "application/json"
        }
      });
    const providerRegistry = new ProviderAdapterRegistry();
    providerRegistry.register(
      windsurfProviderDefinition,
      new WindsurfProviderAdapter(new WindsurfClient(fetchImpl))
    );
    const accountPool = new AccountPool([makeAccount("windsurf-1")]);
    const providerRuntimeRegistry = new ProviderRuntimeRegistry(
      [providerInstance],
      [
        {
          providerInstanceId: "provider_windsurf_main",
          accountPool
        }
      ]
    );
    const encryptionService = new LocalEncryptionService("test-key");
    const secretService = new SecretService(encryptionService);
    secretService.addSecret({
      id: "secret_windsurf_1",
      accountId: "windsurf-1",
      credentialType: "bearer_token",
      encryptedPayload: encryptionService.encryptJson({
        token: "windsurf-token"
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
        model: "windsurf-sonnet",
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
      model: "windsurf-sonnet",
      choices: [
        {
          message: {
            role: "assistant",
            content: "windsurf response"
          }
        }
      ]
    });

    await app.close();
  });
});

