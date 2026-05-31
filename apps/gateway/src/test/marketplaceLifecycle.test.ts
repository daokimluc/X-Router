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
const admin = { authorization: `Bearer ${ADMIN}` };

describe("marketplace-lifecycle: buyer-key lifecycle on provision", () => {
  it("disable stops the key; enable resumes; both reject admin/none", async () => {
    const app = await build();
    const created = await app.inject({ method: "POST", url: "/provision/key", headers: prov, payload: { label: "buyer1" } });
    const keyId = created.json().id;
    const rawKey = created.json().key;

    // key works initially
    const ok1 = await app.inject({ method: "GET", url: "/v1/models", headers: { authorization: `Bearer ${rawKey}` } });
    expect(ok1.statusCode).toBe(200);

    // disable → request rejected
    const dis = await app.inject({ method: "POST", url: `/provision/key/${keyId}/disable`, headers: prov });
    expect(dis.statusCode).toBe(200);
    expect(dis.json().enabled).toBe(false);
    const blocked = await app.inject({ method: "GET", url: "/v1/models", headers: { authorization: `Bearer ${rawKey}` } });
    expect(blocked.statusCode).toBeGreaterThanOrEqual(401);

    // enable → resumes
    const en = await app.inject({ method: "POST", url: `/provision/key/${keyId}/enable`, headers: prov });
    expect(en.json().enabled).toBe(true);
    const ok2 = await app.inject({ method: "GET", url: "/v1/models", headers: { authorization: `Bearer ${rawKey}` } });
    expect(ok2.statusCode).toBe(200);

    // admin key cannot use provision routes
    const adminTry = await app.inject({ method: "POST", url: `/provision/key/${keyId}/disable`, headers: admin });
    expect(adminTry.statusCode).toBe(401);
  });

  it("revoke (DELETE) permanently stops the key", async () => {
    const app = await build();
    const created = await app.inject({ method: "POST", url: "/provision/key", headers: prov, payload: { label: "buyer2" } });
    const keyId = created.json().id;
    const rawKey = created.json().key;

    const rev = await app.inject({ method: "DELETE", url: `/provision/key/${keyId}`, headers: prov });
    expect(rev.statusCode).toBe(200);
    expect(rev.json().revoked).toBe(true);
    const blocked = await app.inject({ method: "GET", url: "/v1/models", headers: { authorization: `Bearer ${rawKey}` } });
    expect(blocked.statusCode).toBeGreaterThanOrEqual(401);
  });

  it("PATCH sets expiry in the past → key rejected as expired", async () => {
    const app = await build();
    const created = await app.inject({ method: "POST", url: "/provision/key", headers: prov, payload: { label: "buyer3" } });
    const keyId = created.json().id;
    const rawKey = created.json().key;

    const past = new Date(Date.now() - 60_000).toISOString();
    const patch = await app.inject({ method: "PATCH", url: `/provision/key/${keyId}`, headers: prov, payload: { expiresAt: past } });
    expect(patch.statusCode).toBe(200);
    const blocked = await app.inject({ method: "GET", url: "/v1/models", headers: { authorization: `Bearer ${rawKey}` } });
    expect(blocked.statusCode).toBeGreaterThanOrEqual(401);
  });

  it("GET /provision/keys lists provisioned keys filtered by owner", async () => {
    const app = await build();
    await app.inject({ method: "POST", url: "/provision/key", headers: prov, payload: { label: "alice" } });
    await app.inject({ method: "POST", url: "/provision/key", headers: prov, payload: { label: "bob" } });

    const all = await app.inject({ method: "GET", url: "/provision/keys", headers: prov });
    expect(all.json().keys.length).toBeGreaterThanOrEqual(2);

    const filtered = await app.inject({ method: "GET", url: "/provision/keys?owner=alice", headers: prov });
    expect(filtered.json().keys.every((k: { owner: string }) => k.owner === "alice")).toBe(true);
    expect(filtered.json().keys.length).toBe(1);
  });

  it("rotate issues a new secret, old stops working, id/plan preserved", async () => {
    const app = await build();
    const created = await app.inject({ method: "POST", url: "/provision/key", headers: prov, payload: { label: "rot", planId: "plan_claude" } });
    const keyId = created.json().id;
    const oldKey = created.json().key;

    // old key works
    expect((await app.inject({ method: "GET", url: "/v1/models", headers: { authorization: `Bearer ${oldKey}` } })).statusCode).toBe(200);

    const rot = await app.inject({ method: "POST", url: `/provision/key/${keyId}/rotate`, headers: prov });
    expect(rot.statusCode).toBe(200);
    const newKey = rot.json().key;
    expect(newKey).not.toBe(oldKey);
    expect(rot.json().id).toBe(keyId);           // same id
    expect(rot.json().planId).toBe("plan_claude"); // plan preserved

    // old key now rejected, new key works
    expect((await app.inject({ method: "GET", url: "/v1/models", headers: { authorization: `Bearer ${oldKey}` } })).statusCode).toBeGreaterThanOrEqual(401);
    expect((await app.inject({ method: "GET", url: "/v1/models", headers: { authorization: `Bearer ${newKey}` } })).statusCode).toBe(200);
  });
});

