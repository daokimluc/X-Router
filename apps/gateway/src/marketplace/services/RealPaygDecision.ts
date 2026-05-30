/**
 * RealPaygDecision — two-sided-settlement (#6).
 *
 * Replaces NoopPaygDecision. When a plan-bound request breaches its month
 * budget (overage) or hits a speed-limit with boost opted in, this decides
 * whether to charge the wallet at the sell price:
 *
 *   overage disabled (and not boost)   → block (caller already 429'd)
 *   wallet unprovisioned / insufficient → 402 insufficient_funds
 *   PAYG daily limit would be exceeded  → 429 (retry next UTC day)
 *   else                                → reserve wallet + payg-daily bucket → charge
 *
 * The PAYG daily limit is enforced as a spend-ledger day cap on scope
 * `wallet:<keyId>:payg`. Boost does NOT touch the month budget (pure wallet).
 */
import type { SpendLedgerService } from "../../services/SpendLedgerService.js";
import type { WalletService } from "./WalletService.js";
import type { PaygContext, PaygDecision, PaygDecisionResult } from "./PaygDecision.js";

function secondsUntilNextDayUTC(): number {
  const now = new Date();
  const tomorrow = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  return Math.ceil((tomorrow.getTime() - now.getTime()) / 1000);
}

export class RealPaygDecision implements PaygDecision {
  constructor(
    private readonly walletService: WalletService,
    private readonly spendLedgerService: SpendLedgerService
  ) {}

  decide(ctx: PaygContext): PaygDecisionResult {
    // Funds check first (covers unprovisioned + insufficient).
    if (!this.walletService.hasFundsUsd(ctx.keyId, ctx.estimateUsd)) {
      return { charge: false, reason: "insufficient_funds" };
    }

    // PAYG daily limit: reserve against the wallet-scoped day bucket. If it
    // would exceed the user-set cap, the ledger rejects and we 429 (wait).
    const paygScope = `wallet:${ctx.keyId}:payg`;
    const dayRes = this.spendLedgerService.reserve({
      scope: paygScope,
      estimateUsd: ctx.estimateUsd,
      dayCap: ctx.paygDailyLimitUsd ?? null
    });
    if (!dayRes.ok) {
      return { charge: false, reason: "payg_daily_limit", retryAfterSeconds: secondsUntilNextDayUTC() };
    }

    // Reserve the wallet at the (upper-bound) sell estimate.
    const walletRes = this.walletService.reserveUsd({ keyId: ctx.keyId, estimateUsd: ctx.estimateUsd });
    if (!walletRes.ok) {
      // Roll back the day-bucket reservation we just took.
      this.spendLedgerService.release(dayRes.reservationId);
      return { charge: false, reason: "insufficient_funds" };
    }

    return { charge: true, billTrack: "payg", reservationId: `${walletRes.reservationId}|${dayRes.reservationId}` };
  }
}
