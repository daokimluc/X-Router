import { describe, expect, it, beforeEach } from "vitest";
import type { FastifyRequest } from "fastify";
import { RealPaygDecision } from "../marketplace/services/RealPaygDecision.js";
import { createSettlementHook } from "../marketplace/policy/settlementHook.js";
import { WalletService } from "../marketplace/services/WalletService.js";
import { SellerService, HOUSE_SELLER_ID } from "../marketplace/services/SellerService.js";
import { MarketPricingService } from "../marketplace/services/MarketPricingService.js";
import { SellerEarningsLedger } from "../marketplace/services/SellerEarningsLedger.js";
import { SpendLedgerService } from "../services/SpendLedgerService.js";

describe("RealPaygDecision", () => {
  let wallet: WalletService;
  let ledger: SpendLedgerService;
  let payg: RealPaygDecision;

  beforeEach(() => {
    wallet = new WalletService();
    ledger = new SpendLedgerService();
    payg = new RealPaygDecision(wallet, ledger);
  });

  it("charges when wallet has funds within the daily limit", () => {
    wallet.topupUsd("k1", 5);
    const d = payg.decide({ keyId: "k1", reason: "month_overage", estimateUsd: 0.5, paygDailyLimitUsd: 2 });
    expect(d.charge).toBe(true);
    if (d.charge) expect(d.billTrack).toBe("payg");
    // wallet reserved the estimate
    expect(wallet.getUsd("k1")).toBeCloseTo(4.5, 6);
  });

  it("insufficient funds → no charge", () => {
    wallet.topupUsd("k1", 0.1);
    const d = payg.decide({ keyId: "k1", reason: "month_overage", estimateUsd: 0.5, paygDailyLimitUsd: null });
    expect(d.charge).toBe(false);
    if (!d.charge) expect(d.reason).toBe("insufficient_funds");
  });

  it("PAYG daily limit exceeded → 429 retry next day, wallet untouched", () => {
    wallet.topupUsd("k1", 100);
    // pre-spend the payg-daily bucket up to the cap
    ledger.reserve({ scope: "wallet:k1:payg", estimateUsd: 2, dayCap: 2 });
    const d = payg.decide({ keyId: "k1", reason: "month_overage", estimateUsd: 0.5, paygDailyLimitUsd: 2 });
    expect(d.charge).toBe(false);
    if (!d.charge) {
      expect(d.reason).toBe("payg_daily_limit");
      expect(d.retryAfterSeconds).toBeGreaterThan(0);
    }
    expect(wallet.getUsd("k1")).toBe(100); // not reserved
  });

  it("unprovisioned wallet → no charge", () => {
    const d = payg.decide({ keyId: "nowallet", reason: "boost", estimateUsd: 0.1, paygDailyLimitUsd: null });
    expect(d.charge).toBe(false);
  });
});

