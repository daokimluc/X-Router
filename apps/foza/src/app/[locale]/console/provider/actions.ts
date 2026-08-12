"use server";

import { getServerSession } from "@/lib/xrouter/session";
import { accountStore } from "@/lib/xrouter/account-store";
import { xrouter } from "@/lib/xrouter/adapter";
import { XRouterError } from "@/lib/xrouter/types";

export type ProviderState =
  | { ok: true; sellerId: string; status: string }
  | { ok: false; error: string }
  | null;

/** Submit a seller registration → X-Router POST /provision/seller (status: pending). */
export async function registerSellerAction(
  _prev: ProviderState,
  formData: FormData,
): Promise<ProviderState> {
  const displayName = String(formData.get("displayName") ?? "").trim();
  const telegram = String(formData.get("telegram") ?? "").trim();
  if (!displayName) return { ok: false, error: "Display name required" };

  // Require auth BEFORE creating anything on the gateway — otherwise an
  // unauthenticated caller could spam orphan sellers that map to no user.
  const session = await getServerSession();
  if (!session) return { ok: false, error: "Not signed in" };

  // One seller per user: don't let a user create a second seller record.
  const existing = accountStore.get(session.email);
  if (existing?.sellerId) {
    return { ok: false, error: "You already have a seller account" };
  }

  try {
    const res = await xrouter.createSeller({
      displayName,
      payoutRef: telegram || undefined,
    });
    accountStore.setSeller(session.email, res.seller.id, res.seller.status);
    return { ok: true, sellerId: res.seller.id, status: res.seller.status };
  } catch (err) {
    const msg = err instanceof XRouterError ? err.message : "Registration failed";
    return { ok: false, error: msg };
  }
}
