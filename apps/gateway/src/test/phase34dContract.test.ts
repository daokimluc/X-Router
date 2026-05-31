import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { testConfig } from "./helpers.js";

const PROV = "prov-key-1";
const admin = { authorization: "Bearer admin-key-1" };
const prov = { authorization: `Bearer ${PROV}` };
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

describe("phase34d: seller externalRef", () => {
  it("registers with externalRef and filters by it (provision + admin)", async () => {
    const app = await build();
    const a = await app.inject({ method: "POST", url: "/provision/seller", headers: prov, payload: { displayName: "hoang", externalRef: "user_42" } });
    const b = await app.inject({ method: "POST", url: "/provision/seller", headers: prov, payload: { displayName: "cinb", externalRef: "user_99" } });
    expect(a.json().seller.externalRef).toBe("user_42");

    const filtered = await app.inject({ method: "GET", url: "/provision/sellers?externalRef=user_42", headers: prov });
    const ids = filtered.json().sellers.map((s: { externalRef: string }) => s.externalRef);
    expect(ids).toContain("user_42");
    expect(ids).not.toContain("user_99");

    // admin list filters too
    const adminFiltered = await app.inject({ method: "GET", url: "/admin/v1/sellers?externalRef=user_99", headers: admin });
    expect(adminFiltered.json().sellers).toHaveLength(1);
    expect(adminFiltered.json().sellers[0].displayName).toBe("cinb");
  });

  it("externalRef survives a state round-trip (toPersisted/load)", async () => {
    const app = await build();
    await app.inject({ method: "POST", url: "/provision/seller", headers: prov, payload: { displayName: "x", externalRef: "ext_1" } });
    const persisted = app.sellerService.toPersisted();
    expect(persisted.sellers.find((s) => s.externalRef === "ext_1")).toBeDefined();
  });
});

describe("phase34d: /provision/keys includes walletUsd", () => {
  it("returns walletUsd + provisioned per key (no N+1)", async () => {
    const app = await build();
    const k1 = await app.inject({ method: "POST", url: "/provision/key", headers: prov, payload: { label: "u1" } });
    const id1 = k1.json().id;
    await app.inject({ method: "POST", url: "/provision/wallet/topup", headers: prov, payload: { keyId: id1, usd: 3 } });
    await app.inject({ method: "POST", url: "/provision/key", headers: prov, payload: { label: "u1" } }); // no wallet

    const list = await app.inject({ method: "GET", url: "/provision/keys?owner=u1", headers: prov });
    const keys = list.json().keys;
    expect(keys).toHaveLength(2);
    const funded = keys.find((k: { id: string }) => k.id === id1);
    expect(funded).toMatchObject({ walletUsd: 3, provisioned: true });
    const unfunded = keys.find((k: { id: string }) => k.id !== id1);
    expect(unfunded).toMatchObject({ walletUsd: 0, provisioned: false });
  });
});

describe("phase34d: /provision/settlements per-record replay", () => {
  it("returns recorded money figures, filterable by seller + buyer key", async () => {
    const app = await build();
    // Seed two settlement_log rows directly via the ledger (the settle path is
    // covered elsewhere; here we test the read/replay endpoint).
    app.settlementLedger.record({
      buyerKeyId: "internal_key_1", baseModel: "gpt-5.5", sellerId: "hoang",
      promptTokens: 1000, completionTokens: 500, collected: 0.006, sellerCredit: 0.0048,
      platformMargin: 0.0012, billTrack: "payg", planScope: null
    });
    app.settlementLedger.record({
      buyerKeyId: "internal_key_2", baseModel: "claude-sonnet-4-6", sellerId: "house",
      promptTokens: 200, completionTokens: 100, collected: 0.002, sellerCredit: 0,
      platformMargin: 0.002, billTrack: "plan", planScope: "key:internal_key_2:grp:claude"
    });

    const all = await app.inject({ method: "GET", url: "/provision/settlements", headers: prov });
    expect(all.json().total).toBe(2);
    const row = all.json().data.find((r: { buyerKeyId: string }) => r.buyerKeyId === "internal_key_1");
    expect(row).toMatchObject({ sellerId: "hoang", collected: 0.006, sellerCredit: 0.0048, platformMargin: 0.0012, billTrack: "payg", reversed: false });

    const bySeller = await app.inject({ method: "GET", url: "/provision/settlements?sellerId=hoang", headers: prov });
    expect(bySeller.json().total).toBe(1);
    expect(bySeller.json().data[0].sellerId).toBe("hoang");

    // unknown keyId → empty (no leak)
    const unknown = await app.inject({ method: "GET", url: "/provision/settlements?keyId=nope", headers: prov });
    expect(unknown.json()).toMatchObject({ data: [], total: 0 });
  });
});
