import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { testConfig } from "./helpers.js";
import { LocalEncryptionService } from "../services/LocalEncryptionService.js";
import type { PersistenceService } from "../services/PersistenceService.js";
import { makeTestDb } from "./helpers.js";

const PROV = "prov-key-1";
const apps: FastifyInstance[] = [];

afterEach(async () => {
  while (apps.length) {
    const a = apps.pop();
    if (a) await a.close();
  }
});

async function build(extra: Record<string, unknown> = {}) {
  const app = await buildApp(testConfig({ marketplaceEnabled: true, requestBodyLimit: "1mb", provisionApiKeys: [PROV], ...extra }));
  await app.ready();
  apps.push(app);
  return app;
}

/** A PersistenceService stub whose load() returns a fixed state (no disk). */
function stubPersistence(marketplaceSlice: Record<string, unknown>): PersistenceService {
  const state = {
    providerInstances: [],
    accounts: [],
    modelMappings: [],
    routingProfiles: [],
    apiKeys: [],
    secrets: [],
    config: { current: null, revisions: [] },
    tokenSaver: undefined,
    teams: [],
    usage: [],
    requestLogs: [],
    proxyPools: [],
    rateLimitCounters: [],
    modelPricing: [],
    spendLedger: undefined,
    marketplace: marketplaceSlice
  };
  return {
    load: async () => state,
    save: async () => {},
    saveDebounced: () => {},
    flush: async () => {},
    drain: async () => {}
  } as unknown as PersistenceService;
}

async function buildWithState(marketplaceSlice: Record<string, unknown>) {
  const app = await buildApp(
    testConfig({ marketplaceEnabled: true, requestBodyLimit: "1mb", provisionApiKeys: [PROV] }),
    { persistenceService: stubPersistence(marketplaceSlice), database: makeTestDb() }
  );
  await app.ready();
  apps.push(app);
  return app;
}

const prov = { authorization: `Bearer ${PROV}` };
const admin = { authorization: "Bearer admin-key-1" };

describe("provision-hardening: webhook secret encrypted at rest", () => {
  it("persists the secret as ciphertext but signs with the plaintext", async () => {
    const app = await build();
    // Set a business webhook secret via admin.
    await app.inject({ method: "PUT", url: "/admin/v1/business-webhook", headers: admin, payload: { enabled: true, url: "https://example.com/hook", secret: "super-secret-123", events: ["usage.recorded"] } });

    // The persistence contributor must emit ciphertext, not the raw secret.
    const persisted = (app.marketplaceSeam.collectPersisted().businessWebhook as { secret: string });
    expect(persisted.secret).not.toBe("super-secret-123");
    expect(persisted.secret).not.toBe("");
    const enc = new LocalEncryptionService("development-local-secret-key");
    expect(enc.isCiphertext(persisted.secret)).toBe(true);
    expect(enc.decryptString(persisted.secret)).toBe("super-secret-123");

    // GET masks it.
    const get = await app.inject({ method: "GET", url: "/admin/v1/business-webhook", headers: admin });
    expect(get.json().secretSet).toBe(true);
    expect(get.json().secret).toBe("••••••••");
  });

  it("decrypts a persisted ciphertext secret on load (round-trip)", async () => {
    const enc = new LocalEncryptionService("development-local-secret-key");
    const cipher = enc.encryptString("rt-secret");
    const app = await buildWithState({ businessWebhook: { enabled: true, url: "https://e.com", secret: cipher, events: [] } });
    // In-memory config has the decrypted plaintext (so HMAC works).
    expect(app.webhookService.getBusinessConfig().secret).toBe("rt-secret");
  });

  it("tolerates a legacy plaintext secret on load (pre-#5 state)", async () => {
    const app = await buildWithState({ businessWebhook: { enabled: true, url: "https://e.com", secret: "legacy-plain", events: [] } });
    // Plaintext is kept as-is (not ciphertext → used directly), re-encrypted on next persist.
    expect(app.webhookService.getBusinessConfig().secret).toBe("legacy-plain");
    const persisted = (app.marketplaceSeam.collectPersisted().businessWebhook as { secret: string });
    expect(new LocalEncryptionService("development-local-secret-key").isCiphertext(persisted.secret)).toBe(true);
  });
});

