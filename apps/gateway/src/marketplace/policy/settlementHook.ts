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
import type { WebhookService } from "../../services/WebhookService.js";
import type { WalletService } from "../services/WalletService.js";
import type { SellerService } from "../services/SellerService.js";
import type { MarketPricingService } from "../services/MarketPricingService.js";
import type { SellerEarningsLedger } from "../services/SellerEarningsLedger.js";

const HOUSE_SELLER_ID = "house";

declare module "fastify" {
  interface FastifyRequest {
    /** Settlement result, produced here and emitted by provision-webhook (#7). */
    settlement?: {
      buyerKeyId: string;
      baseModel: string;
      sellerId: string;
      promptTokens: number;
      completionTokens: number;
      actualSellCost: number;
      sellerCredit: number;
      platformMargin: number;
      billTrack: "plan" | "payg";
    };
  }
}

export type SettlementDeps = {
  spendLedgerService: SpendLedgerService;
  walletService: WalletService;
  sellerService: SellerService;
  marketPricingService: MarketPricingService;
  sellerEarningsLedger: SellerEarningsLedger;
  /** provision-webhook (#7) — emit usage.recorded after settlement. Optional. */
  webhookService?: WebhookService;
};

export function createSettlementHook(deps: SettlementDeps): SettlementHook {
  return function settle(ctx) {
    const { request } = ctx;
    const planRes = request.planReservation;
    const payg = request.payg;
    const routed = request.routed;

    // Nothing marketplace-related to settle (plan-less, non-marketplace request).
    if (!planRes && !payg) return;

    if (ctx.outcome === "failure") {
      // Release whatever was held; no seller credit.
      if (planRes) deps.spendLedgerService.release(planRes.id);
      if (payg) {
        const [walletRes, dayRes] = payg.id.split("|");
        if (walletRes) deps.walletService.releaseUsd(walletRes);
        if (dayRes) deps.spendLedgerService.release(dayRes);
      }
      request.planReservation = undefined;
      request.payg = undefined;
      return;
    }

    // ── success: compute the actual sell cost from routed sell rates ──────────
    const billTrack: "plan" | "payg" = payg ? "payg" : "plan";

    // Without routed cost data (e.g. non-marketplace pool), settle the held
    // reservation at the engine model cost and skip seller credit.
    let actualSellCost: number;
    let sellerCredit = 0;
    const sellerId = routed?.sellerId ?? HOUSE_SELLER_ID;

    if (routed) {
      actualSellCost = deps.marketPricingService.sellCostForRequest(
        routed.baseModel,
        routed.costPrice,
        ctx.promptTokens,
        ctx.completionTokens,
        ctx.cachedTokens ?? 0
      );
      const actualBaseCost = deps.marketPricingService.baseCostForRequest(
        routed.costPrice,
        ctx.promptTokens,
        ctx.completionTokens,
        ctx.cachedTokens ?? 0
      );
      if (sellerId !== HOUSE_SELLER_ID) {
        const commissionPct = deps.sellerService.getSeller(sellerId)?.commissionPct ?? 0;
        sellerCredit = actualBaseCost * (1 - commissionPct);
        deps.sellerEarningsLedger.credit(sellerId, sellerCredit);
      }
    } else {
      // Fallback: no routed cost → use the reserved estimate as the sell cost.
      actualSellCost = 0;
    }

    // Settle the buyer side against the track chosen at reserve.
    if (billTrack === "plan" && planRes) {
      deps.spendLedgerService.settle(planRes.id, actualSellCost);
    } else if (billTrack === "payg" && payg) {
      const [walletRes, dayRes] = payg.id.split("|");
      if (walletRes) deps.walletService.settleUsd(walletRes, actualSellCost);
      if (dayRes) deps.spendLedgerService.settle(dayRes, actualSellCost);
    }

    const platformMargin = actualSellCost - sellerCredit;
    deps.sellerEarningsLedger.recordPlatformMargin(platformMargin);

    request.settlement = {
      buyerKeyId: request.auth?.apiKeyHash ?? "",
      baseModel: routed?.baseModel ?? ctx.model,
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
  };
}
