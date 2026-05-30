import type { ProviderAccount } from "../providers/base/ProviderAccount.js";

/** USD cost per 1M tokens for a routable candidate (lowest-cost-routing #5). */
export type CostPrice = {
  inputPerM: number;
  outputPerM: number;
  cachedInputPerM?: number;
};

export type AccountSelectionContext = {
  model?: string;
  now: Date;
  quotaFilter?: (accountId: string) => boolean;
  /**
   * lowest-cost-routing (#5) — optional per-account cost lookup. Injected by the
   * marketplace layer from seller listings; the engine strategy stays agnostic
   * (just sorts on the returned cost). Null = candidate has no known cost.
   */
  costFor?: (accountId: string) => CostPrice | null;
};

export type AccountSelectionStrategy = {
  select(
    accounts: ProviderAccount[],
    context: AccountSelectionContext
  ): ProviderAccount | null;
};

export type AccountPoolLease = {
  account: ProviderAccount;
  releaseSuccess(): void;
  releaseFailure(error: string): void;
};

