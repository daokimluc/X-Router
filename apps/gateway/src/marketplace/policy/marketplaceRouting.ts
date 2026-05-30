/**
 * Marketplace routing helpers — lowest-cost-routing (#5).
 *
 * Bridges seller-supply's cost data into the engine's account selection and
 * captures the routed cost/sell rates for settlement (#6). The engine pool stays
 * agnostic: we hand it a `costFor` lookup and read back which account it picked.
 */
import type { CostPrice } from "../../account-pool/types.js";
import type { SellerService } from "../services/SellerService.js";
import type { MarketPricingService } from "../services/MarketPricingService.js";

declare module "fastify" {
  interface FastifyRequest {
    /**
     * Routed marketplace candidate captured at selection time, consumed by
     * two-sided-settlement (#6) to charge the buyer and credit the seller.
     */
    routed?: {
      baseModel: string;
      sellerId: string;
      accountId: string;
      costPrice: CostPrice;
      sellRates: CostPrice;
    };
  }
}

/**
 * Build a per-account cost lookup for a pooled base model from seller listings.
 * Returns null when there are no costed candidates (not marketplace supply).
 */
export function buildCostFor(
  sellerService: SellerService,
  baseModel: string
): ((accountId: string) => CostPrice | null) | null {
  const candidates = sellerService.listingCostFor(baseModel);
  if (candidates.length === 0) return null;
  const byAccount = new Map<string, CostPrice>();
  for (const c of candidates) byAccount.set(c.accountId, c.costPrice);
  return (accountId: string) => byAccount.get(accountId) ?? null;
}

/**
 * Compute the routed settlement context for an account that was selected for a
 * base model. Resolves the candidate's cost (from listings) and the derived
 * sell rates. Returns null if the account has no listing cost.
 */
export function routedContextFor(
  sellerService: SellerService,
  marketPricing: MarketPricingService,
  baseModel: string,
  accountId: string
): { baseModel: string; sellerId: string; accountId: string; costPrice: CostPrice; sellRates: CostPrice } | null {
  const candidate = sellerService.listingCostFor(baseModel).find((c) => c.accountId === accountId);
  if (!candidate) return null;
  return {
    baseModel,
    sellerId: candidate.sellerId,
    accountId,
    costPrice: candidate.costPrice,
    sellRates: marketPricing.sellPriceFor(baseModel, candidate.costPrice)
  };
}

/**
 * Routed context for the CHEAPEST listing of a base model — the candidate
 * lowest-cost routing will pick. Used to capture settlement cost data at
 * policy-check time (before pool acquire). Returns null if no listings exist.
 */
export function routedContextForCheapest(
  sellerService: SellerService,
  marketPricing: MarketPricingService,
  baseModel: string
): { baseModel: string; sellerId: string; accountId: string; costPrice: CostPrice; sellRates: CostPrice } | null {
  const candidates = sellerService.listingCostFor(baseModel);
  if (candidates.length === 0) return null;
  const cheapest = candidates.reduce((min, c) =>
    (c.costPrice.inputPerM + c.costPrice.outputPerM) < (min.costPrice.inputPerM + min.costPrice.outputPerM) ? c : min
  );
  return {
    baseModel,
    sellerId: cheapest.sellerId,
    accountId: cheapest.accountId,
    costPrice: cheapest.costPrice,
    sellRates: marketPricing.sellPriceFor(baseModel, cheapest.costPrice)
  };
}
