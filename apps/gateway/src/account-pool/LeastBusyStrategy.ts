import type { ProviderAccount } from "../providers/base/ProviderAccount.js";
import type {
  AccountSelectionContext,
  AccountSelectionStrategy
} from "./types.js";

export class LeastBusyStrategy implements AccountSelectionStrategy {
  select(
    accounts: ProviderAccount[],
    _context: AccountSelectionContext
  ): ProviderAccount | null {
    if (accounts.length === 0) {
      return null;
    }

    return [...accounts].sort((left, right) => {
      const activeDelta = left.runtime.activeRequests - right.runtime.activeRequests;

      if (activeDelta !== 0) {
        return activeDelta;
      }

      return left.id.localeCompare(right.id);
    })[0] ?? null;
  }
}