describe("settlement hook (two-sided)", () => {
  let wallet: WalletService;
  let sellers: SellerService;
  let pricing: MarketPricingService;
  let earnings: SellerEarningsLedger;
  let ledger: SpendLedgerService;
  let hook: ReturnType<typeof createSettlementHook>;

  beforeEach(() => {
    wallet = new WalletService();
    sellers = new SellerService();
    pricing = new MarketPricingService(); // markup 0.15
    earnings = new SellerEarningsLedger();
    ledger = new SpendLedgerService();
    hook = createSettlementHook({
      spendLedgerService: ledger,
      walletService: wallet,
      sellerService: sellers,
      marketPricingService: pricing,
      sellerEarningsLedger: earnings
    });
  });

  function reqWith(routed: unknown, planReservation?: unknown, payg?: unknown): FastifyRequest {
    return { routed, planReservation, payg, auth: { apiKeyHash: "h1" }, headers: {} } as unknown as FastifyRequest;
  }

  it("third-party plan request: settles plan bucket + credits seller cost−commission", () => {
    const hoang = sellers.register({ displayName: "hoang", commissionPct: 0.08 });
    sellers.approve(hoang.id);
    // cost in 2.10 out 6.30 → for 1000in/500out base = 0.0021+0.00315 = 0.00525
    const routed = { baseModel: "gpt-5.5", sellerId: hoang.id, accountId: "a1", costPrice: { inputPerM: 2.1, outputPerM: 6.3 }, sellRates: pricing.sellPriceFor("gpt-5.5", { inputPerM: 2.1, outputPerM: 6.3 }) };
    const planRes = ledger.reserve({ scope: "key:k1:grp:codex", estimateUsd: 0.02, monthCap: 100 });
    const req = reqWith(routed, planRes.ok ? { id: planRes.reservationId, scope: "key:k1:grp:codex" } : undefined);

    hook({ request: req, outcome: "success", model: "gpt-5.5", promptTokens: 1000, completionTokens: 500 });

    const credit = earnings.snapshot(hoang.id);
    // base 0.00525 × (1−0.08) = 0.00483
    expect(credit.lifetime).toBeCloseTo(0.00525 * 0.92, 6);
    expect(req.settlement?.sellerId).toBe(hoang.id);
    expect(req.settlement?.billTrack).toBe("plan");
    // wallet untouched
    expect(wallet.getUsd("k1")).toBe(0);
  });

  it("house request credits no seller; full sell is platform margin", () => {
    const routed = { baseModel: "gpt-5.5", sellerId: HOUSE_SELLER_ID, accountId: "ah", costPrice: { inputPerM: 2.3, outputPerM: 6.9 }, sellRates: pricing.sellPriceFor("gpt-5.5", { inputPerM: 2.3, outputPerM: 6.9 }) };
    const planRes = ledger.reserve({ scope: "key:k1:grp:codex", estimateUsd: 0.02, monthCap: 100 });
    const req = reqWith(routed, planRes.ok ? { id: planRes.reservationId, scope: "s" } : undefined);

    hook({ request: req, outcome: "success", model: "gpt-5.5", promptTokens: 1000, completionTokens: 500 });
    expect(req.settlement?.sellerCredit).toBe(0);
    expect(req.settlement?.platformMargin).toBeCloseTo(req.settlement!.actualSellCost, 6);
    expect(earnings.getPlatformMargin()).toBeGreaterThan(0);
  });

  it("payg request settles the wallet, credits seller", () => {
    const hoang = sellers.register({ displayName: "hoang", commissionPct: 0 });
    sellers.approve(hoang.id);
    wallet.topupUsd("k1", 5);
    const walletRes = wallet.reserveUsd({ keyId: "k1", estimateUsd: 0.5 });
    const dayRes = ledger.reserve({ scope: "wallet:k1:payg", estimateUsd: 0.5, dayCap: 10 });
    const routed = { baseModel: "gpt-5.5", sellerId: hoang.id, accountId: "a1", costPrice: { inputPerM: 2.1, outputPerM: 6.3 }, sellRates: pricing.sellPriceFor("gpt-5.5", { inputPerM: 2.1, outputPerM: 6.3 }) };
    const req = reqWith(routed, undefined, { id: `${walletRes.ok ? walletRes.reservationId : ""}|${dayRes.ok ? dayRes.reservationId : ""}`, reason: "month_overage" });

    hook({ request: req, outcome: "success", model: "gpt-5.5", promptTokens: 1000, completionTokens: 500 });
    expect(req.settlement?.billTrack).toBe("payg");
    // wallet: 5 − 0.5 reserve + refund(0.5 − actualSell) = 5 − actualSell
    const actualSell = req.settlement!.actualSellCost;
    expect(wallet.getUsd("k1")).toBeCloseTo(5 - actualSell, 5);
    expect(earnings.snapshot(hoang.id).lifetime).toBeGreaterThan(0);
  });

  it("failure releases plan reservation, credits nobody", () => {
    const hoang = sellers.register({ displayName: "hoang" });
    sellers.approve(hoang.id);
    const planRes = ledger.reserve({ scope: "key:k1:grp:codex", estimateUsd: 0.02, monthCap: 100 });
    const before = ledger.peek("key:k1:grp:codex")?.month ?? 0;
    expect(before).toBeCloseTo(0.02, 6);
    const routed = { baseModel: "gpt-5.5", sellerId: hoang.id, accountId: "a1", costPrice: { inputPerM: 2.1, outputPerM: 6.3 }, sellRates: { inputPerM: 1, outputPerM: 1 } };
    const req = reqWith(routed, planRes.ok ? { id: planRes.reservationId, scope: "s" } : undefined);

    hook({ request: req, outcome: "failure", model: "gpt-5.5", promptTokens: 0, completionTokens: 0 });
    expect(ledger.peek("key:k1:grp:codex")?.month ?? 0).toBe(0); // released
    expect(earnings.snapshot(hoang.id).lifetime).toBe(0);
  });

  it("emits wallet.low after a payg settle when balance drops below threshold", () => {
    const events: Array<{ event: string; data: Record<string, unknown> }> = [];
    const fakeWebhook = { notifyBusiness: async (event: string, data: Record<string, unknown>) => { events.push({ event, data }); } };
    const hook2 = createSettlementHook({
      spendLedgerService: ledger, walletService: wallet, sellerService: sellers,
      marketPricingService: pricing, sellerEarningsLedger: earnings,
      webhookService: fakeWebhook as never, walletLowWaterUsd: 1.0
    });
    const hoang = sellers.register({ displayName: "hoang", commissionPct: 0 });
    sellers.approve(hoang.id);
    wallet.topupUsd("k1", 0.5); // already below the $1 threshold
    const walletRes = wallet.reserveUsd({ keyId: "k1", estimateUsd: 0.1 });
    const dayRes = ledger.reserve({ scope: "wallet:k1:payg", estimateUsd: 0.1, dayCap: 10 });
    const routed = { baseModel: "gpt-5.5", sellerId: hoang.id, accountId: "a1", costPrice: { inputPerM: 2.1, outputPerM: 6.3 }, sellRates: pricing.sellPriceFor("gpt-5.5", { inputPerM: 2.1, outputPerM: 6.3 }) };
    const req = { routed, payg: { id: `${walletRes.ok ? walletRes.reservationId : ""}|${dayRes.ok ? dayRes.reservationId : ""}`, reason: "month_overage" }, buyerKeyId: "k1", auth: { apiKeyHash: "h1" }, headers: {} } as unknown as FastifyRequest;

    hook2({ request: req, outcome: "success", model: "gpt-5.5", promptTokens: 1000, completionTokens: 500 });
    const low = events.find((e) => e.event === "wallet.low");
    expect(low).toBeDefined();
    expect(low!.data.keyId).toBe("k1");
    expect(low!.data.thresholdUsd).toBe(1.0);
    // usage.recorded also emitted, carrying the real buyer key id + correlation hash
    const usage = events.find((e) => e.event === "usage.recorded");
    expect(usage).toBeDefined();
    expect(usage!.data.buyerKeyId).toBe("k1");
    expect(usage!.data.buyerKeyHash).toBe("h1");
    expect(usage!.data.baseModel).toBe("gpt-5.5");
    expect(usage!.data.sellerId).toBe(hoang.id);
  });
});
