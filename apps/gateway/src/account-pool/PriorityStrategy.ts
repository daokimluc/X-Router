import type { ProviderAccount } from "../providers/base/ProviderAccount.js";
import type { AccountSelectionContext, AccountSelectionStrategy } from "./types.js";

export class PriorityStrategy implements AccountSelectionStrategy {
  private readonly maxConsecutiveFailures: number;

  constructor(maxConsecutiveFailures = 3) {
    this.maxConsecutiveFailures = maxConsecutiveFailures;
  }

  select(
    accounts: ProviderAccount[],
    _context: AccountSelectionContext
  ): ProviderAccount | null {
    if (accounts.length === 0) return null;

    const sorted = [...accounts].sort(
      (a, b) => (a.priority ?? 100) - (b.priority ?? 100)
    );

    for (const account of sorted) {
      if (account.runtime.consecutiveFailures < this.maxConsecutiveFailures) {
        return account;
      }
    }

    return sorted[0] ?? null;
  }
}
