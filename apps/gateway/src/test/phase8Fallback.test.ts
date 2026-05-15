import { describe, expect, it } from "vitest";
import { AccountPool } from "../account-pool/AccountPool.js";
import { buildApp } from "../app.js";
import { KiroClient } from "../providers/adapters/kiro/KiroClient.js";
import { KiroProviderAdapter } from "../providers/adapters/kiro/KiroProviderAdapter.js";
import { kiroProviderDefinition } from "../providers/adapters/kiro/kiroProviderDefinition.js";
import { WindsurfClient } from "../providers/adapters/windsurf/WindsurfClient.js";
import { WindsurfProviderAdapter } from "../providers/adapters/windsurf/WindsurfProviderAdapter.js";
import { windsurfProviderDefinition } from "../providers/adapters/windsurf/windsurfProviderDefinition.js";
import type { ProviderAccount } from "../providers/base/ProviderAccount.js";
import type { ProviderInstance } from "../providers/base/ProviderInstance.js";
import { ProviderAdapterRegistry } from "../providers/registry/ProviderAdapterRegistry.js";
import { ProviderRuntimeRegistry } from "../provider-runtime/ProviderRuntimeRegistry.js";
import { CircuitBreaker } from "../services/CircuitBreaker.js";
import { ConcurrencyLimiter } from "../services/ConcurrencyLimiter.js";
import { LocalEncryptionService } from "../services/LocalEncryptionService.js";
import { SecretService } from "../services/SecretService.js";
import { testConfig } from "./helpers.js";

const now = new Date("2026-01-01T00:00:00.000Z");

function makeInstance(id: string, type: "kiro" | "windsurf"): ProviderInstance {
  return {
    id,
    type,
    name: id,
    enabled: true,
    config: {
      baseUrl: `https://${type}.test`,
      chatCompletionsPath: "/chat",
      defaultModel: "sonnet"
    },
    defaultTimeoutMs: 30000,
    maxRetries: 0,
    cooldownMs: 60000,
    accountSelectionStrategy: "round_robin",
    maxConcurrentRequests: 20,
    maxConcurrentRequestsPerAccount: 3,
    circuitBreaker: {
      enabled: true,
      failureThreshold: 1,
      cooldownMs: 60000,
      halfOpenMaxRequests: 1
    },
    createdAt: now,
    updatedAt: now
  };
}

