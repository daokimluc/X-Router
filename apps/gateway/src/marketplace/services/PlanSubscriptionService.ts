/**
 * PlanSubscriptionService — marketplace-plan-subscription.
 *
 * Owns the money side of a plan binding: a paid plan is a monthly subscription,
 * charged on subscribe and auto-renewed from the wallet each period (downgrade to
 * Free when underfunded). The published monthly quota resets in lockstep with the
 * subscription period.
 *
 * The engine never calls this directly — it is invoked by the provision grant
 * route (subscribe/cancel), the marketplace policy check (lazy renew), and the
 * PlanRenewalMonitor (background renew). All three converge on `renewIfDue`, which
 * uses `planPeriodEnd` as the idempotency token so lazy + background paths can
 * never double-charge the same period.
 *
 * Period fields are epoch-ms numbers on the engine key record (neutral data the
 * engine persists; this service drives them).
 */

import type { ApiKeyService } from "../../services/ApiKeyService.js";
import type { SpendLedgerService } from "../../services/SpendLedgerService.js";
import type { WebhookService } from "../../services/WebhookService.js";
import type { WalletService } from "./WalletService.js";
import type { Plan, PlanService } from "./PlanService.js";
import { addOneCalendarMonth } from "../utils/subscriptionPeriod.js";
import { groupsForPlan } from "../utils/modelGroup.js";

export type SubscribeResult =
  | { ok: true; idempotent?: boolean; planId: string | null; planPeriodEnd?: number; planChargedAt?: number; walletUsd: number }
  | { ok: false; reason: "insufficient_funds"; priceUsd: number; walletUsd: number };

export type RenewResult =
  | { changed: false; reason: "no_plan" | "plan_missing" | "not_due" }
  | { changed: true; kind: "grandfathered" | "renewed" }
  | { changed: true; kind: "downgraded"; fromPlanId: string };

export type PlanSubscriptionDeps = {
  apiKeyService: ApiKeyService;
  walletService: WalletService;
  planService: PlanService;
  spendLedgerService: SpendLedgerService;
  webhookService?: WebhookService;
  /** Injectable clock for tests. Defaults to Date.now. */
  now?: () => number;
};

export class PlanSubscriptionService {
  private readonly now: () => number;

  constructor(private readonly deps: PlanSubscriptionDeps) {
    this.now = deps.now ?? (() => Date.now());
  }

  /**
   * Bind a plan to a key, charging its wallet for a paid plan. Atomic in effect:
   * the wallet charge is the only durable money mutation and runs first; the plan
   * is bound only after a successful charge. Free plans bind with no charge.
   */
  subscribe(keyId: string, plan: Plan): SubscribeResult {
    const key = this.deps.apiKeyService.findById(keyId);
    const walletUsd = this.deps.walletService.getUsd(keyId);
    if (!key) {
      // Caller validates existence; defensive only.
      return { ok: false, reason: "insufficient_funds", priceUsd: plan.priceUsd, walletUsd };
    }

    // Idempotent: same plan already bound with a live period → no re-charge.
    if (key.planId === plan.id && typeof key.planPeriodEnd === "number" && key.planPeriodEnd > this.now()) {
      return {
        ok: true,
        idempotent: true,
        planId: plan.id,
        planPeriodEnd: key.planPeriodEnd,
        planChargedAt: key.planChargedAt,
        walletUsd
      };
    }

    // Free plan ($0): bind directly, no charge, no period.
    if (plan.priceUsd <= 0) {
      this.deps.apiKeyService.update(keyId, { planId: plan.id, planChargedAt: null, planPeriodEnd: null });
      this.resetMonthBuckets(keyId, plan);
      return { ok: true, planId: plan.id, walletUsd };
    }

    const now = this.now();

    // Durable idempotency (C1b): if the buyer already paid for a still-active
    // period of this plan (e.g. the charge committed but a crash lost the plan
    // binding before it persisted), rebind WITHOUT charging again. The exact-time
    // in-memory guard above can't catch a re-subscribe at a different `now`.
    const activeEnd = this.deps.walletService.activeChargedPeriodEnd(keyId, plan.id, now);
    if (activeEnd !== null) {
      this.deps.apiKeyService.update(keyId, { planId: plan.id, planPeriodEnd: activeEnd, planChargedAt: now });
      return { ok: true, idempotent: true, planId: plan.id, planPeriodEnd: activeEnd, planChargedAt: now, walletUsd };
    }

    // Paid plan: all-or-nothing charge with a durable per-period token, then bind.
    const periodEnd = addOneCalendarMonth(now);
    const charge = this.deps.walletService.chargeForPeriod(keyId, plan.priceUsd, {
      planId: plan.id,
      periodEnd,
      kind: "subscribe"
    });
    if (!charge.ok) {
      return { ok: false, reason: "insufficient_funds", priceUsd: plan.priceUsd, walletUsd };
    }
    this.deps.apiKeyService.update(keyId, { planId: plan.id, planChargedAt: now, planPeriodEnd: periodEnd });
    this.deps.apiKeyService.setWalletMicroUsd(keyId, Math.round(charge.newBalanceUsd * 1_000_000));
    this.resetMonthBuckets(keyId, plan);
    return { ok: true, planId: plan.id, planPeriodEnd: periodEnd, planChargedAt: now, walletUsd: charge.newBalanceUsd };
  }

