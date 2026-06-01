import { describe, expect, it, beforeEach } from "vitest";
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

const FUT = Date.now() + 365 * 24 * 60 * 60_000;

// ── M1: persisted pack reservations + boot sweep ────────────────────────────
describe("M1 — token-pack reservations survive a crash", () => {
  it("a reserved-but-unsettled pack is restored by the boot sweep", () => {
    const db = new Database(":memory:");
    const a = new TokenGrantService(db);
    const g = a.grant({ keyId: "k1", baseModel: "m", tokens: 1000, pricePaidUsd: 1, expiresAt: FUT, idempotencyKey: "i1" });
    a.reserve({ grantId: g.id, estTokens: 400 });
    expect(a.findUsable("k1", "m")?.tokensRemaining).toBe(600); // decremented

    // "restart": a fresh service on the SAME db loses the in-memory map, but the
    // reservation row persists. sweep returns the held tokens.
    const b = new TokenGrantService(db);
    const swept = b.sweepReservations();
    expect(swept).toBe(1);
    expect(b.findUsable("k1", "m")?.tokensRemaining).toBe(1000);
  });

  it("settle after a restart reads the estimate from the row", () => {
    const db = new Database(":memory:");
    const a = new TokenGrantService(db);
    const g = a.grant({ keyId: "k1", baseModel: "m", tokens: 1000, pricePaidUsd: 1, expiresAt: FUT, idempotencyKey: "i2" });
    const r = a.reserve({ grantId: g.id, estTokens: 400 });
    const b = new TokenGrantService(db); // fresh map
    if (r.ok) b.settle(r.reservationId, 250); // actual < est → refund 150
    expect(b.findUsable("k1", "m")?.tokensRemaining).toBe(750);
  });
});

// ── M2: exact conservation + assertion ──────────────────────────────────────
describe("M2 — settlement conservation is exact in micro", () => {
  function hookSetup() {
    const db = new Database(":memory:");
    const wallet = new WalletService(db);
    const sellers = new SellerService();
    const pricing = new MarketPricingService();
    const earnings = new SellerEarningsLedger(db);
    const ledger = new SpendLedgerService();
    const settlementLedger = new SettlementLedger(db, wallet, earnings, ledger);
    const modelPricing = new ModelPricingService();
    const hook = createSettlementHook({ spendLedgerService: ledger, walletService: wallet, sellerService: sellers, marketPricingService: pricing, sellerEarningsLedger: earnings, settlementLedger, modelPricingService: modelPricing });
    return { wallet, sellers, pricing, earnings, ledger, settlementLedger, hook };
  }

  it("collected_micro == sellerCredit_micro + platformMargin_micro after a real settle", () => {
    const { wallet, sellers, pricing, ledger, settlementLedger, hook } = hookSetup();
    const s = sellers.register({ displayName: "h", commissionPct: 0.1 }); sellers.approve(s.id);
    wallet.topupUsd("k1", 5);
    const wr = wallet.reserveUsd({ keyId: "k1", estimateUsd: 0.5 });
    const dr = ledger.reserve({ scope: "wallet:k1:payg", estimateUsd: 0.5, dayCap: 10 });
    const routed = { baseModel: "gpt-5.5", sellerId: s.id, accountId: "a", costPrice: { inputPerM: 2.111, outputPerM: 6.333 }, sellRates: pricing.sellPriceFor("gpt-5.5", { inputPerM: 2.111, outputPerM: 6.333 }) };
    const req = { routed, buyerKeyId: "k1", auth: { apiKeyHash: "h1" }, headers: {}, payg: { id: `${wr.ok ? wr.reservationId : ""}|${dr.ok ? dr.reservationId : ""}`, reason: "month_overage" } } as unknown as FastifyRequest;
    hook({ request: req, outcome: "success", model: "gpt-5.5", promptTokens: 1234, completionTokens: 567 });
    const rec = settlementLedger.query({ buyerKeyId: "k1" }).data[0];
    // stored micros conserve exactly (no ±1 drift)
    const c = Math.round(rec.collected * 1e6), cr = Math.round(rec.sellerCredit * 1e6), m = Math.round(rec.platformMargin * 1e6);
    expect(c).toBe(cr + m);
  });

  it("record() throws if the split does not conserve", () => {
    const { settlementLedger } = hookSetup();
    expect(() => settlementLedger.record({ buyerKeyId: "k", baseModel: "m", sellerId: "s", promptTokens: 0, completionTokens: 0, collected: 0.003, sellerCredit: 0.002, platformMargin: 0.002, billTrack: "payg" })).toThrow(/conservation/);
  });
});

