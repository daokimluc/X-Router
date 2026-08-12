"use server";

import { getServerSession } from "@/lib/xrouter/session";
import { accountStore } from "@/lib/xrouter/account-store";
import { isAdmin } from "@/lib/xrouter/admin";
import { xrouter } from "@/lib/xrouter/adapter";
import { XRouterError } from "@/lib/xrouter/types";

/**
 * Create a marketplace listing (a model gói). Two trust paths:
 *  - source="house": platform supply. Admin-gated (isAdmin). sellerId="house" —
 *    the gateway credits no seller, so the full sell amount is platform margin.
 *  - source="seller": the caller's OWN seller. The sellerId is resolved from the
 *    session's account mapping, never from the form, so a user can only list
 *    under their own seller.
 *
 * costPrice is the wholesale COST; the platform sell price = cost × (1 + markup).
 */

export type ListingCreateState =
  | { ok: true; namespacedModel: string }
  | { ok: false; error: string }
  | null;

function err(e: unknown, fallback: string): string {
  return e instanceof XRouterError ? e.message : fallback;
}

export async function createListingAction(
  _prev: ListingCreateState,
  formData: FormData,
): Promise<ListingCreateState> {
  const session = await getServerSession();
  if (!session) return { ok: false, error: "Not signed in" };

  const source = String(formData.get("source") ?? "seller");
  const baseModel = String(formData.get("baseModel") ?? "").trim();
  const inputPerM = Number(formData.get("inputPerM") ?? NaN);
  const outputPerM = Number(formData.get("outputPerM") ?? NaN);
  const providerInstanceId = String(formData.get("providerInstanceId") ?? "").trim();
  const providerAccountId = String(formData.get("providerAccountId") ?? "").trim();

  if (!baseModel || !providerInstanceId || !providerAccountId) {
    return { ok: false, error: "Model, provider instance and account are required" };
  }
  if (!Number.isFinite(inputPerM) || inputPerM < 0 || !Number.isFinite(outputPerM) || outputPerM < 0) {
    return { ok: false, error: "Input and output prices must be >= 0" };
  }

  // Resolve sellerId by trust path — never from the form.
  let sellerId: string;
  if (source === "house") {
    if (!(await isAdmin())) return { ok: false, error: "Forbidden" };
    sellerId = "house";
  } else {
    const acct = accountStore.get(session.email);
    if (!acct?.sellerId) {
      return { ok: false, error: "You are not a registered seller" };
    }
    if (acct.sellerStatus !== "approved") {
      return { ok: false, error: "Your seller account is not approved yet" };
    }
    sellerId = acct.sellerId;
  }

  try {
    const res = await xrouter.createListing({
      sellerId,
      baseModel,
      costPrice: { inputPerM, outputPerM },
      providerInstanceId,
      providerAccountId,
    });
    return { ok: true, namespacedModel: res.listing.namespacedModel };
  } catch (e) {
    return { ok: false, error: err(e, "Create listing failed") };
  }
}
