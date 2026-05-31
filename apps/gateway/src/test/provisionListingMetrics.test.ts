import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { testConfig } from "./helpers.js";

const ADMIN = "admin-key-1";
const PROV = "prov-key-1";
const apps: FastifyInstance[] = [];

afterEach(async () => {
  while (apps.length) {
    const a = apps.pop();
    if (a) await a.close();
  }
});

async function build() {
  const app = await buildApp(testConfig({ marketplaceEnabled: true, requestBodyLimit: "1mb", provisionApiKeys: [PROV] }));
  await app.ready();
  apps.push(app);
  return app;
}

const prov = { authorization: `Bearer ${PROV}` };

/** Create a provider instance + account so a listing can reference a real accountId. */
async function makeAccount(app: FastifyInstance, instanceId: string, accountId: string) {
  await app.inject({
    method: "POST", url: "/admin/v1/provider-instances",
    headers: { authorization: `Bearer ${ADMIN}` },
    payload: { id: instanceId, type: "kiro", name: instanceId }
  });
  await app.inject({
    method: "POST", url: "/admin/v1/accounts",
    headers: { authorization: `Bearer ${ADMIN}` },
    payload: {
      id: accountId, providerInstanceId: instanceId, displayName: accountId,
      credentialType: "api_key", credentialPayload: { apiKey: "ksk_test" }
    }
  });
}

async function makeListing(app: FastifyInstance, baseModel: string, instanceId: string, accountId: string) {
  const seller = await app.inject({ method: "POST", url: "/provision/seller", headers: prov, payload: { displayName: `s_${accountId}` } });
  const sellerId = seller.json().seller.id;
  await app.inject({ method: "POST", url: `/provision/seller/${sellerId}/approve`, headers: prov });
  await app.inject({
    method: "POST", url: "/provision/listing", headers: prov,
    payload: { sellerId, baseModel, costPrice: { inputPerM: 2, outputPerM: 6 }, providerInstanceId: instanceId, providerAccountId: accountId }
  });
  return sellerId;
}

describe("provision-listing-metrics: GET /provision/listings/metrics", () => {
  it("joins requests/tokens (settlement), success (runtime), latency/rps (tracker) per listing", async () => {
    const app = await build();
    await makeAccount(app, "provider_metrics_main", "acc_m1");
    const sellerId = await makeListing(app, "gpt-5.5", "provider_metrics_main", "acc_m1");

    // Settlements for (seller, gpt-5.5): 2 settled + 1 reversed (must be excluded).
    app.settlementLedger.record({ buyerKeyId: "b1", baseModel: "gpt-5.5", sellerId, promptTokens: 100, completionTokens: 50, collected: 0.003, sellerCredit: 0.002, platformMargin: 0.001, billTrack: "payg" });
    app.settlementLedger.record({ buyerKeyId: "b1", baseModel: "gpt-5.5", sellerId, promptTokens: 200, completionTokens: 80, collected: 0.006, sellerCredit: 0.004, platformMargin: 0.002, billTrack: "payg" });
    const reversedId = app.settlementLedger.record({ buyerKeyId: "b1", baseModel: "gpt-5.5", sellerId, promptTokens: 999, completionTokens: 999, collected: 0.01, sellerCredit: 0.006, platformMargin: 0.004, billTrack: "payg" });
    app.settlementLedger.reverseSettlement(reversedId);

    // Account runtime (lifetime success): drive the pool to 10 total, 1 failed
    // (getAccount returns a clone, so mutate through the real acquire/release path).
    const pool = app.providerRuntimeRegistry.getAccountPool("provider_metrics_main")!;
    for (let i = 0; i < 9; i++) {
      const lease = pool.acquire({ model: "gpt-5.5" });
      lease.releaseSuccess();
    }
    const failLease = pool.acquire({ model: "gpt-5.5" });
    failLease.releaseFailure("boom");
    expect(app.providerRuntimeRegistry.getAccount("acc_m1")!.runtime.totalRequests).toBe(10);

    // Latency for the account (rolling window).
    app.latencyTracker.record({ providerInstanceId: "provider_metrics_main", publicModel: "gpt-5.5", accountId: "acc_m1", durationMs: 120, ok: true });
    app.latencyTracker.record({ providerInstanceId: "provider_metrics_main", publicModel: "gpt-5.5", accountId: "acc_m1", durationMs: 800, ok: true });

    const res = await app.inject({ method: "GET", url: "/provision/listings/metrics?baseModel=gpt-5.5", headers: prov });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.meta.successHorizon).toBe("lifetime");
    expect(body.meta.latencyWindowSeconds).toBeGreaterThan(0);

    const m = body.metrics.find((x: { providerAccountId: string }) => x.providerAccountId === "acc_m1");
    expect(m).toBeDefined();
    // requests/tokens exclude the reversed row: 2 requests, 300 prompt, 130 completion.
    expect(m.requests).toBe(2);
    expect(m.promptTokens).toBe(300);
    expect(m.completionTokens).toBe(130);
    expect(m.totalTokens).toBe(430);
    // lifetime success
    expect(m.successRate).toBeCloseTo(0.9, 6);
    expect(m.totalRequestsLifetime).toBe(10);
    // latency/rps present (numbers)
    expect(typeof m.latencyP50Ms === "number" || m.latencyP50Ms === null).toBe(true);
    expect(typeof m.rps).toBe("number");
    expect(m.rps).toBeGreaterThan(0);
  });

  it("a listing with no traffic reports null success/latency/rps but zero counts (no fabricated values)", async () => {
    const app = await build();
    await makeAccount(app, "provider_idle_main", "acc_idle");
    await makeListing(app, "claude-opus-4-8", "provider_idle_main", "acc_idle");

    const res = await app.inject({ method: "GET", url: "/provision/listings/metrics?baseModel=claude-opus-4-8", headers: prov });
    const m = res.json().metrics.find((x: { providerAccountId: string }) => x.providerAccountId === "acc_idle");
    expect(m.requests).toBe(0);
    expect(m.totalTokens).toBe(0);
    // No traffic -> NOT a fabricated 100%/0; explicitly null.
    expect(m.successRate).toBeNull();
    expect(m.latencyP50Ms).toBeNull();
    expect(m.latencyP95Ms).toBeNull();
    expect(m.rps).toBeNull();
  });

  it("admin/client key is rejected (provision-scope only)", async () => {
    const app = await build();
    const admin = await app.inject({ method: "GET", url: "/provision/listings/metrics", headers: { authorization: `Bearer ${ADMIN}` } });
    expect(admin.statusCode).toBe(401);
    const client = await app.inject({ method: "GET", url: "/provision/listings/metrics", headers: { authorization: "Bearer dev-key-1" } });
    expect(client.statusCode).toBe(401);
  });
});