// ── M4: pack reversal re-credits the tokens ─────────────────────────────────
describe("M4 — reversing a token-pack settlement restores the tokens", () => {
  it("re-credits the consumed tokens to the grant", () => {
    const db = new Database(":memory:");
    const wallet = new WalletService(db);
    const sellers = new SellerService();
    const pricing = new MarketPricingService();
    const earnings = new SellerEarningsLedger(db);
    const ledger = new SpendLedgerService();
    const settlementLedger = new SettlementLedger(db, wallet, earnings, ledger);
    const modelPricing = new ModelPricingService();
    const tokenGrants = new TokenGrantService(db);
    settlementLedger.setTokenGrantService(tokenGrants);
    const hook = createSettlementHook({ spendLedgerService: ledger, walletService: wallet, sellerService: sellers, marketPricingService: pricing, sellerEarningsLedger: earnings, settlementLedger, modelPricingService: modelPricing, tokenGrantService: tokenGrants });

    const g = tokenGrants.grant({ keyId: "k1", baseModel: "gpt-5.5", tokens: 100_000, pricePaidUsd: 5, expiresAt: FUT, idempotencyKey: "m4" });
    const r = tokenGrants.reserve({ grantId: g.id, estTokens: 2000 });
    const routed = { baseModel: "gpt-5.5", sellerId: "house", accountId: "ah", costPrice: { inputPerM: 2, outputPerM: 6 }, sellRates: pricing.sellPriceFor("gpt-5.5", { inputPerM: 2, outputPerM: 6 }) };
    const req = { routed, buyerKeyId: "k1", auth: { apiKeyHash: "h1" }, headers: {}, tokenPack: { id: r.ok ? r.reservationId : "", grantId: g.id, baseModel: "gpt-5.5" } } as unknown as FastifyRequest;
    hook({ request: req, outcome: "success", model: "gpt-5.5", promptTokens: 1000, completionTokens: 500 });
    const afterSettle = tokenGrants.findUsable("k1", "gpt-5.5")!.tokensRemaining; // 100000 − 1500

    const sid = req.settlement!.settlementId;
    expect(settlementLedger.reverseSettlement(sid, "refund")).toBe(true);
    expect(tokenGrants.findUsable("k1", "gpt-5.5")!.tokensRemaining).toBe(afterSettle + 1500);
  });
});

// ── M5: soonest-expiry first ────────────────────────────────────────────────
describe("M5 — packs are consumed soonest-expiry first", () => {
  it("picks the sooner-expiring covering pack", () => {
    const db = new Database(":memory:");
    const svc = new TokenGrantService(db);
    const soon = Date.now() + 2 * 24 * 60 * 60_000;
    const later = Date.now() + 200 * 24 * 60 * 60_000;
    svc.grant({ keyId: "k1", baseModel: "m", tokens: 5000, pricePaidUsd: 1, expiresAt: later, idempotencyKey: "late" });
    svc.grant({ keyId: "k1", baseModel: "m", tokens: 5000, pricePaidUsd: 1, expiresAt: soon, idempotencyKey: "soon" });
    const pick = svc.findUsable("k1", "m", 1000);
    expect(pick?.expiresAt).toBe(soon);
  });
});

