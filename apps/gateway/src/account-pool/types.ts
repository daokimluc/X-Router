import type { ProviderAccount } from "../providers/base/ProviderAccount.js";

export type AccountSelectionContext = {
  model?: string;
  now: Date;
  quotaFilter?: (accountId: string) => boolean;
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

