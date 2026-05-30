/**
 * MarketPricingService — lowest-cost-routing (#5).
 *
 * Derives the buyer SELL price from a routed candidate's wholesale COST:
 *   sellRate = costRate × (1 + markup(baseModel))
 * markup is per-base-model with a global default (0.15). The same sell price is
 * used for plan metering, boost, and overage (one price, decided in discovery).
 *
 * Seller earnings / commission are NOT here — that's two-sided-settlement (#6).
 */
import type { CostPrice } from "../../account-pool/types.js";

export const DEFAULT_MARKUP = 0.15;

export type PersistedMarketPricing = {
  defaultMarkup: number;
  perModelMarkup: Record<string, number>;
};

export class MarketPricingService {
  private defaultMarkup = DEFAULT_MARKUP;
  private readonly perModelMarkup = new Map<string, number>();
  private onPersist?: () => void;

  setPersistCallback(cb: () => void): void {
    this.onPersist = cb;
  }

  /** Effective markup for a base model: per-model override, else global default. */
  markupFor(baseModel: string): number {
    return this.perModelMarkup.get(baseModel) ?? this.defaultMarkup;
  }

  getDefaultMarkup(): number {
    return this.defaultMarkup;
  }

  setDefaultMarkup(markup: number): void {
    if (markup < 0) throw new Error("markup must be >= 0");
    this.defaultMarkup = markup;
    this.onPersist?.();
  }

  setModelMarkup(baseModel: string, markup: number | null): void {
    if (markup !== null && markup < 0) throw new Error("markup must be >= 0");
    if (markup === null) this.perModelMarkup.delete(baseModel);
    else this.perModelMarkup.set(baseModel, markup);
    this.onPersist?.();
  }

  listMarkups(): { defaultMarkup: number; perModel: Record<string, number> } {
    return { defaultMarkup: this.defaultMarkup, perModel: Object.fromEntries(this.perModelMarkup) };
  }

  /** Sell rates = cost rates × (1 + markup). */
  sellPriceFor(baseModel: string, cost: CostPrice): CostPrice {
    const m = 1 + this.markupFor(baseModel);
    const sell: CostPrice = {
      inputPerM: cost.inputPerM * m,
      outputPerM: cost.outputPerM * m
    };
    if (cost.cachedInputPerM !== undefined) sell.cachedInputPerM = cost.cachedInputPerM * m;
    return sell;
  }

  /** USD sell cost for a request, from per-1M sell rates and token counts. */
  sellCostForRequest(
    baseModel: string,
    cost: CostPrice,
    promptTokens: number,
    completionTokens: number,
    cachedTokens = 0
  ): number {
    const sell = this.sellPriceFor(baseModel, cost);
    return rateCostForRequest(sell, promptTokens, completionTokens, cachedTokens);
  }

  /**
   * USD base (wholesale) cost for a request, from the seller's per-1M COST rates
   * and token counts. The seller credit is derived from this (× (1−commission)).
   */
  baseCostForRequest(
    cost: CostPrice,
    promptTokens: number,
    completionTokens: number,
    cachedTokens = 0
  ): number {
    return rateCostForRequest(cost, promptTokens, completionTokens, cachedTokens);
  }

  toPersisted(): PersistedMarketPricing {
    return { defaultMarkup: this.defaultMarkup, perModelMarkup: Object.fromEntries(this.perModelMarkup) };
  }

  load(state: PersistedMarketPricing | undefined | null): void {
    if (!state) return;
    if (typeof state.defaultMarkup === "number" && state.defaultMarkup >= 0) {
      this.defaultMarkup = state.defaultMarkup;
    }
    this.perModelMarkup.clear();
    if (state.perModelMarkup) {
      for (const [k, v] of Object.entries(state.perModelMarkup)) {
        if (typeof v === "number" && v >= 0) this.perModelMarkup.set(k, v);
      }
    }
  }
}

/** USD cost for a request given per-1M rates and token counts. */
function rateCostForRequest(
  rate: CostPrice,
  promptTokens: number,
  completionTokens: number,
  cachedTokens: number
): number {
  const inputUncached = Math.max(0, promptTokens - cachedTokens);
  const inputCost = (inputUncached / 1_000_000) * rate.inputPerM;
  const cachedCost = (cachedTokens / 1_000_000) * (rate.cachedInputPerM ?? rate.inputPerM);
  const outputCost = (completionTokens / 1_000_000) * rate.outputPerM;
  return inputCost + cachedCost + outputCost;
}
