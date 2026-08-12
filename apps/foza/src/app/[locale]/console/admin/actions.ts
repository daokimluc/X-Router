"use server";

import { hasPermission } from "@/lib/xrouter/admin";
import { xrouter } from "@/lib/xrouter/adapter";
import { XRouterError } from "@/lib/xrouter/types";
import { type Permission } from "@/lib/roles";
import { claimPayout, releasePayout } from "@/lib/db";

export type AdminState = { ok: boolean; error?: string; msg?: string } | null;

/** Guard an action behind a specific permission (role-aware). */
async function guard(perm: Permission): Promise<string | null> {
  return (await hasPermission(perm)) ? null : "Forbidden";
}

function err(e: unknown): string {
  return e instanceof XRouterError ? e.message : "Action failed";
}

export async function approveSellerAction(
  _prev: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const g = await guard("manageSellers");
  if (g) return { ok: false, error: g };
  const id = String(formData.get("sellerId") ?? "");
  try {
    const res = await xrouter.approveSeller(id);
    return { ok: true, msg: res.seller.status };
  } catch (e) {
    return { ok: false, error: err(e) };
  }
}

export async function suspendSellerAction(
  _prev: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const g = await guard("manageSellers");
  if (g) return { ok: false, error: g };
  const id = String(formData.get("sellerId") ?? "");
  try {
    const res = await xrouter.suspendSeller(id);
    return { ok: true, msg: res.seller.status };
  } catch (e) {
    return { ok: false, error: err(e) };
  }
}

export async function setMarkupAction(
  _prev: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const g = await guard("managePlans");
  if (g) return { ok: false, error: g };
  const defaultMarkup = Number(formData.get("defaultMarkup") ?? 0);
  if (!Number.isFinite(defaultMarkup) || defaultMarkup < 0) {
    return { ok: false, error: "Invalid markup" };
  }
  try {
    const res = await xrouter.setMarkup({ defaultMarkup });
    return { ok: true, msg: `${(res.defaultMarkup * 100).toFixed(0)}%` };
  } catch (e) {
    return { ok: false, error: err(e) };
  }
}

export async function markPaidAction(
  _prev: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const g = await guard("moneyReverse");
  if (g) return { ok: false, error: g };
  const sellerId = String(formData.get("sellerId") ?? "");
  const usd = Number(formData.get("usd") ?? 0);
  if (!sellerId || !Number.isFinite(usd) || usd <= 0) {
    return { ok: false, error: "Invalid input" };
  }

  // Idempotency: a payout moves real money to a seller, so a double-submit must
  // not pay twice. This is now guarded on BOTH sides — Foza's claimPayout (local)
  // and X-Router's mark-paid (idempotent on payoutRef since v0.6.1) — so the
  // payoutRef must be stable for a true retry of the SAME payout. We prefer a
  // caller-supplied ref; absent that we mint a UNIQUE ref (random suffix) so two
  // LEGITIMATE same-amount payouts on the same day aren't collapsed into one
  // (which would underpay the seller). The trade-off: a blind double-click
  // without a supplied ref isn't deduped — the UI should send a stable payoutRef.
  const supplied = String(formData.get("payoutRef") ?? "").trim();
  const payoutRef =
    supplied ||
    `auto:${sellerId}:${usd.toFixed(2)}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`;

  if (!claimPayout({ payoutRef, sellerId, usdAmount: usd })) {
    return { ok: false, error: "This payout was already recorded." };
  }

  try {
    const res = await xrouter.markEarningsPaid(sellerId, { usd, payoutRef });
    return { ok: true, msg: `unpaid: $${res.unpaid.toFixed(2)}` };
  } catch (e) {
    // Roll back the local claim so a transient failure can be retried.
    releasePayout(payoutRef);
    // X-Router caps a payout at the seller's unpaid balance (v0.6.1): paying more
    // than is owed is rejected with amount_exceeds_unpaid. Surface it specifically
    // so the admin knows to lower the amount, not retry the same.
    if (e instanceof XRouterError && e.code === "amount_exceeds_unpaid") {
      return { ok: false, error: `Amount exceeds the seller's unpaid balance. ${e.message}` };
    }
    return { ok: false, error: err(e) };
  }
}

