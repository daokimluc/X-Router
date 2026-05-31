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
    maxConcurrency: 5,
    credentialRef: `secret_${id}`,
    allowedModels: ["kiro-sonnet"],
    runtime: { activeRequests: 0, totalRequests: 0, failedRequests: 0, consecutiveFailures: 0 },
    createdAt: now,
    updatedAt: now
  };
}

const providerInstance: ProviderInstance = {
  id: "provider_kiro_main",
  type: "kiro",
  name: "Kiro Main",
  enabled: true,
  config: { baseUrl: "https://kiro.test", chatCompletionsPath: "/chat", defaultModel: "sonnet" },
  defaultTimeoutMs: 30000,
  maxRetries: 0,
  cooldownMs: 60000,
  accountSelectionStrategy: "round_robin",
  maxConcurrentRequests: 20,
  maxConcurrentRequestsPerAccount: 3,
  circuitBreaker: { enabled: true, failureThreshold: 5, cooldownMs: 60000, halfOpenMaxRequests: 1 },
  createdAt: now,
  updatedAt: now
};

function buildSecretService(accountIds: string[]): SecretService {
  const enc = new LocalEncryptionService("test-key");
  const svc = new SecretService(enc);
  for (const id of accountIds) {
    svc.addSecret({
      id: `secret_${id}`,
      accountId: id,
      credentialType: "refresh_token",
      encryptedPayload: enc.encryptJson({ accessToken: "access-token" }),
      updatedAt: now
    });
  }
  return svc;
}

function buildRegistry(adapter: KiroProviderAdapter, accounts: ProviderAccount[], maxRetries = 0) {
  const providerRegistry = new ProviderAdapterRegistry();
  providerRegistry.register(kiroProviderDefinition, adapter);
  const accountPool = new AccountPool(accounts);
  const providerRuntimeRegistry = new ProviderRuntimeRegistry(
    [{ ...providerInstance, maxRetries }],
    [{ providerInstanceId: "provider_kiro_main", accountPool }]
  );
  return { providerRegistry, providerRuntimeRegistry, accountPool };
}

describe("request-pipeline drift fixes", () => {
  it("F4 — Anthropic success with NO upstream usage still records usage (estimate)", async () => {
    const adapter = new KiroProviderAdapter(
      new KiroClient(async () =>
        new Response(
          JSON.stringify({
            id: "chatcmpl_1",
            choices: [{ message: { role: "assistant", content: "hello there" }, finish_reason: "stop" }]
            // NB: no `usage` field at all.
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      )
    );
    const { providerRegistry, providerRuntimeRegistry } = buildRegistry(adapter, [makeAccount("kiro-1")]);
    const app = await buildApp(testConfig({ requestBodyLimit: "16kb" }), {
      providerRegistry,
      providerRuntimeRegistry,
      secretService: buildSecretService(["kiro-1"])
    });

    const res = await app.inject({
      method: "POST",
      url: "/v1/messages",
      headers: { authorization: "Bearer dev-key-1" },
      payload: { model: "kiro-sonnet", max_tokens: 100, messages: [{ role: "user", content: "hi" }] }
    });
    expect(res.statusCode).toBe(200);

    // F4: a usage record must still exist (estimated), not skipped.
    const usage = app.usageService.listAll().filter((u) => u.protocol === "anthropic" && u.providerType === "kiro");
    expect(usage.length).toBe(1);
    expect(usage[0].totalTokens).toBeGreaterThan(0);

    await app.close();
  });

  it("F2 — Anthropic streaming consumes rate-limit tokens", async () => {
    const adapter = new KiroProviderAdapter(
      new KiroClient(async () =>
        new Response("event: assistantResponseEvent\ndata: {\"content\":\"streamed words here\"}\n\n", {
          status: 200,
          headers: { "content-type": "text/event-stream" }
        })
      )
    );
    const { providerRegistry, providerRuntimeRegistry } = buildRegistry(adapter, [makeAccount("kiro-1")]);
    // Enable a token-based daily quota so consumeTokens has a visible effect.
    const app = await buildApp(
      testConfig({ requestBodyLimit: "16kb", internalDailyTokenQuota: 1_000_000 }),
      {
        providerRegistry,
        providerRuntimeRegistry,
        secretService: buildSecretService(["kiro-1"])
      }
    );

    const res = await app.inject({
      method: "POST",
      url: "/v1/messages",
      headers: { authorization: "Bearer dev-key-1" },
      payload: { model: "kiro-sonnet", max_tokens: 100, stream: true, messages: [{ role: "user", content: "hi" }] }
    });
    expect(res.statusCode).toBe(200);

    // The streaming success path recorded a usage row for the anthropic protocol.
    const usage = app.usageService.listAll().filter((u) => u.protocol === "anthropic");
    expect(usage.length).toBe(1);
    expect(usage[0].totalTokens).toBeGreaterThan(0);

    await app.close();
  });

  it("R3 — a capacity error on the first account fails over to the next", async () => {
    let call = 0;
    const adapter = new KiroProviderAdapter(
      new KiroClient(async () => {
        call += 1;
        if (call === 1) {
          // 429 → rate-limited (retryable/capacity) → should fail over, cooldown acct 1.
          return new Response("{}", { status: 429 });
        }
        return new Response(
          JSON.stringify({
            id: "chatcmpl_2",
            choices: [{ message: { role: "assistant", content: "second account" }, finish_reason: "stop" }],
            usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 }
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      })
    );
    const { providerRegistry, providerRuntimeRegistry } = buildRegistry(
      adapter,
      [makeAccount("kiro-1"), makeAccount("kiro-2")],
      1 // allow one retry so the 429'd account fails over to the second
    );
    const app = await buildApp(testConfig({ requestBodyLimit: "16kb" }), {
      providerRegistry,
      providerRuntimeRegistry,
      secretService: buildSecretService(["kiro-1", "kiro-2"])
    });

    const res = await app.inject({
      method: "POST",
      url: "/v1/messages",
      headers: { authorization: "Bearer dev-key-1" },
      payload: { model: "kiro-sonnet", max_tokens: 100, messages: [{ role: "user", content: "hi" }] }
    });
    // Failed over rather than returning the 429 to the client.
    expect(res.statusCode).toBe(200);
    expect(call).toBe(2);

    await app.close();
  });
});
