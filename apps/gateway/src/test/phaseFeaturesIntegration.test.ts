import { describe, expect, it } from "vitest";
import { KiroClient } from "../providers/adapters/kiro/KiroClient.js";
import { KiroProviderAdapter } from "../providers/adapters/kiro/KiroProviderAdapter.js";
import { PriorityStrategy } from "../account-pool/PriorityStrategy.js";
import { AccountQuotaService } from "../services/AccountQuotaService.js";
import { ModelRegistry } from "../router/ModelRegistry.js";
import type { ProviderInstance } from "../providers/base/ProviderInstance.js";
import type { ProviderAccount } from "../providers/base/ProviderAccount.js";

const providerInstance: ProviderInstance = {
  id: "provider_kiro_test",
  type: "kiro",
  name: "Kiro Test",
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
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01")
};

describe("Phase A: Suspension Detection", () => {
  it("detects 403 TEMPORARILY_SUSPENDED as account suspension", async () => {
    const fetchImpl = async () =>
      new Response(JSON.stringify({ reason: "TEMPORARILY_SUSPENDED" }), {
        status: 403
      });
    const adapter = new KiroProviderAdapter(new KiroClient(fetchImpl));

    await expect(
      adapter.chatCompletions(
        { model: "sonnet", messages: [{ role: "user", content: "hi" }] },
        { providerInstance, requestId: "r1", credentialPayload: { accessToken: "tok" } }
      )
    ).rejects.toMatchObject({
      code: "provider_account_suspended",
      retryable: false
    });
  });

  it("detects 423 Locked as account suspension", async () => {
    const fetchImpl = async () => new Response("Locked", { status: 423 });
    const adapter = new KiroProviderAdapter(new KiroClient(fetchImpl));

    await expect(
      adapter.chatCompletions(
        { model: "sonnet", messages: [{ role: "user", content: "hi" }] },
        { providerInstance, requestId: "r1", credentialPayload: { accessToken: "tok" } }
      )
    ).rejects.toMatchObject({
      code: "provider_account_suspended"
    });
  });
});

describe("Phase A: MachineId Injection", () => {
  it("includes machineId in request payload when provided", async () => {
    let capturedBody = "";
    const fetchImpl = async (_url: unknown, init?: RequestInit) => {
      capturedBody = (init?.body ?? "") as string;
      return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    };
    const adapter = new KiroProviderAdapter(new KiroClient(fetchImpl));

    await adapter.chatCompletions(
      { model: "sonnet", messages: [{ role: "user", content: "hi" }] },
      {
        providerInstance,
        requestId: "r1",
        credentialPayload: { accessToken: "tok", machineId: "custom-machine-123" }
      }
    );

    const parsed = JSON.parse(capturedBody);
    expect(parsed.machineId).toBe("custom-machine-123");
  });

  it("auto-generates machineId from refreshToken hash when not provided", async () => {
    let capturedBody = "";
    const fetchImpl = async (_url: unknown, init?: RequestInit) => {
      capturedBody = (init?.body ?? "") as string;
      return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    };
    const adapter = new KiroProviderAdapter(new KiroClient(fetchImpl));

    await adapter.chatCompletions(
      { model: "sonnet", messages: [{ role: "user", content: "hi" }] },
      {
        providerInstance,
        requestId: "r1",
        credentialPayload: { accessToken: "tok", refreshToken: "my-refresh-token" }
      }
    );

    const parsed = JSON.parse(capturedBody);
    expect(parsed.machineId).toBeDefined();
    expect(parsed.machineId).toHaveLength(64); // SHA-256 hex
  });
});

describe("Phase C: PriorityStrategy", () => {
  const makeAccount = (id: string, priority: number, failures = 0): ProviderAccount => ({
    id,
    providerInstanceId: "pi",
    providerType: "kiro",
    displayName: id,
    status: "active",
    weight: 1,
    priority,
    maxConcurrency: 3,
    credentialRef: `secret_${id}`,
    runtime: {
      activeRequests: 0,
      totalRequests: 0,
      failedRequests: 0,
      consecutiveFailures: failures
    },
    createdAt: new Date(),
    updatedAt: new Date()
  });

  it("selects lowest priority number first", () => {
    const strategy = new PriorityStrategy();
    const accounts = [
      makeAccount("c", 10),
      makeAccount("a", 1),
      makeAccount("b", 5)
    ];
    const selected = strategy.select(accounts, { now: new Date() });
    expect(selected?.id).toBe("a");
  });

  it("skips accounts with too many consecutive failures", () => {
    const strategy = new PriorityStrategy(3);
    const accounts = [
      makeAccount("a", 1, 3),
      makeAccount("b", 5, 0)
    ];
    const selected = strategy.select(accounts, { now: new Date() });
    expect(selected?.id).toBe("b");
  });

  it("falls back to first account when all exhausted", () => {
    const strategy = new PriorityStrategy(2);
    const accounts = [
      makeAccount("a", 1, 5),
      makeAccount("b", 5, 5)
    ];
    const selected = strategy.select(accounts, { now: new Date() });
    expect(selected?.id).toBe("a");
  });
});

