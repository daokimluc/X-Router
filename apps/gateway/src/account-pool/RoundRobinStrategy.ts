import type { ProviderAccount } from "../providers/base/ProviderAccount.js";
import type {
  AccountSelectionContext,
  AccountSelectionStrategy
} from "./types.js";

export class RoundRobinStrategy implements AccountSelectionStrategy {
  private nextIndex = 0;

  select(
    accounts: ProviderAccount[],
    _context: AccountSelectionContext
  ): ProviderAccount | null {
    if (accounts.length === 0) {
      return null;
    }

    const account = accounts[this.nextIndex % accounts.length];
    this.nextIndex = (this.nextIndex + 1) % accounts.length;
    return account ?? null;
  }
}