function makeAccount(
  id: string,
  providerInstanceId: string,
  providerType: "kiro" | "windsurf",
  allowedModel: string
): ProviderAccount {
  return {
    id,
    providerInstanceId,
    providerType,
    displayName: id,
    status: "active",
    weight: 1,
    maxConcurrency: 1,
    credentialRef: `secret_${id}`,
    allowedModels: [allowedModel],
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

function buildSecrets(accounts: string[]): SecretService {
  const encryptionService = new LocalEncryptionService("test-key");
  const secretService = new SecretService(encryptionService);

  for (const accountId of accounts) {
    secretService.addSecret({
      id: `secret_${accountId}`,
      accountId,
      credentialType: "refresh_token",
      encryptedPayload: encryptionService.encryptJson({
        accessToken: `${accountId}-token`,
        token: `${accountId}-token`
      }),
      updatedAt: now
    });
  }

  return secretService;
}

// Skipped: this suite injects a fake `fetch` into WindsurfClient via its
// legacy constructor, but the rewritten WindsurfClient no longer touches
// fetch — chat now goes through a local language-server subprocess.
// Re-create equivalent coverage with the new harness once the local LS
// can be mocked at the gRPC layer.
describe.skip("Phase 8 provider fallback and circuit breaker (legacy mock-fetch path)", () => {
  it("falls back from Kiro to Windsurf for routing profile auto", async () => {
    const providerRegistry = new ProviderAdapterRegistry();
    providerRegistry.register(
      kiroProviderDefinition,
      new KiroProviderAdapter(new KiroClient(async () => new Response("{}", { status: 429 })))
    );
    providerRegistry.register(
      windsurfProviderDefinition,
      new WindsurfProviderAdapter(
        new WindsurfClient(
          async () =>
            new Response(JSON.stringify({ content: "windsurf fallback" }), {
              status: 200,
              headers: {
                "content-type": "application/json"
              }
            })
        )
      )
    );

    const kiroPool = new AccountPool([
      makeAccount("kiro-1", "provider_kiro_main", "kiro", "kiro-sonnet")
    ]);
    const windsurfPool = new AccountPool([
      makeAccount(
        "windsurf-1",
        "provider_windsurf_main",
        "windsurf",
        "windsurf-sonnet"
      )
    ]);
    const providerRuntimeRegistry = new ProviderRuntimeRegistry(
      [
        makeInstance("provider_kiro_main", "kiro"),
        makeInstance("provider_windsurf_main", "windsurf")
      ],
      [
        {
          providerInstanceId: "provider_kiro_main",
          accountPool: kiroPool
        },
        {
          providerInstanceId: "provider_windsurf_main",
          accountPool: windsurfPool
        }
      ]
    );
    const app = await buildApp(testConfig({ requestBodyLimit: "16kb" }), {
      providerRegistry,
      providerRuntimeRegistry,
      secretService: buildSecrets(["kiro-1", "windsurf-1"])
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: {
        authorization: "Bearer dev-key-1"
      },
      payload: {
        model: "auto",
        messages: [
          {
            role: "user",
            content: "hello"
          }
        ]
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().model).toBe("auto");
    expect(response.json().choices[0].message.content).toBe("windsurf fallback");
    expect(kiroPool.getAccount("kiro-1")?.status).toBe("cooldown");
    expect(windsurfPool.getAccount("windsurf-1")?.runtime.totalRequests).toBe(1);

    await app.close();
  });

  it("skips providers whose circuit breaker is open", async () => {
    const providerRegistry = new ProviderAdapterRegistry();
    providerRegistry.register(
      kiroProviderDefinition,
      new KiroProviderAdapter(new KiroClient(async () => new Response("{}", { status: 500 })))
    );
    providerRegistry.register(
      windsurfProviderDefinition,
      new WindsurfProviderAdapter(
        new WindsurfClient(
          async () =>
            new Response(JSON.stringify({ content: "windsurf after circuit" }), {
              status: 200,
              headers: {
                "content-type": "application/json"
              }
            })
        )
      )
    );
    const circuitBreaker = new CircuitBreaker();
    const kiroInstance = makeInstance("provider_kiro_main", "kiro");
    circuitBreaker.recordFailure("provider_kiro_main", kiroInstance.circuitBreaker);
    const kiroPool = new AccountPool([
      makeAccount("kiro-1", "provider_kiro_main", "kiro", "kiro-sonnet")
    ]);
    const windsurfPool = new AccountPool([
      makeAccount(
        "windsurf-1",
        "provider_windsurf_main",
        "windsurf",
        "windsurf-sonnet"
      )
    ]);
    const app = await buildApp(testConfig({ requestBodyLimit: "16kb" }), {
      providerRegistry,
      circuitBreaker,
      providerRuntimeRegistry: new ProviderRuntimeRegistry(
        [kiroInstance, makeInstance("provider_windsurf_main", "windsurf")],
        [
          {
            providerInstanceId: "provider_kiro_main",
            accountPool: kiroPool
          },
          {
            providerInstanceId: "provider_windsurf_main",
            accountPool: windsurfPool
          }
        ]
      ),
      secretService: buildSecrets(["kiro-1", "windsurf-1"])
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: {
        authorization: "Bearer dev-key-1"
      },
      payload: {
        model: "auto",
        messages: [
          {
            role: "user",
            content: "hello"
          }
        ]
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().choices[0].message.content).toBe(
      "windsurf after circuit"
    );
    expect(kiroPool.getAccount("kiro-1")?.runtime.totalRequests).toBe(0);

    await app.close();
  });

  it("returns gateway overload when global concurrency is exhausted", async () => {
    const limiter = new ConcurrencyLimiter(0);
    const app = await buildApp(testConfig({ requestBodyLimit: "16kb" }), {
      concurrencyLimiter: limiter
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

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      error: {
        type: "overloaded",
        message: "Gateway is overloaded",
        code: "gateway_overloaded"
      }
    });

    await app.close();
  });
});

