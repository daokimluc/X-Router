"use server";

import { ensureUserKey, getServerSession } from "@/lib/xrouter/session";
import { xrouter } from "@/lib/xrouter/adapter";
import { accountStore } from "@/lib/xrouter/account-store";
import { XRouterError } from "@/lib/xrouter/types";

export type SubscribeState =
  | { ok: true; planId: string }
  | { ok: false; error: string; needTopup?: boolean }
  | null;

/** Subscribe the current user to a plan (grant on their X-Router key). */
export async function subscribePlanAction(
  _prev: SubscribeState,
  formData: FormData,
): Promise<SubscribeState> {
  const planId = String(formData.get("planId") ?? "").trim();
  const overageEnabled = String(formData.get("overageEnabled") ?? "") === "true";
  if (!planId) return { ok: false, error: "Missing plan" };

  const acct = await ensureUserKey();
  if (!acct) return { ok: false, error: "Not signed in" };

  try {
    const res = await xrouter.grantPlan({ keyId: acct.keyId, planId, overageEnabled });
    accountStore.update(acct.email, {
      planId: res.planId,
      overageEnabled: res.overageEnabled ?? false,
    });
    return { ok: true, planId: res.planId ?? planId };
  } catch (err) {
    // Paid plan + insufficient wallet → X-Router returns 402; surface it as a
    // top-up prompt rather than a generic failure (the plan was NOT granted).
    if (err instanceof XRouterError && err.status === 402) {
      const msg = err.message || "Insufficient wallet balance";
      return { ok: false, error: msg, needTopup: true };
    }
    const msg = err instanceof XRouterError ? err.message : "Subscribe failed";
    return { ok: false, error: msg };
  }
}

export type PlanMutState = { ok: boolean; error?: string } | null;

/**
 * Toggle overage on the current plan grant.
 *
 * Overage is a non-money preference, so this must NOT go through
 * /provision/grant: that path re-charges the full plan price whenever the
 * current period has lapsed (or hasn't been lazily renewed yet), which would
 * bill the user a month just for flipping a switch. Use the admin
 * PATCH /admin/v1/keys/:id/plan path instead — it updates overageEnabled (and
 * keeps the same planId) without touching the wallet or the renewal period.
 */
export async function toggleOverageAction(
  _prev: PlanMutState,
  formData: FormData,
): Promise<PlanMutState> {
  const enable = String(formData.get("enable") ?? "") === "true";
  const session = await getServerSession();
  if (!session) return { ok: false, error: "Not signed in" };
  const acct = accountStore.get(session.email);
  if (!acct?.planId) return { ok: false, error: "No active plan" };
  try {
    // Keep the existing plan binding; only change the overage flag. No charge.
    await xrouter.setKeyPlan(acct.keyId, acct.planId, enable);
    accountStore.update(session.email, { overageEnabled: enable });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof XRouterError ? err.message : "Failed" };
  }
}

/** Cancel the current plan — clears it on X-Router AND in Foza's record. */
export async function cancelPlanAction(): Promise<PlanMutState> {
  const session = await getServerSession();
  if (!session) return { ok: false, error: "Not signed in" };
  const acct = accountStore.get(session.email);
  if (!acct?.planId) return { ok: false, error: "No active plan" };
  try {
    // Cancel via /provision/grant {planId:null} → PlanSubscriptionService.cancel
    // clears planId AND planChargedAt AND planPeriodEnd together. The admin
    // setKeyPlan(null) path only nulls planId, leaving planPeriodEnd/planChargedAt
    // dangling so a later renewal sweep could re-charge a "cancelled" key.
    if (acct.keyId) await xrouter.grantPlan({ keyId: acct.keyId, planId: null });
    accountStore.update(session.email, { planId: null, overageEnabled: false });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof XRouterError ? err.message : "Cancel failed" };
  }
}
