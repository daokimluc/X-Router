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

/** Minimal candidate shape the ranker needs (matches ResolvedModelCandidate). */
type RankableCandidate = { providerInstanceId: string };

/**
 * lowest-cost-routing-wiring — cheapest-seller-first candidate ranker.
 *
 * Each pooled candidate corresponds to one seller (distinct providerInstanceId).
 * Rank by the listing cost scalar (inputPerM + outputPerM) for the candidate's
 * instance; candidates with no listing cost keep their relative order and are
 * appended after all costed ones. Stable sort. House (true wholesale) naturally
 * sorts at or below any third-party, so it bounds the ceiling with no special case.
 */
export function createCandidateRanker(
  sellerService: SellerService
): <T extends RankableCandidate>(model: string, candidates: T[]) => T[] {
  return function rank<T extends RankableCandidate>(model: string, candidates: T[]): T[] {
    if (candidates.length < 2) return candidates;
    // instanceId → cost scalar, from the model's enabled listings.
    const scalar = new Map<string, number>();
    for (const c of sellerService.listingCostFor(model)) {
      scalar.set(c.providerInstanceId, c.costPrice.inputPerM + c.costPrice.outputPerM);
    }
    // Stable sort: decorate with original index; costed (asc) before uncosted.
    return candidates
      .map((c, i) => ({ c, i, s: scalar.get(c.providerInstanceId) }))
      .sort((a, b) => {
        const aHas = a.s !== undefined;
        const bHas = b.s !== undefined;
        if (aHas && bHas) return a.s! - b.s! || a.i - b.i;
        if (aHas) return -1; // costed before uncosted
        if (bHas) return 1;
        return a.i - b.i; // both uncosted → stable
      })
      .map((x) => x.c);
  };
}
