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

describe("provision-webhook auth", () => {
  it("valid provision key passes; admin key rejected; missing → 401", async () => {
    const app = await build();
    const ok = await app.inject({ method: "POST", url: "/provision/key", headers: prov, payload: {} });
    expect(ok.statusCode).toBe(200);

    const admin = await app.inject({ method: "POST", url: "/provision/key", headers: { authorization: `Bearer ${ADMIN}` }, payload: {} });
    expect(admin.statusCode).toBe(401);

    const none = await app.inject({ method: "POST", url: "/provision/key", payload: {} });
    expect(none.statusCode).toBe(401);
  });

  it("provision key rejected on admin routes", async () => {
    const app = await build();
    const res = await app.inject({ method: "GET", url: "/admin/v1/plans", headers: prov });
    expect(res.statusCode).toBe(401);
  });
});

describe("provision-webhook endpoints", () => {
  it("key → grant (idempotent) → wallet topup → markup → seller/listing → mark-paid", async () => {
    const app = await build();

    // create key (plaintext returned once)
    const key = await app.inject({ method: "POST", url: "/provision/key", headers: prov, payload: { label: "buyer1" } });
    expect(key.statusCode).toBe(200);
    const keyId = key.json().id;
    expect(typeof key.json().key).toBe("string");

    // fund the wallet first — a paid plan is a subscription, charged on grant
    const top = await app.inject({ method: "POST", url: "/provision/wallet/topup", headers: prov, payload: { keyId, usd: 25 } });
    expect(top.json().walletUsd).toBe(25);

    // grant (subscribe to) a plan → charges priceUsd ($10) + sets the period
    const grant1 = await app.inject({ method: "POST", url: "/provision/grant", headers: prov, payload: { keyId, planId: "plan_claude" } });
    expect(grant1.statusCode).toBe(200);
    expect(grant1.json().planId).toBe("plan_claude");
    expect(grant1.json().walletUsd).toBe(15); // 25 − 10
    expect(typeof grant1.json().planPeriodEnd).toBe("number");
    // idempotent re-grant → no second charge
    const grant2 = await app.inject({ method: "POST", url: "/provision/grant", headers: prov, payload: { keyId, planId: "plan_claude" } });
    expect(grant2.json().idempotent).toBe(true);
    expect(grant2.json().walletUsd).toBe(15);

    // markup
    const mk = await app.inject({ method: "PUT", url: "/provision/markup", headers: prov, payload: { defaultMarkup: 0.2 } });
    expect(mk.json().defaultMarkup).toBe(0.2);

    // seller register → approve → listing
    const seller = await app.inject({ method: "POST", url: "/provision/seller", headers: prov, payload: { displayName: "hoang", commissionPct: 0.08 } });
    const sellerId = seller.json().seller.id;
    await app.inject({ method: "POST", url: `/provision/seller/${sellerId}/approve`, headers: prov });
    const listing = await app.inject({ method: "POST", url: "/provision/listing", headers: prov, payload: { sellerId, baseModel: "gpt-5.5", costPrice: { inputPerM: 2.4, outputPerM: 7 }, providerInstanceId: "provider_kiro_main", providerAccountId: "a1" } });
    expect(listing.statusCode).toBe(200);

    // mark-paid (credit first via the ledger)
    app.sellerEarningsLedger.credit(sellerId, 5);
    const paid = await app.inject({ method: "POST", url: `/provision/earnings/${sellerId}/mark-paid`, headers: prov, payload: { usd: 5 } });
    expect(paid.json().unpaid).toBe(0);
  });

  it("bad body → 400", async () => {
    const app = await build();
    const res = await app.inject({ method: "POST", url: "/provision/wallet/topup", headers: prov, payload: { keyId: "x", usd: -1 } });
    expect(res.statusCode).toBe(400);
  });
});

describe("business webhook admin", () => {
  it("get/update masks the secret", async () => {
    const app = await build();
    const put = await app.inject({ method: "PUT", url: "/admin/v1/business-webhook", headers: { authorization: `Bearer ${ADMIN}` }, payload: { enabled: true, url: "https://site.test/hook", secret: "topsecret", events: ["usage.recorded"] } });
    expect(put.statusCode).toBe(200);
    expect(put.json().secretSet).toBe(true);

    const get = await app.inject({ method: "GET", url: "/admin/v1/business-webhook", headers: { authorization: `Bearer ${ADMIN}` } });
    expect(get.json().secret).not.toContain("topsecret");
    expect(get.json().secretSet).toBe(true);
    expect(get.json().url).toBe("https://site.test/hook");
  });
});