  /** Cancel a subscription: unbind the plan, stop renewal, no refund. */
  cancel(keyId: string): void {
    this.deps.apiKeyService.update(keyId, { planId: null, planChargedAt: null, planPeriodEnd: null });
  }

  /**
   * Renew a key's subscription if the period has elapsed. Shared by the lazy
   * policy-check path and the background monitor; idempotent via `planPeriodEnd`.
   * Re-reads the key each call so a concurrent renewal that advanced the period is
   * observed as "not due".
   */
  renewIfDue(keyId: string): RenewResult {
    const key = this.deps.apiKeyService.findById(keyId);
    if (!key || !key.planId) return { changed: false, reason: "no_plan" };
    const plan = this.deps.planService.get(key.planId);
    if (!plan) return { changed: false, reason: "plan_missing" };

    const now = this.now();

    // Legacy grandfather: plan bound before this change has no period. Set one a
    // month out WITHOUT charging (it was granted under the old free behavior).
    if (typeof key.planPeriodEnd !== "number") {
      this.deps.apiKeyService.update(keyId, { planPeriodEnd: addOneCalendarMonth(now), planChargedAt: now });
      return { changed: true, kind: "grandfathered" };
    }

    if (now < key.planPeriodEnd) return { changed: false, reason: "not_due" };

    // Free ($0) plans never charge; just roll the period forward + reset quota.
    if (plan.priceUsd <= 0) {
      const periodEnd = addOneCalendarMonth(key.planPeriodEnd);
      this.deps.apiKeyService.update(keyId, { planPeriodEnd: periodEnd, planChargedAt: now });
      this.resetMonthBuckets(keyId, plan);
      return { changed: true, kind: "renewed" };
    }

    // Advance off the OLD period end (not `now`) so a late check doesn't drift the
    // anchor forward. This is the target period the charge is FOR — also the
    // durable idempotency token.
    const periodEnd = addOneCalendarMonth(key.planPeriodEnd);
    const charge = this.deps.walletService.chargeForPeriod(keyId, plan.priceUsd, {
      planId: plan.id,
      periodEnd,
      kind: "renew"
    });
    if (charge.alreadyCharged) {
      // This period was already charged (a renewal that committed before a restart,
      // now replayed against the stale in-memory period). Catch up the in-memory
      // period WITHOUT charging or re-emitting the webhook.
      this.deps.apiKeyService.update(keyId, { planPeriodEnd: periodEnd, planChargedAt: now });
      this.deps.apiKeyService.setWalletMicroUsd(keyId, Math.round(charge.newBalanceUsd * 1_000_000));
      this.resetMonthBuckets(keyId, plan);
      return { changed: true, kind: "renewed" };
    }
    if (!charge.ok) {
      // Underfunded → downgrade to Free, clear the period, notify.
      this.deps.apiKeyService.update(keyId, { planId: null, planChargedAt: null, planPeriodEnd: null });
      void this.deps.webhookService?.notifyBusiness("plan.downgraded", {
        keyId,
        fromPlanId: plan.id,
        reason: "renewal_underfunded",
        walletUsd: this.deps.walletService.getUsd(keyId)
      });
      return { changed: true, kind: "downgraded", fromPlanId: plan.id };
    }

    this.deps.apiKeyService.update(keyId, { planPeriodEnd: periodEnd, planChargedAt: now });
    this.deps.apiKeyService.setWalletMicroUsd(keyId, Math.round(charge.newBalanceUsd * 1_000_000));
    this.resetMonthBuckets(keyId, plan);
    void this.deps.webhookService?.notifyBusiness("plan.renewed", {
      keyId,
      planId: plan.id,
      priceUsd: plan.priceUsd,
      periodEnd,
      walletUsd: charge.newBalanceUsd
    });
    return { changed: true, kind: "renewed" };
  }

  /** Reset the plan's per-group monthly bucket(s) for the key to zero. */
  private resetMonthBuckets(keyId: string, plan: Plan): void {
    for (const group of groupsForPlan(plan.modelGroups)) {
      this.deps.spendLedgerService.resetMonth(`key:${keyId}:grp:${group}`);
    }
  }
}
