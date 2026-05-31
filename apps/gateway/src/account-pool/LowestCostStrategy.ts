import type { ProviderAccount } from "../providers/base/ProviderAccount.js";
import type {
  AccountSelectionContext,
  AccountSelectionStrategy,
  CostPrice
} from "./types.js";

/**
 * LowestCostStrategy — lowest-cost-routing (#5).
 *
 * Selects the cheapest healthy candidate using the cost lookup injected in the
 * context (`costFor`). The engine stays marketplace-agnostic: it only sorts on
 * whatever cost the lookup returns.
 *
 * Cost scalar = inputPerM + outputPerM (documented simplification; a blended,
 * token-weighted cost is a future refinement). Ties break: least active
 * requests → lowest priority value → stable id order.
 *
 * Degrades gracefully: if no `costFor` is injected (e.g. marketplace off, or the
 * route did not supply one) or no candidate has a known cost, it falls back to
 * the same tie-break order (least busy → priority → id) over ALL candidates
 * instead of returning null. This guarantees an instance configured with this
 * strategy still serves requests rather than throwing NoAvailableAccountError.
 *
 * Because seller-supply guarantees a house candidate priced at true wholesale,
 * "min cost" is inherently bounded at or below the house cost — no special case.
 */
export class LowestCostStrategy implements AccountSelectionStrategy {
  select(
    accounts: ProviderAccount[],
    context: AccountSelectionContext
  ): ProviderAccount | null {
    if (accounts.length === 0) return null;

    const costOf = context.costFor;
    const costed = costOf
      ? accounts
          .map((account) => ({ account, cost: costOf(account.id) }))
          .filter((x): x is { account: ProviderAccount; cost: CostPrice } => x.cost != null)
      : [];

    // No cost data → degrade to least-busy/priority/id over all candidates so the
    // request still routes (never break an instance that picked this strategy).
    if (costed.length === 0) {
      return [...accounts].sort(byTieBreak)[0] ?? null;
    }

    costed.sort((a, b) => {
      const ca = a.cost.inputPerM + a.cost.outputPerM;
      const cb = b.cost.inputPerM + b.cost.outputPerM;
      if (ca !== cb) return ca - cb;
      return byTieBreak(a.account, b.account);
    });

    return costed[0].account;
  }
}

/** Shared tie-break: least active requests → lowest priority value → stable id. */
function byTieBreak(a: ProviderAccount, b: ProviderAccount): number {
  const busyDelta = a.runtime.activeRequests - b.runtime.activeRequests;
  if (busyDelta !== 0) return busyDelta;
  const prioDelta = (a.priority ?? Number.MAX_SAFE_INTEGER) - (b.priority ?? Number.MAX_SAFE_INTEGER);
  if (prioDelta !== 0) return prioDelta;
  return a.id.localeCompare(b.id);
}
