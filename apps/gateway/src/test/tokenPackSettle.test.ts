import { describe, expect, it, beforeEach } from "vitest";
import type { FastifyRequest } from "fastify";
import { createSettlementHook } from "../marketplace/policy/settlementHook.js";
import { WalletService } from "../marketplace/services/WalletService.js";
import { SellerService, HOUSE_SELLER_ID } from "../marketplace/services/SellerService.js";
import { MarketPricingService } from "../marketplace/services/MarketPricingService.js";
import { SellerEarningsLedger } from "../marketplace/services/SellerEarningsLedger.js";
import { SettlementLedger } from "../marketplace/services/SettlementLedger.js";
import { TokenGrantService } from "../marketplace/services/TokenGrantService.js";
import { ModelPricingService } from "../services/ModelPricingService.js";
import { SpendLedgerService } from "../services/SpendLedgerService.js";
import { makeTestDb } from "./helpers.js";

describe("settlement hook — tokenpack track", () => {
  let wallet: WalletService;
  let sellers: SellerService;
  let pricing: MarketPricingService;
  let earnings: SellerEarningsLedger;
  let ledger: SpendLedgerService;
  let settlementLedger: SettlementLedger;
  let modelPricing: ModelPricingService;
  let tokenGrants: TokenGrantService;
  let hook: ReturnType<typeof createSettlementHook>;

  beforeEach(() => {
    const db = makeTestDb();
    wallet = new WalletService(db);
    sellers = new SellerService();
    pricing = new MarketPricingService();
    earnings = new SellerEarningsLedger(db);
    ledger = new SpendLedgerService();
    settlementLedger = new SettlementLedger(db, wallet, earnings, ledger);
    modelPricing = new ModelPricingService();
    tokenGrants = new TokenGrantService(db);
    hook = createSettlementHook({
      spendLedgerService: ledger,
      walletService: wallet,
      sellerService: sellers,
      marketPricingService: pricing,
      sellerEarningsLedger: earnings,
      settlementLedger,
      modelPricingService: modelPricing,
      tokenGrantService: tokenGrants
    });
  });

  function packReq(routed: unknown, reservationId: string, grantId: string): FastifyRequest {
    return {
      routed, buyerKeyId: "k1", auth: { apiKeyHash: "h1" }, headers: {},
      tokenPack: { id: reservationId, grantId, baseModel: "gpt-5.5" }
    } as unknown as FastifyRequest;
  }

  it("decrements the pack by actual combined tokens; wallet untouched; seller credited; bill_track tokenpack", () => {
    const hoang = sellers.register({ displayName: "hoang", commissionPct: 0.1 });
    sellers.approve(hoang.id);
    const g = tokenGrants.grant({ keyId: "k1", baseModel: "gpt-5.5", tokens: 100_000, pricePaidUsd: 5, expiresAt: Date.now() + 1e9, idempotencyKey: "p1" });
    const r = tokenGrants.reserve({ grantId: g.id, estTokens: 2000 });
    expect(r.ok).toBe(true);
    const routed = { baseModel: "gpt-5.5", sellerId: hoang.id, accountId: "a1", costPrice: { inputPerM: 2.1, outputPerM: 6.3 }, sellRates: pricing.sellPriceFor("gpt-5.5", { inputPerM: 2.1, outputPerM: 6.3 }) };
    const req = packReq(routed, r.ok ? r.reservationId : "", g.id);

    hook({ request: req, outcome: "success", model: "gpt-5.5", promptTokens: 1000, completionTokens: 500 });

    // pack: reserved 2000, actual 1500 → remaining 100000 − 1500
    expect(tokenGrants.findUsable("k1", "gpt-5.5")?.tokensRemaining).toBe(98_500);
    expect(req.settlement?.billTrack).toBe("tokenpack");
    // wallet not touched (buyer paid Foza)
    expect(wallet.getUsd("k1")).toBe(0);
    // seller credited for supply consumed
    expect(earnings.snapshot(hoang.id).lifetime).toBeGreaterThan(0);
  });

  it("conservation holds: collected == sellerCredit + platformMargin", () => {
    const hoang = sellers.register({ displayName: "h", commissionPct: 0.2 });
    sellers.approve(hoang.id);
    const g = tokenGrants.grant({ keyId: "k1", baseModel: "gpt-5.5", tokens: 50_000, pricePaidUsd: 2, expiresAt: Date.now() + 1e9, idempotencyKey: "p2" });
    const r = tokenGrants.reserve({ grantId: g.id, estTokens: 3000 });
    const routed = { baseModel: "gpt-5.5", sellerId: hoang.id, accountId: "a1", costPrice: { inputPerM: 3, outputPerM: 9 }, sellRates: pricing.sellPriceFor("gpt-5.5", { inputPerM: 3, outputPerM: 9 }) };
    const req = packReq(routed, r.ok ? r.reservationId : "", g.id);

    hook({ request: req, outcome: "success", model: "gpt-5.5", promptTokens: 1200, completionTokens: 800 });
    const s = req.settlement!;
    expect(s.actualSellCost).toBeCloseTo(s.sellerCredit + s.platformMargin, 6);
  });

  it("house pack request credits no seller; full supply value is platform margin", () => {
    const g = tokenGrants.grant({ keyId: "k1", baseModel: "gpt-5.5", tokens: 50_000, pricePaidUsd: 2, expiresAt: Date.now() + 1e9, idempotencyKey: "p3" });
    const r = tokenGrants.reserve({ grantId: g.id, estTokens: 2000 });
    const routed = { baseModel: "gpt-5.5", sellerId: HOUSE_SELLER_ID, accountId: "ah", costPrice: { inputPerM: 2, outputPerM: 6 }, sellRates: pricing.sellPriceFor("gpt-5.5", { inputPerM: 2, outputPerM: 6 }) };
    const req = packReq(routed, r.ok ? r.reservationId : "", g.id);

    hook({ request: req, outcome: "success", model: "gpt-5.5", promptTokens: 1000, completionTokens: 500 });
    expect(req.settlement?.sellerCredit).toBe(0);
    expect(req.settlement?.platformMargin).toBeCloseTo(req.settlement!.actualSellCost, 6);
  });

  it("failure releases the pack reservation — balance unchanged", () => {
    const g = tokenGrants.grant({ keyId: "k1", baseModel: "gpt-5.5", tokens: 10_000, pricePaidUsd: 1, expiresAt: Date.now() + 1e9, idempotencyKey: "p4" });
    const r = tokenGrants.reserve({ grantId: g.id, estTokens: 4000 });
    expect(tokenGrants.findUsable("k1", "gpt-5.5")?.tokensRemaining).toBe(6000); // reserved
    const routed = { baseModel: "gpt-5.5", sellerId: HOUSE_SELLER_ID, accountId: "ah", costPrice: { inputPerM: 2, outputPerM: 6 }, sellRates: pricing.sellPriceFor("gpt-5.5", { inputPerM: 2, outputPerM: 6 }) };
    const req = packReq(routed, r.ok ? r.reservationId : "", g.id);

    hook({ request: req, outcome: "failure", model: "gpt-5.5", promptTokens: 0, completionTokens: 0 });
    expect(tokenGrants.findUsable("k1", "gpt-5.5")?.tokensRemaining).toBe(10_000); // released
    expect(req.settlement).toBeUndefined();
  });
});
