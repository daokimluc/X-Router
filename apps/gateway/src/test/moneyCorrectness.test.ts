import { describe, expect, it, beforeEach } from "vitest";
import type { FastifyRequest } from "fastify";
import { createSettlementHook } from "../marketplace/policy/settlementHook.js";
import { WalletService } from "../marketplace/services/WalletService.js";
import { SellerService, HOUSE_SELLER_ID } from "../marketplace/services/SellerService.js";
import { MarketPricingService } from "../marketplace/services/MarketPricingService.js";
import { SellerEarningsLedger } from "../marketplace/services/SellerEarningsLedger.js";
import { SettlementLedger } from "../marketplace/services/SettlementLedger.js";
import { ModelPricingService } from "../services/ModelPricingService.js";
import { SpendLedgerService } from "../services/SpendLedgerService.js";
import { makeTestDb } from "./helpers.js";

describe("money-correctness", () => {
  let wallet: WalletService;
  let sellers: SellerService;
  let pricing: MarketPricingService;
  let earnings: SellerEarningsLedger;
  let ledger: SpendLedgerService;
  let settlementLedger: SettlementLedger;
  let modelPricing: ModelPricingService;
  let hook: ReturnType<typeof createSettlementHook>;

  beforeEach(() => {
    const db = makeTestDb();
    wallet = new WalletService(db);
    sellers = new SellerService();
    pricing = new MarketPricingService(); // markup 0.15
    earnings = new SellerEarningsLedger(db);
    ledger = new SpendLedgerService();
    settlementLedger = new SettlementLedger(db, wallet, earnings, ledger);
    modelPricing = new ModelPricingService();
    hook = createSettlementHook({
      spendLedgerService: ledger,
      walletService: wallet,
      sellerService: sellers,
      marketPricingService: pricing,
      sellerEarningsLedger: earnings,
      settlementLedger,
      modelPricingService: modelPricing
    });
  });

  function paygReq(walletResId: string, dayResId: string, routed: unknown): FastifyRequest {
    return {
      routed,
      payg: { id: `${walletResId}|${dayResId}`, reason: "month_overage" },
      buyerKeyId: "k1",
      auth: { apiKeyHash: "h1" },
      headers: {}
    } as unknown as FastifyRequest;
  }

  // ── 1. conservation ────────────────────────────────────────────────────────
  it("fully funded settle: credit + margin are the cost split, conservation holds", () => {
    const hoang = sellers.register({ displayName: "hoang", commissionPct: 0.08 });
    sellers.approve(hoang.id);
    wallet.topupUsd("k1", 5);
    const wr = wallet.reserveUsd({ keyId: "k1", estimateUsd: 0.5 });
    const dr = ledger.reserve({ scope: "wallet:k1:payg", estimateUsd: 0.5, dayCap: 10 });
    const cost = { inputPerM: 2.1, outputPerM: 6.3 };
    const routed = { baseModel: "gpt-5.5", sellerId: hoang.id, accountId: "a1", costPrice: cost, sellRates: pricing.sellPriceFor("gpt-5.5", cost) };
    const req = paygReq(wr.ok ? wr.reservationId : "", dr.ok ? dr.reservationId : "", routed);

    hook({ request: req, outcome: "success", model: "gpt-5.5", promptTokens: 1000, completionTokens: 500 });

    const s = req.settlement!;
    // collected = sellerCredit + platformMargin (conservation)
    const collected = s.sellerCredit + s.platformMargin;
    expect(s.sellerCredit).toBeCloseTo(0.00525 * 0.92, 6);
    expect(collected).toBeCloseTo(0.00525 * 1.15, 5); // full sell collected
    expect(settlementLedger.reconcilePlatform().ok).toBe(true);
  });

  it("underfunded settle floors the wallet: seller credit <= collected, margin absorbs shortfall", () => {
    const hoang = sellers.register({ displayName: "hoang", commissionPct: 0 });
    sellers.approve(hoang.id);
    // Tiny wallet: $0.002, reserve all of it, actual sell cost will exceed it.
    wallet.topupUsd("k1", 0.002);
    const wr = wallet.reserveUsd({ keyId: "k1", estimateUsd: 0.002 });
    const dr = ledger.reserve({ scope: "wallet:k1:payg", estimateUsd: 0.002, dayCap: 10 });
    const cost = { inputPerM: 2.1, outputPerM: 6.3 };
    const routed = { baseModel: "gpt-5.5", sellerId: hoang.id, accountId: "a1", costPrice: cost, sellRates: pricing.sellPriceFor("gpt-5.5", cost) };
    const req = paygReq(wr.ok ? wr.reservationId : "", dr.ok ? dr.reservationId : "", routed);

    // 1000in/500out → sell ≈ $0.0060375, far above the $0.002 wallet.
    hook({ request: req, outcome: "success", model: "gpt-5.5", promptTokens: 1000, completionTokens: 500 });

    const s = req.settlement!;
    const collected = s.sellerCredit + s.platformMargin;
    expect(collected).toBeCloseTo(0.002, 6); // only what the wallet held
    expect(s.sellerCredit).toBeLessThanOrEqual(collected + 1e-9);
    expect(s.platformMargin).toBeGreaterThanOrEqual(-1e-9);
    expect(wallet.getUsd("k1")).toBe(0); // floored
    expect(settlementLedger.reconcilePlatform().solvent).toBe(true);
  });

  // ── 2. no free unlisted route ────────────────────────────────────────────────
  it("metered request with routed unset charges a fallback cost (not $0)", () => {
    wallet.topupUsd("k1", 5);
    const wr = wallet.reserveUsd({ keyId: "k1", estimateUsd: 0.5 });
    const dr = ledger.reserve({ scope: "wallet:k1:payg", estimateUsd: 0.5, dayCap: 10 });
    // routed unset → fallback to engine model price (gpt-4o is in defaults).
    const req = paygReq(wr.ok ? wr.reservationId : "", dr.ok ? dr.reservationId : "", undefined);

    hook({ request: req, outcome: "success", model: "gpt-4o", promptTokens: 1000, completionTokens: 500 });

    const s = req.settlement!;
    expect(s.actualSellCost).toBeGreaterThan(0); // NOT free
    // gpt-4o base 2.5/10 → 1000in/500out = 0.0025 + 0.005 = 0.0075 × 1.15 markup
    expect(s.actualSellCost).toBeCloseTo(0.0075 * 1.15, 6);
    expect(wallet.getUsd("k1")).toBeCloseTo(5 - s.actualSellCost, 5);
  });

  it("non-metered request (no reservation) is a no-op", () => {
    const req = { headers: {}, auth: { apiKeyHash: "h1" } } as unknown as FastifyRequest;
    hook({ request: req, outcome: "success", model: "gpt-4o", promptTokens: 1000, completionTokens: 500 });
    expect(req.settlement).toBeUndefined();
  });

  // ── 3. refund / reversal primitives ──────────────────────────────────────────
  it("refundUsd credits the wallet and logs the movement", () => {
    wallet.topupUsd("k1", 1);
    const newBal = wallet.refundUsd("k1", 2, "goodwill");
    expect(newBal).toBeCloseTo(3, 6);
    const log = wallet.ledgerFor("k1");
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ deltaUsd: 2, kind: "refund", reason: "goodwill" });
  });

  it("reversePayout restores a seller's unpaid", () => {
    const hoang = sellers.register({ displayName: "hoang" });
    sellers.approve(hoang.id);
    earnings.credit(hoang.id, 10);
    earnings.markPaid(hoang.id, 10);
    expect(earnings.snapshot(hoang.id).unpaid).toBe(0);
    earnings.reversePayout(hoang.id, 10, "bank_failed");
    expect(earnings.snapshot(hoang.id).unpaid).toBe(10);
  });

  it("reverseSettlement unwinds buyer refund + seller credit + margin, idempotently", () => {
    const hoang = sellers.register({ displayName: "hoang", commissionPct: 0 });
    sellers.approve(hoang.id);
    wallet.topupUsd("k1", 5);
    const wr = wallet.reserveUsd({ keyId: "k1", estimateUsd: 0.5 });
    const dr = ledger.reserve({ scope: "wallet:k1:payg", estimateUsd: 0.5, dayCap: 10 });
    const cost = { inputPerM: 2.1, outputPerM: 6.3 };
    const routed = { baseModel: "gpt-5.5", sellerId: hoang.id, accountId: "a1", costPrice: cost, sellRates: pricing.sellPriceFor("gpt-5.5", cost) };
    const req = paygReq(wr.ok ? wr.reservationId : "", dr.ok ? dr.reservationId : "", routed);
    hook({ request: req, outcome: "success", model: "gpt-5.5", promptTokens: 1000, completionTokens: 500 });

    const balAfterSettle = wallet.getUsd("k1");
    const collected = req.settlement!.sellerCredit + req.settlement!.platformMargin;
    const unpaidAfter = earnings.snapshot(hoang.id).unpaid;
    expect(unpaidAfter).toBeGreaterThan(0);

    // Find the logged settlement id via reconciliation read (one row).
    const id = (settlementLedger as unknown as { db: { prepare: (s: string) => { get: () => { id: string } } } })
      .db.prepare("SELECT id FROM settlement_log LIMIT 1").get().id;

    expect(settlementLedger.reverseSettlement(id, "test")).toBe(true);
    expect(wallet.getUsd("k1")).toBeCloseTo(balAfterSettle + collected, 6); // buyer refunded
    expect(earnings.snapshot(hoang.id).unpaid).toBeCloseTo(unpaidAfter - req.settlement!.sellerCredit, 6);
    // idempotent
    expect(settlementLedger.reverseSettlement(id, "test")).toBe(false);
  });

  // ── 4. solvency reconciliation ───────────────────────────────────────────────
  it("reconcileSeller matches the live unpaid after credits, a payout, and a reversal", () => {
    const hoang = sellers.register({ displayName: "hoang", commissionPct: 0 });
    sellers.approve(hoang.id);
    wallet.topupUsd("k1", 50);
    // two settled requests
    for (let i = 0; i < 2; i++) {
      const wr = wallet.reserveUsd({ keyId: "k1", estimateUsd: 1 });
      const dr = ledger.reserve({ scope: "wallet:k1:payg", estimateUsd: 1, dayCap: 100 });
      const cost = { inputPerM: 2.1, outputPerM: 6.3 };
      const routed = { baseModel: "gpt-5.5", sellerId: hoang.id, accountId: "a1", costPrice: cost, sellRates: pricing.sellPriceFor("gpt-5.5", cost) };
      const req = paygReq(wr.ok ? wr.reservationId : "", dr.ok ? dr.reservationId : "", routed);
      hook({ request: req, outcome: "success", model: "gpt-5.5", promptTokens: 1000, completionTokens: 500 });
    }
    earnings.markPaid(hoang.id, 0.001);
    const rec = settlementLedger.reconcileSeller(hoang.id);
    expect(rec.ok).toBe(true);
    expect(rec.expectedUnpaid).toBeCloseTo(rec.actualUnpaid, 6);
  });

  it("platform reconciliation: total collected >= total seller credit, margin matches", () => {
    const hoang = sellers.register({ displayName: "hoang", commissionPct: 0.1 });
    sellers.approve(hoang.id);
    wallet.topupUsd("k1", 50);
    const wr = wallet.reserveUsd({ keyId: "k1", estimateUsd: 1 });
    const dr = ledger.reserve({ scope: "wallet:k1:payg", estimateUsd: 1, dayCap: 100 });
    const cost = { inputPerM: 2.1, outputPerM: 6.3 };
    const routed = { baseModel: "gpt-5.5", sellerId: hoang.id, accountId: "a1", costPrice: cost, sellRates: pricing.sellPriceFor("gpt-5.5", cost) };
    const req = paygReq(wr.ok ? wr.reservationId : "", dr.ok ? dr.reservationId : "", routed);
    hook({ request: req, outcome: "success", model: "gpt-5.5", promptTokens: 1000, completionTokens: 500 });

    const rec = settlementLedger.reconcilePlatform();
    expect(rec.solvent).toBe(true);
    expect(rec.marginMatches).toBe(true);
    expect(rec.ok).toBe(true);
  });

  it("house request: full collected is platform margin, no seller credit", () => {
    wallet.topupUsd("k1", 5);
    const wr = wallet.reserveUsd({ keyId: "k1", estimateUsd: 0.5 });
    const dr = ledger.reserve({ scope: "wallet:k1:payg", estimateUsd: 0.5, dayCap: 10 });
    const cost = { inputPerM: 2, outputPerM: 6 };
    const routed = { baseModel: "gpt-5.5", sellerId: HOUSE_SELLER_ID, accountId: "ah", costPrice: cost, sellRates: pricing.sellPriceFor("gpt-5.5", cost) };
    const req = paygReq(wr.ok ? wr.reservationId : "", dr.ok ? dr.reservationId : "", routed);
    hook({ request: req, outcome: "success", model: "gpt-5.5", promptTokens: 1000, completionTokens: 500 });

    const s = req.settlement!;
    expect(s.sellerCredit).toBe(0);
    expect(s.platformMargin).toBeCloseTo(s.sellerCredit + s.platformMargin, 6);
    expect(settlementLedger.reconcilePlatform().ok).toBe(true);
  });
});
