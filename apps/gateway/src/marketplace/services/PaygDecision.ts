/**
 * PaygDecision — marketplace-plans (#3) handoff hook.
 *
 * When a plan-bound request breaches its month budget with overage enabled, the
 * gateway hands off to a pay-as-you-go decision. This change ships only the
 * interface + a no-op stub that defers (`payg_not_implemented`).
 * two-sided-settlement (#6) swaps in the real implementation that reserves the
 * wallet and meters PAYG daily limit.
 */

export type PaygContext = {
  keyId: string;
  /** Why PAYG was consulted: month budget exhausted, or a speed-limit boost. */
  reason: "month_overage" | "boost";
  /** Upper-bound USD estimate for the request. */
  estimateUsd: number;
  /** Effective PAYG daily limit (USD), or null if unset. */
  paygDailyLimitUsd: number | null;
};

export type PaygDecisionResult =
  | { charge: true; billTrack: "payg"; reservationId: string }
  | { charge: false; reason: "payg_not_implemented" | "overage_disabled" | "insufficient_funds" | "payg_daily_limit"; retryAfterSeconds?: number };

export interface PaygDecision {
  decide(ctx: PaygContext): PaygDecisionResult;
}

/** Default stub: PAYG not implemented yet → always defers. Replaced in #6. */
export class NoopPaygDecision implements PaygDecision {
  decide(_ctx: PaygContext): PaygDecisionResult {
    return { charge: false, reason: "payg_not_implemented" };
  }
}