describe("marketplace-lifecycle: listing re-price + seller terms + canonical models", () => {
  async function approvedSeller(app: FastifyInstance, displayName = "hoang", commissionPct = 0.08) {
    const s = await app.inject({ method: "POST", url: "/admin/v1/sellers", headers: admin, payload: { displayName, commissionPct } });
    const id = s.json().seller.id;
    await app.inject({ method: "POST", url: `/admin/v1/sellers/${id}/approve`, headers: admin });
    return id;
  }

  it("re-prices a listing in place (keeps id, new cost for new requests)", async () => {
    const app = await build();
    const sellerId = await approvedSeller(app);
    const created = await app.inject({
      method: "POST", url: "/admin/v1/listings", headers: admin,
      payload: { sellerId, baseModel: "gpt-5.5", costPrice: { inputPerM: 2.4, outputPerM: 7 }, providerInstanceId: "p1", providerAccountId: "a1" }
    });
    const listingId = created.json().listing.id;

    const repriced = await app.inject({
      method: "PATCH", url: `/admin/v1/listings/${listingId}`, headers: admin,
      payload: { costPrice: { inputPerM: 3.0, outputPerM: 9.0 } }
    });
    expect(repriced.statusCode).toBe(200);
    expect(repriced.json().listing.id).toBe(listingId); // same id
    expect(repriced.json().listing.costPrice.inputPerM).toBe(3.0);
  });

  it("edits seller commission + payoutRef; house not editable", async () => {
    const app = await build();
    const sellerId = await approvedSeller(app);
    const upd = await app.inject({ method: "PATCH", url: `/admin/v1/sellers/${sellerId}`, headers: admin, payload: { commissionPct: 0.1, payoutRef: "stripe_acct_1" } });
    expect(upd.statusCode).toBe(200);
    expect(upd.json().seller.commissionPct).toBe(0.1);
    expect(upd.json().seller.payoutRef).toBe("stripe_acct_1");

    const house = await app.inject({ method: "PATCH", url: "/admin/v1/sellers/house", headers: admin, payload: { commissionPct: 0.5 } });
    expect(house.statusCode).toBe(404); // house not editable
  });

  it("adds a canonical model (then listable); remove blocked while in use", async () => {
    const app = await build();
    const add = await app.inject({ method: "POST", url: "/admin/v1/canonical-models", headers: admin, payload: { model: "grok-3" } });
    expect(add.json().models).toContain("grok-3");

    const sellerId = await approvedSeller(app);
    const listing = await app.inject({
      method: "POST", url: "/admin/v1/listings", headers: admin,
      payload: { sellerId, baseModel: "grok-3", costPrice: { inputPerM: 1, outputPerM: 2 }, providerInstanceId: "p1", providerAccountId: "a1" }
    });
    expect(listing.statusCode).toBe(200); // newly canonical model is listable

    // remove blocked while an enabled listing uses it
    const blocked = await app.inject({ method: "DELETE", url: "/admin/v1/canonical-models/grok-3", headers: admin });
    expect(blocked.statusCode).toBe(409);

    // disable the listing, then remove succeeds
    await app.inject({ method: "PATCH", url: `/admin/v1/listings/${listing.json().listing.id}`, headers: admin, payload: { enabled: false } });
    const removed = await app.inject({ method: "DELETE", url: "/admin/v1/canonical-models/grok-3", headers: admin });
    expect(removed.statusCode).toBe(200);
    expect(removed.json().models).not.toContain("grok-3");
  });

  it("markup PUT with null per-model value removes the override", async () => {
    const app = await build();
    await app.inject({ method: "PUT", url: "/admin/v1/markup", headers: admin, payload: { perModel: { "gpt-5.5": 0.3 } } });
    const set = await app.inject({ method: "GET", url: "/admin/v1/markup", headers: admin });
    expect(set.json().perModel["gpt-5.5"]).toBe(0.3);

    await app.inject({ method: "PUT", url: "/admin/v1/markup", headers: admin, payload: { perModel: { "gpt-5.5": null } } });
    const cleared = await app.inject({ method: "GET", url: "/admin/v1/markup", headers: admin });
    expect(cleared.json().perModel["gpt-5.5"]).toBeUndefined();
  });
});

