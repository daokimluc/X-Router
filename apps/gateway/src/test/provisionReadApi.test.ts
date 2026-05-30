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

describe("provision-read-api: reads", () => {
  it("wallet read reflects a prior provision top-up", async () => {
    const app = await build();
    const key = await app.inject({ method: "POST", url: "/provision/key", headers: prov, payload: {} });
    const keyId = key.json().id;
    await app.inject({ method: "POST", url: "/provision/wallet/topup", headers: prov, payload: { keyId, usd: 4.25 } });

    const res = await app.inject({ method: "GET", url: `/provision/wallet/${keyId}`, headers: prov });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ keyId, walletUsd: 4.25, provisioned: true });
  });

  it("earnings read reflects a credit; platform margin endpoint works", async () => {
    const app = await build();
    app.sellerEarningsLedger.credit("cinb", 9);
    app.sellerEarningsLedger.recordPlatformMargin(1.25);

    const snap = await app.inject({ method: "GET", url: "/provision/earnings/cinb", headers: prov });
    expect(snap.json()).toMatchObject({ sellerId: "cinb", unpaid: 9, lifetime: 9 });

    const margin = await app.inject({ method: "GET", url: "/provision/earnings/platform", headers: prov });
    expect(margin.json().platformMarginUsd).toBeCloseTo(1.25, 6);
  });

  it("plans / sellers / listings / markup reads return current state", async () => {
    const app = await build();
    const plans = await app.inject({ method: "GET", url: "/provision/plans", headers: prov });
    expect(plans.json().plans.length).toBe(4);

    // register + approve a seller, create a listing, then read both back
    const seller = await app.inject({ method: "POST", url: "/provision/seller", headers: prov, payload: { displayName: "hoang" } });
    const sellerId = seller.json().seller.id;
    await app.inject({ method: "POST", url: `/provision/seller/${sellerId}/approve`, headers: prov });
    await app.inject({ method: "POST", url: "/provision/listing", headers: prov, payload: { sellerId, baseModel: "gpt-5.5", costPrice: { inputPerM: 2.4, outputPerM: 7 }, providerInstanceId: "provider_kiro_main", providerAccountId: "a1" } });

    const sellers = await app.inject({ method: "GET", url: "/provision/sellers?status=approved", headers: prov });
    expect(sellers.json().sellers.some((s: { id: string }) => s.id === sellerId)).toBe(true);

    const listings = await app.inject({ method: "GET", url: "/provision/listings?baseModel=gpt-5.5", headers: prov });
    expect(listings.json().listings.length).toBe(1);

    await app.inject({ method: "PUT", url: "/provision/markup", headers: prov, payload: { defaultMarkup: 0.18 } });
    const markup = await app.inject({ method: "GET", url: "/provision/markup", headers: prov });
    expect(markup.json().defaultMarkup).toBe(0.18);
  });

  it("admin/client key rejected on provision reads (401)", async () => {
    const app = await build();
    const admin = await app.inject({ method: "GET", url: "/provision/plans", headers: { authorization: `Bearer ${ADMIN}` } });
    expect(admin.statusCode).toBe(401);
    const none = await app.inject({ method: "GET", url: "/provision/plans" });
    expect(none.statusCode).toBe(401);
  });
});

describe("provision-read-api: usage reconciliation", () => {
  it("scopes usage to a buyer key; unknown keyId returns empty", async () => {
    const app = await build();
    const key = await app.inject({ method: "POST", url: "/provision/key", headers: prov, payload: {} });
    const keyId = key.json().id;
    const record = app.apiKeyService.findById(keyId)!;
    // seed two usage records: one for this key, one for another hash
    app.usageService.record({ requestId: "r1", protocol: "openai", model: "gpt-5.5", providerType: "kiro", providerInstanceId: "p1", apiKeyHash: record.keyHash, promptTokens: 10, completionTokens: 5, totalTokens: 15 });
    app.usageService.record({ requestId: "r2", protocol: "openai", model: "gpt-5.5", providerType: "kiro", providerInstanceId: "p1", apiKeyHash: "other_hash", promptTokens: 1, completionTokens: 1, totalTokens: 2 });

    const mine = await app.inject({ method: "GET", url: `/provision/usage?keyId=${keyId}`, headers: prov });
    expect(mine.statusCode).toBe(200);
    expect(mine.json().data.every((r: { apiKeyHash: string }) => r.apiKeyHash === record.keyHash)).toBe(true);
    expect(mine.json().data.length).toBe(1);

    const unknown = await app.inject({ method: "GET", url: "/provision/usage?keyId=nope", headers: prov });
    expect(unknown.json()).toMatchObject({ data: [], total: 0 });
  });
});

describe("provision-read-api: self-service webhook config", () => {
  it("provision key sets + reads the business webhook (secret masked)", async () => {
    const app = await build();
    const put = await app.inject({ method: "PUT", url: "/provision/webhook", headers: prov, payload: { enabled: true, url: "https://foza.test/hook", secret: "shh", events: ["usage.recorded", "wallet.low"] } });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toMatchObject({ enabled: true, url: "https://foza.test/hook", secretSet: true });

    const get = await app.inject({ method: "GET", url: "/provision/webhook", headers: prov });
    expect(get.json().secret).not.toContain("shh");
    expect(get.json().secretSet).toBe(true);
    expect(get.json().events).toContain("usage.recorded");
  });
});
