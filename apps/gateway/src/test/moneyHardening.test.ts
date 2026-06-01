import { describe, expect, it, beforeEach } from "vitest";
import { afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../app.js";
import { PersistenceService } from "../services/PersistenceService.js";
import { testConfig } from "./helpers.js";
import type { FastifyInstance } from "fastify";
import { Database } from "../services/Database.js";
import { WalletService } from "../marketplace/services/WalletService.js";
import { PlanService } from "../marketplace/services/PlanService.js";
import { PlanSubscriptionService } from "../marketplace/services/PlanSubscriptionService.js";
import { SellerService } from "../marketplace/services/SellerService.js";
import { MarketPricingService } from "../marketplace/services/MarketPricingService.js";
import { SellerEarningsLedger } from "../marketplace/services/SellerEarningsLedger.js";
import { SettlementLedger } from "../marketplace/services/SettlementLedger.js";
import { TokenGrantService } from "../marketplace/services/TokenGrantService.js";
import { createSettlementHook } from "../marketplace/policy/settlementHook.js";
import { SpendLedgerService } from "../services/SpendLedgerService.js";
import { ApiKeyService } from "../services/ApiKeyService.js";
import { ModelPricingService } from "../services/ModelPricingService.js";
import type { FastifyRequest } from "fastify";

const T0 = Date.UTC(2026, 5, 1, 12, 0, 0, 0);

// ── C1: renewal double-charge on restart ───────────────────────────────────
describe("C1 — subscription renewal is durably idempotent per period", () => {
  function svc(db: Database, now: () => number) {
    const wallet = new WalletService(db);
    const plans = new PlanService();
    const ledger = new SpendLedgerService();
    const keys = new ApiKeyService();
    const s = new PlanSubscriptionService({ apiKeyService: keys, walletService: wallet, planService: plans, spendLedgerService: ledger, now });
    return { wallet, plans, keys, s };
  }

  it("does NOT re-charge the same period after a simulated restart (stale in-memory period)", () => {
    const db = new Database(":memory:"); // shared durable store across the "restart"
    let now = T0;
    const a = svc(db, () => now);
    const key = a.keys.create({ owner: "b" });
    a.wallet.topupUsd(key.id, 100);
    a.s.subscribe(key.id, a.plans.get("plan_claude")!); // −10 → 90, period P1
    const p1 = a.keys.findById(key.id)!.planPeriodEnd!;
    now = p1 + 1000;
    a.s.renewIfDue(key.id); // −10 → 80, durable plan_charges row for renew@P2
    expect(a.wallet.getUsd(key.id)).toBe(80);
    const p2 = a.keys.findById(key.id)!.planPeriodEnd!;

    // Simulate restart: fresh services on the SAME db, key reloaded with the STALE
    // period (p1) — as if the renewal's in-memory advance was never persisted.
    const b = svc(db, () => now);
    b.keys.addRecord({ id: key.id, key: key.key, keyHash: key.keyHash, enabled: true, planId: "plan_claude", planPeriodEnd: p1, planChargedAt: T0, createdAt: new Date() });
    const r = b.s.renewIfDue(key.id);
    // Period p2 was already charged durably → no second debit.
    expect(b.wallet.getUsd(key.id)).toBe(80);
    expect(r.changed && r.kind).toBe("renewed"); // catch-up advance, not a charge
    expect(b.keys.findById(key.id)!.planPeriodEnd).toBe(p2);
  });

  it("subscribe replay after a lost binding does not double-charge", () => {
    const db = new Database(":memory:");
    let now = T0;
    const a = svc(db, () => now);
    const key = a.keys.create({});
    a.wallet.topupUsd(key.id, 100);
    a.s.subscribe(key.id, a.plans.get("plan_claude")!); // −10 → 90
    expect(a.wallet.getUsd(key.id)).toBe(90);

    // Restart, plan binding lost (key reloaded plan-less), buyer re-subscribes.
    now = T0 + 5000;
    const b = svc(db, () => now);
    b.keys.addRecord({ id: key.id, key: key.key, keyHash: key.keyHash, enabled: true, createdAt: new Date() });
    const r = b.s.subscribe(key.id, b.plans.get("plan_claude")!);
    expect(r.ok && r.idempotent).toBe(true);
    expect(b.wallet.getUsd(key.id)).toBe(90); // NOT charged again
  });

  it("a genuine renewal of a new period still charges", () => {
    const db = new Database(":memory:");
    let now = T0;
    const { wallet, plans, keys, s } = svc(db, () => now);
    const key = keys.create({});
    wallet.topupUsd(key.id, 100);
    s.subscribe(key.id, plans.get("plan_claude")!); // −10 → 90
    now = keys.findById(key.id)!.planPeriodEnd! + 1000;
    s.renewIfDue(key.id); // −10 → 80 (new period, real charge)
    expect(wallet.getUsd(key.id)).toBe(80);
  });
});

// ── C2: token-pack value excluded from wallet solvency ──────────────────────
describe("C2 — token-pack value does not inflate wallet solvency", () => {
  it("pack settle leaves wallet reconcilePlatform + getPlatformMargin untouched, packs reconciled apart", () => {
    const db = new Database(":memory:");
    const wallet = new WalletService(db);
    const sellers = new SellerService();
    const pricing = new MarketPricingService();
    const earnings = new SellerEarningsLedger(db);
    const ledger = new SpendLedgerService();
    const settlementLedger = new SettlementLedger(db, wallet, earnings, ledger);
    const modelPricing = new ModelPricingService();
    const tokenGrants = new TokenGrantService(db);
    const hook = createSettlementHook({ spendLedgerService: ledger, walletService: wallet, sellerService: sellers, marketPricingService: pricing, sellerEarningsLedger: earnings, settlementLedger, modelPricingService: modelPricing, tokenGrantService: tokenGrants });

    const hoang = sellers.register({ displayName: "h", commissionPct: 0.1 }); sellers.approve(hoang.id);
    const g = tokenGrants.grant({ keyId: "k1", baseModel: "gpt-5.5", tokens: 1_000_000, pricePaidUsd: 5, expiresAt: Date.now() + 1e9, idempotencyKey: "p1" });
    const r = tokenGrants.reserve({ grantId: g.id, estTokens: 2000 });
    const routed = { baseModel: "gpt-5.5", sellerId: hoang.id, accountId: "a1", costPrice: { inputPerM: 2.1, outputPerM: 6.3 }, sellRates: pricing.sellPriceFor("gpt-5.5", { inputPerM: 2.1, outputPerM: 6.3 }) };
    const req = { routed, buyerKeyId: "k1", auth: { apiKeyHash: "h1" }, headers: {}, tokenPack: { id: r.ok ? r.reservationId : "", grantId: g.id, baseModel: "gpt-5.5" } } as unknown as FastifyRequest;

    hook({ request: req, outcome: "success", model: "gpt-5.5", promptTokens: 1000, completionTokens: 500 });

    const plat = settlementLedger.reconcilePlatform();
    expect(plat.totalCollected).toBe(0);        // no wallet cash from a pack
    expect(earnings.getPlatformMargin()).toBe(0); // pack margin NOT in wallet margin
    const packs = settlementLedger.reconcilePacks();
    expect(packs.totalPricePaid).toBe(5);
    expect(packs.recognizedValue).toBeGreaterThan(0);
    expect(packs.ok).toBe(true);                  // recognized ≤ pricePaid
    expect(earnings.snapshot(hoang.id).lifetime).toBeGreaterThan(0); // seller still credited
  });
});

// ── H2/H3: payout idempotency + over-payout detection ───────────────────────
describe("H2/H3 — payout integrity", () => {
  let db: Database;
  let wallet: WalletService;
  let sellers: SellerService;
  let earnings: SellerEarningsLedger;
  let ledger: SpendLedgerService;
  let settlementLedger: SettlementLedger;

  beforeEach(() => {
    db = new Database(":memory:");
    wallet = new WalletService(db);
    sellers = new SellerService();
    earnings = new SellerEarningsLedger(db);
    ledger = new SpendLedgerService();
    settlementLedger = new SettlementLedger(db, wallet, earnings, ledger);
  });

  it("markPaid is idempotent on payoutRef — one payout, unpaid reduced once", () => {
    const s = sellers.register({ displayName: "h" }); sellers.approve(s.id);
    earnings.credit(s.id, 10);
    earnings.markPaid(s.id, 4, "wire_1");
    earnings.markPaid(s.id, 4, "wire_1"); // retry, same ref
    expect(earnings.snapshot(s.id).unpaid).toBe(6); // reduced once, not to 2
  });

  it("markPaid on an unknown seller logs no payout", () => {
    earnings.markPaid("ghost", 5, "wire_x");
    // reconcileSeller for a never-seen seller: no credits, no payouts.
    const rec = settlementLedger.reconcileSeller("ghost");
    expect(rec.actualUnpaid).toBe(0);
    expect(rec.ok).toBe(true);
  });

  it("clawback after payout is reported (ok=false + overPaidUsd), not hidden", () => {
    const s = sellers.register({ displayName: "h", commissionPct: 0 }); sellers.approve(s.id);
    // credit via a settlement row so the reversal has something to unwind
    const id = settlementLedger.record({ buyerKeyId: "k1", baseModel: "gpt-5.5", sellerId: s.id, promptTokens: 1000, completionTokens: 500, collected: 0.005, sellerCredit: 0.005, platformMargin: 0, billTrack: "payg" });
    earnings.credit(s.id, 0.005);
    earnings.markPaid(s.id, 0.005, "wire_2"); // paid out in full → unpaid 0
    settlementLedger.reverseSettlement(id, "fraud"); // claws back after payout
    const rec = settlementLedger.reconcileSeller(s.id);
    expect(rec.ok).toBe(false);
    expect(rec.overPaidUsd).toBeGreaterThan(0);
  });
});

// ── Database v7 migration ───────────────────────────────────────────────────
describe("Database v7 migration", () => {
  it("creates plan_charges + the payout_ref unique index", () => {
    const db = new Database(":memory:");
    expect(db.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='plan_charges'").get()).toBeDefined();
    expect(db.db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_payouts_ref'").get()).toBeDefined();
    db.close();
  });

  it("payout_ref unique index blocks a duplicate non-null ref but allows many nulls", () => {
    const db = new Database(":memory:");
    const ins = (ref: string | null) => db.db.prepare("INSERT INTO payouts (id, seller_id, usd_micro, ts, payout_ref, kind) VALUES (?, 's', 1, 1, ?, 'paid')").run(`po_${Math.random()}`, ref);
    ins(null); ins(null); // multiple nulls OK
    ins("ref1");
    expect(() => ins("ref1")).toThrow(); // duplicate non-null ref rejected
    db.close();
  });
});

// ── H1 + H4: real-app wiring ────────────────────────────────────────────────
describe("H1/H4 — real-app money hardening wiring", () => {
  const apps: FastifyInstance[] = [];
  afterEach(async () => { while (apps.length) { const a = apps.pop(); if (a) await a.close(); } });

  async function build(persistenceService?: PersistenceService) {
    // Inject a fresh in-memory DB so there is no leftover wallet row from the
    // shared on-disk test SQLite path — we want to prove the boot path itself
    // does not reseed from the JSON snapshot.
    const app = await buildApp(testConfig({ marketplaceEnabled: true, requestBodyLimit: "1mb" }), { persistenceService, database: new Database(":memory:") });
    await app.ready();
    apps.push(app);
    return app;
  }

  it("H1: releaseLeakedReservations frees a held PAYG wallet reservation", async () => {
    const app = await build();
    const key = app.apiKeyService.create({});
    app.walletService.topupUsd(key.id, 5);
    const res = app.walletService.reserveUsd({ keyId: key.id, estimateUsd: 2 });
    expect(app.walletService.getUsd(key.id)).toBe(3); // held
    const req = { payg: { id: res.ok ? res.reservationId : "", reason: "boost" } } as unknown as Parameters<typeof app.marketplaceSeam.releaseLeakedReservations>[0];
    app.marketplaceSeam.releaseLeakedReservations(req);
    expect(app.walletService.getUsd(key.id)).toBe(5); // restored
    expect((req as { payg?: unknown }).payg).toBeUndefined();
  });

  it("H1: releaseLeakedReservations frees a held token-pack reservation", async () => {
    const app = await build();
    const key = app.apiKeyService.create({});
    const g = app.tokenGrantService.grant({ keyId: key.id, baseModel: "gpt-5.5", tokens: 1000, pricePaidUsd: 1, expiresAt: Date.now() + 1e9, idempotencyKey: "h1pack" });
    const r = app.tokenGrantService.reserve({ grantId: g.id, estTokens: 400 });
    expect(app.tokenGrantService.findUsable(key.id, "gpt-5.5")?.tokensRemaining).toBe(600);
    const req = { tokenPack: { id: r.ok ? r.reservationId : "", grantId: g.id, baseModel: "gpt-5.5" } } as unknown as Parameters<typeof app.marketplaceSeam.releaseLeakedReservations>[0];
    app.marketplaceSeam.releaseLeakedReservations(req);
    expect(app.tokenGrantService.findUsable(key.id, "gpt-5.5")?.tokensRemaining).toBe(1000);
  });

  it("H4: a stale walletMicroUsd snapshot does not reseed a phantom balance at boot", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wallet-h4-"));
    const file = join(dir, "state.json");
    // Key carries a $10 snapshot but there is NO SQLite wallet row (fresh :memory: DB).
    writeFileSync(file, JSON.stringify({
      apiKeys: [{ id: "internal_key_1", key: "igw_x", keyHash: "h1", enabled: true, walletMicroUsd: 10_000_000, createdAt: new Date().toISOString() }]
    }), "utf8");
    const app = await build(new PersistenceService(file));
    expect(app.walletService.isProvisioned("internal_key_1")).toBe(false); // NOT reseeded
    expect(app.walletService.getUsd("internal_key_1")).toBe(0);
    rmSync(dir, { recursive: true, force: true });
  });
});