describe("provision-hardening: rate limit on privileged routes", () => {
  it("returns 429 once the per-minute cap is exceeded; reads stay open", async () => {
    const app = await build({ provisionRateLimitPerMinute: 3 });
    // 3 allowed key-creates, the 4th is limited.
    const codes: number[] = [];
    for (let i = 0; i < 4; i++) {
      const r = await app.inject({ method: "POST", url: "/provision/key", headers: prov, payload: { label: `b${i}` } });
      codes.push(r.statusCode);
    }
    expect(codes.slice(0, 3).every((c) => c === 200)).toBe(true);
    expect(codes[3]).toBe(429);

    // Reads are not throttled.
    const read = await app.inject({ method: "GET", url: "/provision/plans", headers: prov });
    expect(read.statusCode).toBe(200);
  });

  it("no limit when provisionRateLimitPerMinute is 0", async () => {
    const app = await build({ provisionRateLimitPerMinute: 0 });
    for (let i = 0; i < 6; i++) {
      const r = await app.inject({ method: "POST", url: "/provision/key", headers: prov, payload: {} });
      expect(r.statusCode).toBe(200);
    }
  });
});

describe("provision-hardening: contract drift", () => {
  it("mark-paid persists payoutRef and accepts both usd and amountUsd", async () => {
    const app = await build();
    const s = await app.inject({ method: "POST", url: "/provision/seller", headers: prov, payload: { displayName: "hoang" } });
    const sellerId = s.json().seller.id;
    await app.inject({ method: "POST", url: `/provision/seller/${sellerId}/approve`, headers: prov });
    // seed earnings via admin adjust
    await app.inject({ method: "POST", url: `/admin/v1/earnings/seller/${sellerId}/adjust`, headers: admin, payload: { deltaUsd: 20 } });

    // mark-paid with payoutRef via provision (uses `usd`)
    const paid = await app.inject({ method: "POST", url: `/provision/earnings/${sellerId}/mark-paid`, headers: prov, payload: { usd: 5, payoutRef: "wire_abc" } });
    expect(paid.statusCode).toBe(200);
    expect(paid.json().unpaid).toBeCloseTo(15, 6);

    // the payout record carries the ref
    const payout = (app.database.db.prepare("SELECT payout_ref FROM payouts WHERE seller_id = ? ORDER BY ts DESC LIMIT 1").get(sellerId) as { payout_ref: string | null });
    expect(payout.payout_ref).toBe("wire_abc");

    // amountUsd also accepted (legacy field)
    const paid2 = await app.inject({ method: "POST", url: `/provision/earnings/${sellerId}/mark-paid`, headers: prov, payload: { amountUsd: 5 } });
    expect(paid2.json().unpaid).toBeCloseTo(10, 6);
  });

  it("wallet topup accepts both usd and amountUsd", async () => {
    const app = await build();
    const key = await app.inject({ method: "POST", url: "/provision/key", headers: prov, payload: {} });
    const keyId = key.json().id;
    const a = await app.inject({ method: "POST", url: "/provision/wallet/topup", headers: prov, payload: { keyId, amountUsd: 3 } });
    expect(a.json().walletUsd).toBe(3);
    const b = await app.inject({ method: "POST", url: "/provision/wallet/topup", headers: prov, payload: { keyId, usd: 2 } });
    expect(b.json().walletUsd).toBe(5);
  });
});

describe("provision-hardening: multiple provision keys", () => {
  it("any configured provision key authorizes", async () => {
    const app = await build({ provisionApiKeys: [PROV, "prov-key-2"] });
    const a = await app.inject({ method: "GET", url: "/provision/plans", headers: { authorization: `Bearer ${PROV}` } });
    const b = await app.inject({ method: "GET", url: "/provision/plans", headers: { authorization: "Bearer prov-key-2" } });
    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(200);
    const c = await app.inject({ method: "GET", url: "/provision/plans", headers: { authorization: "Bearer nope" } });
    expect(c.statusCode).toBe(401);
  });
});
