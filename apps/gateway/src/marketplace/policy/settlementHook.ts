/**
 * Settlement hook — two-sided-settlement (#6).
 *
 * Registered on the engine's settlement seam; runs after each billable request.
 * It charges the buyer at the sell price (plan bucket OR wallet, by which
 * reservation enforce held) and credits the serving seller cost−commission. The
 * house seller is never credited; its full sell amount is platform margin.
 *
 * On success it settles; on failure it releases held reservations and credits
 * nobody. The settlement data object is stashed on the request for #7 to emit.
 */
import type { SettlementHook } from "../../services/MarketplaceSeam.js";
import type { SpendLedgerService } from "../../services/SpendLedgerService.js";
import type { ModelPricingService } from "../../services/ModelPricingService.js";
import type { WebhookService } from "../../services/WebhookService.js";
import type { WalletService } from "../services/WalletService.js";
import type { SellerService } from "../services/SellerService.js";
import type { MarketPricingService } from "../services/MarketPricingService.js";
import type { SellerEarningsLedger } from "../services/SellerEarningsLedger.js";
import type { SettlementLedger } from "../services/SettlementLedger.js";
import type { TokenGrantService } from "../services/TokenGrantService.js";
import type { CostPrice } from "../../account-pool/types.js";

const HOUSE_SELLER_ID = "house";

declare module "fastify" {
  interface FastifyRequest {
    /** Settlement result, produced here and emitted by provision-webhook (#7). */
    settlement?: {
      /** Stable, unique id of this settle (settlement_log row id). Idempotency key
       *  shared by the usage.recorded webhook AND /provision/{usage,settlements}. */
      settlementId: string;
      /** Buyer's API key id (the website's buyer handle). */
      buyerKeyId: string;
      /** Buyer's API key hash (audit/correlation). */
      buyerKeyHash: string;
      baseModel: string;
      sellerId: string;
      promptTokens: number;
      completionTokens: number;
      actualSellCost: number;
      sellerCredit: number;
      platformMargin: number;
      billTrack: "plan" | "payg" | "tokenpack";
    };
  }
}

export type SettlementDeps = {
  spendLedgerService: SpendLedgerService;
  walletService: WalletService;
  sellerService: SellerService;
  marketPricingService: MarketPricingService;
  sellerEarningsLedger: SellerEarningsLedger;
  /** money-correctness (#2) — durable settlement log + conservation invariant. */
  settlementLedger: SettlementLedger;
  /** money-correctness (#2) — fallback cost basis for an unlisted route. */
  modelPricingService: ModelPricingService;
  /** marketplace-token-packs — decrement the pack on the tokenpack track. Optional. */
  tokenGrantService?: TokenGrantService;
  /** provision-webhook (#7) — emit usage.recorded after settlement. Optional. */
  webhookService?: WebhookService;
  /** provision-webhook (#7) — wallet.low threshold in USD (default 1.00). */
  walletLowWaterUsd?: number;
};