export async function setWebhookAction(
  _prev: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const g = await guard("manageCatalog");
  if (g) return { ok: false, error: g };
  const url = String(formData.get("url") ?? "").trim();
  const secret = String(formData.get("secret") ?? "").trim();
  const enabled = String(formData.get("enabled") ?? "") === "on";
  try {
    const res = await xrouter.setWebhookConfig({
      url: url || undefined,
      secret: secret || undefined,
      enabled,
      events: [
        "usage.recorded",
        "quota.blocked",
        "wallet.low",
        "grant.exhausted",
        "supply.unhealthy",
        "plan.renewed",
        "plan.downgraded",
        "settlement.reversed",
      ],
    });
    return { ok: true, msg: res.enabled ? "enabled" : "disabled" };
  } catch (e) {
    return { ok: false, error: err(e) };
  }
}

// ── Admin-key actions (plan CRUD, canonical, reject seller) ─────────────────
// These hit /admin/v1/* via the admin key. All gated by isAdmin().

/** Create or update a plan. id present in formData → update, else create. */
export async function savePlanAction(
  _prev: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const g = await guard("managePlans");
  if (g) return { ok: false, error: g };

  const id = String(formData.get("id") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const priceUsd = Number(formData.get("priceUsd") ?? 0);
  const modelGroups = String(formData.get("modelGroups") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const hourUsd = Number(formData.get("hourUsd") ?? 0);
  const dayUsd = Number(formData.get("dayUsd") ?? 0);
  const monthUsd = Number(formData.get("monthUsd") ?? 0);
  const overageEnabled = String(formData.get("overageEnabled") ?? "") === "on";

  if (!name || modelGroups.length === 0 || !Number.isFinite(priceUsd) || priceUsd < 0) {
    return { ok: false, error: "Name, price (>=0) and at least one model group are required" };
  }

  const body = {
    name,
    priceUsd,
    modelGroups,
    buckets: { hourUsd, dayUsd, monthUsd },
    overageEnabled,
  };
  try {
    const res = id
      ? await xrouter.updatePlan(id, body)
      : await xrouter.createPlan(body);
    return { ok: true, msg: res.plan.id };
  } catch (e) {
    return { ok: false, error: err(e) };
  }
}

export async function deletePlanAction(
  _prev: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const g = await guard("managePlans");
  if (g) return { ok: false, error: g };
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { ok: false, error: "Missing plan id" };
  try {
    const res = await xrouter.deletePlan(id);
    return { ok: true, msg: res.deleted };
  } catch (e) {
    return { ok: false, error: err(e) };
  }
}

export async function rejectSellerAction(
  _prev: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const g = await guard("manageSellers");
  if (g) return { ok: false, error: g };
  const id = String(formData.get("sellerId") ?? "").trim();
  if (!id) return { ok: false, error: "Missing sellerId" };
  try {
    const res = await xrouter.rejectSeller(id);
    return { ok: true, msg: res.rejected };
  } catch (e) {
    return { ok: false, error: err(e) };
  }
}

export async function addCanonicalAction(
  _prev: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const g = await guard("manageCatalog");
  if (g) return { ok: false, error: g };
  const model = String(formData.get("model") ?? "").trim();
  if (!model) return { ok: false, error: "Missing model" };
  try {
    const res = await xrouter.addCanonicalModel(model);
    return { ok: true, msg: `${res.models.length} models` };
  } catch (e) {
    return { ok: false, error: err(e) };
  }
}

export async function removeCanonicalAction(
  _prev: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const g = await guard("manageCatalog");
  if (g) return { ok: false, error: g };
  const model = String(formData.get("model") ?? "").trim();
  if (!model) return { ok: false, error: "Missing model" };
  try {
    const res = await xrouter.removeCanonicalModel(model);
    return { ok: true, msg: `${res.models.length} models` };
  } catch (e) {
    return { ok: false, error: err(e) };
  }
}
