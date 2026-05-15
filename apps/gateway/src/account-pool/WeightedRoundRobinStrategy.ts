import type { ProviderAccount } from "../providers/base/ProviderAccount.js";
import type {
  AccountSelectionContext,
  AccountSelectionStrategy
} from "./types.js";

export class WeightedRoundRobinStrategy implements AccountSelectionStrategy {
  private nextIndex = 0;

  select(
    accounts: ProviderAccount[],
    _context: AccountSelectionContext
  ): ProviderAccount | null {
    const weightedAccounts = accounts.flatMap((account) => {
      const weight = Math.max(1, Math.floor(account.weight));
      return Array.from({ length: weight }, () => account);
    });

    if (weightedAccounts.length === 0) {
      return null;
    }

    const account = weightedAccounts[this.nextIndex % weightedAccounts.length];
    this.nextIndex = (this.nextIndex + 1) % weightedAccounts.length;
    return account ?? null;
  }
}