export function createSettlementHook(deps: SettlementDeps): SettlementHook {
  return function settle(ctx) {
    const { request } = ctx;
    const planRes = request.planReservation;
    const payg = request.payg;
    const tokenPack = request.tokenPack;
    const routed = request.routed;

    // Nothing marketplace-related to settle (plan-less, non-marketplace request).
    if (!planRes && !payg && !tokenPack) return;

    if (ctx.outcome === "failure") {
      // Release whatever was held; no seller credit.
      if (planRes) deps.spendLedgerService.release(planRes.id);
      if (payg) {
        const [walletRes, dayRes] = payg.id.split("|");
        if (walletRes) deps.walletService.releaseUsd(walletRes);
        if (dayRes) deps.spendLedgerService.release(dayRes);
      }
      if (tokenPack) deps.tokenGrantService?.release(tokenPack.id);
      // provision-webhook (#7) — supply.unhealthy: a request routed to a
      // non-house seller failed terminally. Best-effort signal to the website.
      if (deps.webhookService && routed && routed.sellerId !== HOUSE_SELLER_ID) {
        void deps.webhookService.notifyBusiness("supply.unhealthy", {
          sellerId: routed.sellerId,
          providerAccountId: routed.accountId,
          reason: "request_failed"
        });
      }
      request.planReservation = undefined;
      request.payg = undefined;
      request.tokenPack = undefined;
      return;
    }

    // ── success ───────────────────────────────────────────────────────────────
    // money-correctness (#2): settle the BUYER side first to learn what was
    // actually collected (a wallet can floor at zero), THEN derive seller credit
    // + platform margin from the collected amount so the books always conserve:
    //   collected === sellerCredit + platformMargin.
    const billTrack: "plan" | "payg" | "tokenpack" = tokenPack ? "tokenpack" : payg ? "payg" : "plan";
    const sellerId = routed?.sellerId ?? HOUSE_SELLER_ID;
    const baseModel = routed?.baseModel ?? ctx.model;

    // Sell cost + base (wholesale) cost. With a routed listing, from its rates;
    // without one (unlisted leased account) fall back to the house listing cost
    // for the base model, else the engine model price — NEVER $0 for a metered
    // request. The buyer is always charged; only the seller-credit basis differs.
    let actualSellCost: number;
    let actualBaseCost: number;
    if (routed) {
      actualSellCost = deps.marketPricingService.sellCostForRequest(
        routed.baseModel, routed.costPrice, ctx.promptTokens, ctx.completionTokens, ctx.cachedTokens ?? 0
      );
      actualBaseCost = deps.marketPricingService.baseCostForRequest(
        routed.costPrice, ctx.promptTokens, ctx.completionTokens, ctx.cachedTokens ?? 0
      );
    } else {
      const fallbackCost = fallbackCostPrice(deps, baseModel);
      actualBaseCost = deps.marketPricingService.baseCostForRequest(
        fallbackCost, ctx.promptTokens, ctx.completionTokens, ctx.cachedTokens ?? 0
      );
      actualSellCost = deps.marketPricingService.sellCostForRequest(
        baseModel, fallbackCost, ctx.promptTokens, ctx.completionTokens, ctx.cachedTokens ?? 0
      );
      request.log?.warn(
        { model: baseModel, sellCost: actualSellCost },
        "unlisted supply served metered request — settled at fallback cost"
      );
    }

    // Settle the buyer side against the track chosen at reserve; capture collected.
    let collected = 0;
    const planScope = planRes?.scope ?? null;
    if (billTrack === "plan" && planRes) {
      collected = deps.spendLedgerService.settle(planRes.id, actualSellCost);
      // provision-webhook (#7) — grant.exhausted on the exhaustion transition.
      if (deps.webhookService && planRes.monthUsd && planRes.monthUsd > 0) {
        const snap = deps.spendLedgerService.snapshot(planRes.scope, null, planRes.monthUsd);
        const after = snap.month.spent;
        const before = after - actualSellCost;
        if (after >= planRes.monthUsd && before < planRes.monthUsd) {
          void deps.webhookService.notifyBusiness("grant.exhausted", {
            keyId: request.buyerKeyId ?? "",
            planId: planRes.planId ?? null,
            group: planRes.group ?? null,
            monthUsd: planRes.monthUsd
          });
        }
      }
    } else if (billTrack === "payg" && payg) {
      const [walletRes, dayRes] = payg.id.split("|");
      // The wallet is the real money; its settle return is what was collected.
      if (walletRes) collected = deps.walletService.settleUsd(walletRes, actualSellCost);
      if (dayRes) deps.spendLedgerService.settle(dayRes, actualSellCost);
      // provision-webhook (#7) — wallet.low after settle (best-effort).
      const keyId = request.buyerKeyId;
      if (deps.webhookService && keyId) {
        const threshold = deps.walletLowWaterUsd ?? 1.0;
        const balanceUsd = deps.walletService.getUsd(keyId);
        if (deps.walletService.isProvisioned(keyId) && balanceUsd < threshold) {
          void deps.webhookService.notifyBusiness("wallet.low", { keyId, balanceUsd, thresholdUsd: threshold });
        }
      }
    } else if (billTrack === "tokenpack" && tokenPack) {
      // Decrement the pack by the ACTUAL combined tokens (no buyer money moved).
      // `collected` is the supply value consumed — it drives seller credit + the
      // books, taking zero net platform margin on packs (the buyer paid Foza up
      // front), while preserving collected === sellerCredit + platformMargin.
      deps.tokenGrantService?.settle(tokenPack.id, ctx.promptTokens + ctx.completionTokens);
      collected = actualSellCost;
    }

    // Derive credit + margin from COLLECTED (not intended): margin absorbs any
    // shortfall before the seller is shorted; the seller is never over-credited.
    let sellerCredit = 0;
    if (sellerId !== HOUSE_SELLER_ID) {
      const commissionPct = deps.sellerService.getSeller(sellerId)?.commissionPct ?? 0;
      const intendedCredit = actualBaseCost * (1 - commissionPct);
      sellerCredit = Math.min(intendedCredit, collected);
      if (sellerCredit > 0) deps.sellerEarningsLedger.credit(sellerId, sellerCredit);
    }
    const platformMargin = collected - sellerCredit;
    if (platformMargin !== 0) deps.sellerEarningsLedger.recordPlatformMargin(platformMargin);

    // Durable, auditable settlement row (enables reversal + reconciliation).
    // The returned id is the stable idempotency key surfaced to the website.
    const settlementId = deps.settlementLedger.record({
      buyerKeyId: request.buyerKeyId ?? "",
      baseModel,
      sellerId,
      promptTokens: ctx.promptTokens,
      completionTokens: ctx.completionTokens,
      collected,
      sellerCredit,
      platformMargin,
      billTrack,
      planScope,
      requestId: request.id
    });

    request.settlement = {
      settlementId,
      buyerKeyId: request.buyerKeyId ?? "",
      buyerKeyHash: request.auth?.apiKeyHash ?? "",
      baseModel,
      sellerId,
      promptTokens: ctx.promptTokens,
      completionTokens: ctx.completionTokens,
      actualSellCost,
      sellerCredit,
      platformMargin,
      billTrack
    };

    // provision-webhook (#7) — emit the settlement as usage.recorded (best-effort).
    if (deps.webhookService) {
      void deps.webhookService.notifyBusiness("usage.recorded", { ...request.settlement });
    }

    request.planReservation = undefined;
    request.payg = undefined;
    request.tokenPack = undefined;
  };
}

/**
 * Fallback wholesale cost for an unlisted route (money-correctness #2): the
 * house listing's cost for the base model if one exists, else the engine model
 * price. Never returns zero rates so a metered request is never served free.
 */
function fallbackCostPrice(deps: SettlementDeps, baseModel: string): CostPrice {
  const houseListing = deps.sellerService
    .listingCostFor(baseModel)
    .find((c) => c.sellerId === HOUSE_SELLER_ID);
  if (houseListing) return houseListing.costPrice;

  const pricing = deps.modelPricingService.get(baseModel);
  if (pricing) {
    const cost: CostPrice = { inputPerM: pricing.inputRate, outputPerM: pricing.outputRate };
    if (pricing.cachedInputRate !== undefined) cost.cachedInputPerM = pricing.cachedInputRate;
    return cost;
  }
  // No price anywhere — a conservative non-zero floor so the buyer is still
  // charged something and operators see it in the warn log.
  return { inputPerM: 0, outputPerM: 0 };
}