// ── M6: over-run reported ───────────────────────────────────────────────────
describe("M6 — pack over-run is reported, not served free silently", () => {
  it("settle returns the over-delivered token count and floors remaining at 0", () => {
    const db = new Database(":memory:");
    const svc = new TokenGrantService(db);
    const g = svc.grant({ keyId: "k1", baseModel: "m", tokens: 100, pricePaidUsd: 1, expiresAt: FUT, idempotencyKey: "ov" });
    const r = svc.reserve({ grantId: g.id, estTokens: 100 });
    const over = r.ok ? svc.settle(r.reservationId, 150) : -1; // actual 150 > 100
    expect(over).toBe(50);
    expect(svc.findUsable("k1", "m")?.tokensRemaining ?? 0).toBe(0);
  });
});

// ── Grandfather cutoff ──────────────────────────────────────────────────────
describe("grandfather is bounded to legacy keys", () => {
  function setup() {
    const db = new Database(":memory:");
    const wallet = new WalletService(db);
    const plans = new PlanService();
    const ledger = new SpendLedgerService();
    const keys = new ApiKeyService();
    const s = new PlanSubscriptionService({ apiKeyService: keys, walletService: wallet, planService: plans, spendLedgerService: ledger });
    return { wallet, plans, ledger, keys, s };
  }

  it("a pre-cutoff plan-bound key with no period is grandfathered (no charge)", () => {
    const { wallet, keys, s } = setup();
    keys.addRecord({ id: "k_legacy", key: "igw_legacy", keyHash: "hl", enabled: true, planId: "plan_claude", createdAt: new Date(Date.UTC(2026, 4, 1)) });
    wallet.topupUsd("k_legacy", 50);
    const r = s.renewIfDue("k_legacy");
    expect(r.changed && r.kind).toBe("grandfathered");
    expect(wallet.getUsd("k_legacy")).toBe(50); // not charged
  });

  it("a post-cutoff plan-bound key with no period is charged (or downgraded)", () => {
    const { wallet, keys, s } = setup();
    keys.addRecord({ id: "k_new", key: "igw_new", keyHash: "hn", enabled: true, planId: "plan_claude", createdAt: new Date(Date.UTC(2026, 6, 1)) }); // after cutoff
    wallet.topupUsd("k_new", 50);
    const r = s.renewIfDue("k_new");
    expect(r.changed && r.kind).toBe("renewed");
    expect(wallet.getUsd("k_new")).toBe(40); // charged $10
  });
});

// ── refundUsd idempotency ───────────────────────────────────────────────────
describe("refundUsd idempotency", () => {
  it("credits once for a repeated idempotency key", () => {
    const db = new Database(":memory:");
    const wallet = new WalletService(db);
    wallet.topupUsd("k1", 1);
    wallet.refundUsd("k1", 5, "goodwill", "refund_1");
    wallet.refundUsd("k1", 5, "goodwill", "refund_1"); // retry
    expect(wallet.getUsd("k1")).toBe(6); // 1 + 5 once
  });
});

// ── commission clamp ────────────────────────────────────────────────────────
describe("SellerService.register clamps commissionPct", () => {
  it("clamps an out-of-range commission to [0,1]", () => {
    const sellers = new SellerService();
    const a = sellers.register({ displayName: "a", commissionPct: 1.5 });
    const b = sellers.register({ displayName: "b", commissionPct: -0.2 });
    expect(a.commissionPct).toBe(1);
    expect(b.commissionPct).toBe(0);
  });
});

// ── Database v8 migration ───────────────────────────────────────────────────
describe("Database v8 migration", () => {
  it("creates token_grant_reservations + wallet_ledger idempotency index + settlement grant_id", () => {
    const db = new Database(":memory:");
    expect((db.db.prepare("SELECT version FROM schema_meta LIMIT 1").get() as { version: number }).version).toBe(8);
    expect(db.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='token_grant_reservations'").get()).toBeDefined();
    expect(db.db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_wallet_ledger_idem'").get()).toBeDefined();
    const cols = db.db.prepare("PRAGMA table_info(settlement_log)").all() as Array<{ name: string }>;
    expect(cols.some((c) => c.name === "grant_id")).toBe(true);
    db.close();
  });
});