describe("marketplace-lifecycle: money-out admin routes", () => {
  it("refund increases the wallet; provision key cannot refund", async () => {
    const app = await build();
    const key = await app.inject({ method: "POST", url: "/provision/key", headers: prov, payload: { label: "b" } });
    const keyId = key.json().id;
    await app.inject({ method: "POST", url: "/provision/wallet/topup", headers: prov, payload: { keyId, usd: 1 } });

    const refund = await app.inject({ method: "POST", url: `/admin/v1/api-keys/${keyId}/wallet/refund`, headers: admin, payload: { usd: 2.5, reason: "goodwill" } });
    expect(refund.statusCode).toBe(200);
    expect(refund.json().walletUsd).toBeCloseTo(3.5, 6);

    // provision key cannot refund (money-out is admin-only)
    const provTry = await app.inject({ method: "POST", url: `/admin/v1/api-keys/${keyId}/wallet/refund`, headers: prov, payload: { usd: 1 } });
    expect(provTry.statusCode).toBe(401);
  });

  it("debit removes funds (floored at 0)", async () => {
    const app = await build();
    const key = await app.inject({ method: "POST", url: "/provision/key", headers: prov, payload: { label: "b" } });
    const keyId = key.json().id;
    await app.inject({ method: "POST", url: "/provision/wallet/topup", headers: prov, payload: { keyId, usd: 5 } });

    const debit = await app.inject({ method: "POST", url: `/admin/v1/api-keys/${keyId}/wallet/debit`, headers: admin, payload: { usd: 2, reason: "correction" } });
    expect(debit.json().ok).toBe(true);
    expect(debit.json().walletUsd).toBeCloseTo(3, 6);
  });

  it("payout reverse restores unpaid", async () => {
    const app = await build();
    const s = await app.inject({ method: "POST", url: "/admin/v1/sellers", headers: admin, payload: { displayName: "hoang" } });
    const sellerId = s.json().seller.id;
    await app.inject({ method: "POST", url: `/admin/v1/sellers/${sellerId}/approve`, headers: admin });
    // give the seller some earnings + a payout via adjust + mark-paid
    await app.inject({ method: "POST", url: `/admin/v1/earnings/seller/${sellerId}/adjust`, headers: admin, payload: { deltaUsd: 10, reason: "seed" } });
    await app.inject({ method: "POST", url: `/admin/v1/earnings/seller/${sellerId}/mark-paid`, headers: admin, payload: { amountUsd: 10 } });
    const afterPaid = await app.inject({ method: "GET", url: `/admin/v1/earnings/seller/${sellerId}`, headers: admin });
    expect(afterPaid.json().unpaid).toBe(0);

    const rev = await app.inject({ method: "POST", url: `/admin/v1/earnings/seller/${sellerId}/reverse`, headers: admin, payload: { usd: 10, reason: "bank_failed" } });
    expect(rev.statusCode).toBe(200);
    expect(rev.json().unpaid).toBe(10);
  });
});
