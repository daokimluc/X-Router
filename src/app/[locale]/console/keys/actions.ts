"use server";

import { getServerSession } from "@/lib/xrouter/session";
import { xrouter } from "@/lib/xrouter/adapter";
import { accountStore, maskKey } from "@/lib/xrouter/account-store";
import { XRouterError } from "@/lib/xrouter/types";
import { assertOwnsKey, ForbiddenError } from "@/lib/xrouter/ownership";
import { rateLimit, sweepExpired } from "@/lib/rate-limit";

export type CreateKeyState =
  | { ok: true; id: string; key: string; planId: string | null }
  | { ok: false; error: string }
  | null;

export async function createKeyAction(
  _prev: CreateKeyState,
  formData: FormData,
): Promise<CreateKeyState> {
  const label = String(formData.get("label") ?? "").trim() || "API key";
  const session = await getServerSession();
  if (!session) return { ok: false, error: "Not signed in" };
  // Cap key creation: 10 new keys per 10 minutes per user. Each key is a real
  // resource on the gateway, so an unbounded loop is a resource-exhaustion vector.
  sweepExpired();
  if (!rateLimit(`createkey:${session.email.toLowerCase()}`, 10, 10 * 60_000).allowed) {
    return { ok: false, error: "Too many keys created. Please wait a few minutes." };
  }
  try {
    // owner = email so GET /provision/keys?owner= groups the user's keys
    // (Phase 34d). The user-facing label is kept in Foza's buyers table.
    const res = await xrouter.createKey({ label: session.email });
    accountStore.addKey(session.email, {
      keyId: res.id,
      label,
      keyMasked: maskKey(res.key),
      models: [],
      createdAt: new Date().toISOString(),
    });
    return { ok: true, id: res.id, key: res.key, planId: res.planId };
  } catch (err) {
    const msg = err instanceof XRouterError ? err.message : "Failed to create key";
    return { ok: false, error: msg };
  }
}

export type KeyLifecycleState =
  | { ok: true; action: "disable" | "enable" | "revoke"; id: string }
  | { ok: true; action: "rotate"; id: string; key: string }
  | { ok: false; error: string }
  | null;

function lifecycleErr(err: unknown, fallback: string): string {
  if (err instanceof ForbiddenError) return err.message;
  if (err instanceof XRouterError) return err.message;
  return fallback;
}

/** Disable a key → POST /provision/key/:id/disable. Owner-scoped. */
export async function disableKeyAction(
  _prev: KeyLifecycleState,
  formData: FormData,
): Promise<KeyLifecycleState> {
  const id = String(formData.get("keyId") ?? "");
  try {
    await assertOwnsKey(id);
    await xrouter.setKeyEnabled(id, false);
    return { ok: true, action: "disable", id };
  } catch (err) {
    return { ok: false, error: lifecycleErr(err, "Disable failed") };
  }
}

/** Enable a key → POST /provision/key/:id/enable. Owner-scoped. */
export async function enableKeyAction(
  _prev: KeyLifecycleState,
  formData: FormData,
): Promise<KeyLifecycleState> {
  const id = String(formData.get("keyId") ?? "");
  try {
    await assertOwnsKey(id);
    await xrouter.setKeyEnabled(id, true);
    return { ok: true, action: "enable", id };
  } catch (err) {
    return { ok: false, error: lifecycleErr(err, "Enable failed") };
  }
}

/** Soft-revoke a key → DELETE /provision/key/:id. Owner-scoped. */
export async function revokeKeyAction(
  _prev: KeyLifecycleState,
  formData: FormData,
): Promise<KeyLifecycleState> {
  const id = String(formData.get("keyId") ?? "");
  try {
    await assertOwnsKey(id);
    await xrouter.revokeKey(id);
    return { ok: true, action: "revoke", id };
  } catch (err) {
    return { ok: false, error: lifecycleErr(err, "Revoke failed") };
  }
}

/** Rotate a key's secret → POST /provision/key/:id/rotate. Owner-scoped. */
export async function rotateKeyAction(
  _prev: KeyLifecycleState,
  formData: FormData,
): Promise<KeyLifecycleState> {
  const id = String(formData.get("keyId") ?? "");
  try {
    await assertOwnsKey(id);
    const res = await xrouter.rotateKey(id);
    // Update the masked form stored in Foza (plaintext is shown once, not stored).
    accountStore.updateKeyMasked(id, maskKey(res.key));
    return { ok: true, action: "rotate", id, key: res.key };
  } catch (err) {
    return { ok: false, error: lifecycleErr(err, "Rotate failed") };
  }
}