describe("Phase C: AccountQuotaService", () => {
  it("marks account as exhausted when daily request limit reached", () => {
    const service = new AccountQuotaService({ dailyRequestLimit: 3, dailyTokenLimit: 1000000 });
    service.recordUsage("acc1", 100);
    service.recordUsage("acc1", 100);
    expect(service.isExhausted("acc1")).toBe(false);
    service.recordUsage("acc1", 100);
    expect(service.isExhausted("acc1")).toBe(true);
  });

  it("marks account as exhausted when daily token limit reached", () => {
    const service = new AccountQuotaService({ dailyRequestLimit: 1000, dailyTokenLimit: 500 });
    service.recordUsage("acc1", 600);
    expect(service.isExhausted("acc1")).toBe(true);
  });

  it("resets on new day", () => {
    const service = new AccountQuotaService({ dailyRequestLimit: 1, dailyTokenLimit: 1000000 });
    service.recordUsage("acc1", 100);
    expect(service.isExhausted("acc1")).toBe(true);
    service.resetAccount("acc1");
    expect(service.isExhausted("acc1")).toBe(false);
  });
});

describe("Phase D: Wildcard Model Mapping", () => {
  it("resolves exact match before pattern", () => {
    const registry = new ModelRegistry([
      {
        id: "exact",
        publicModel: "claude-sonnet-4-20250514",
        providerInstanceId: "pi",
        providerType: "kiro",
        upstreamModel: "claude-sonnet-4.5",
        enabled: true,
        capabilities: ["chat"]
      }
    ]);
    registry.register({
      id: "pattern",
      publicModel: "*sonnet*",
      providerInstanceId: "pi2",
      providerType: "kiro",
      upstreamModel: "claude-sonnet-4.5",
      enabled: true,
      capabilities: ["chat"]
    });

    const result = registry.get("claude-sonnet-4-20250514");
    expect(result?.id).toBe("exact");
  });

  it("matches wildcard patterns", () => {
    const registry = new ModelRegistry();
    registry.register({
      id: "sonnet_pattern",
      publicModel: "*sonnet*",
      providerInstanceId: "pi",
      providerType: "kiro",
      upstreamModel: "claude-sonnet-4.5",
      enabled: true,
      capabilities: ["chat"]
    });

    const result = registry.get("claude-sonnet-4-20250514");
    expect(result).toBeDefined();
    expect(result?.providerInstanceId).toBe("pi");
    expect(result?.publicModel).toBe("claude-sonnet-4-20250514");
  });

  it("returns undefined for non-matching models", () => {
    const registry = new ModelRegistry();
    registry.register({
      id: "sonnet_pattern",
      publicModel: "*sonnet*",
      providerInstanceId: "pi",
      providerType: "kiro",
      upstreamModel: "claude-sonnet-4.5",
      enabled: true,
      capabilities: ["chat"]
    });

    expect(registry.get("gpt-4o")).toBeUndefined();
  });

  it("deleteById removes pattern mappings", () => {
    const registry = new ModelRegistry();
    registry.register({
      id: "p1",
      publicModel: "*opus*",
      providerInstanceId: "pi",
      providerType: "kiro",
      upstreamModel: "claude-opus-4.5",
      enabled: true,
      capabilities: ["chat"]
    });

    expect(registry.get("claude-opus-4-20250514")).toBeDefined();
    registry.deleteById("p1");
    expect(registry.get("claude-opus-4-20250514")).toBeUndefined();
  });
});

describe("Phase D: Kiro Anthropic Messages", () => {
  it("returns NormalizedAnthropicResponse for non-streaming messages", async () => {
    const fetchImpl = async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: "hello anthropic" } }] }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    const adapter = new KiroProviderAdapter(new KiroClient(fetchImpl));

    const response = await adapter.messages(
      { model: "sonnet", max_tokens: 1024, messages: [{ role: "user", content: "hi" }] },
      { providerInstance, requestId: "r1", credentialPayload: { accessToken: "tok" } }
    );

    expect(response).toMatchObject({
      type: "message",
      role: "assistant",
      content: [{ type: "text", text: "hello anthropic" }],
      stop_reason: "end_turn"
    });
  });
});
