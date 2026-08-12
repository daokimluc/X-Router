"use server";

import { xrouter } from "@/lib/xrouter/adapter";
import { XRouterError } from "@/lib/xrouter/types";
import { assertOwnsListing, ForbiddenError } from "@/lib/xrouter/ownership";

export type ListingActionState =
  | { ok: true; action: "toggle" | "delete"; id: string }
  | { ok: false; error: string }
  | null;

function errMsg(err: unknown, fallback: string): string {
  if (err instanceof ForbiddenError) return err.message;
  if (err instanceof XRouterError) return err.message;
  return fallback;
}

/** Enable/disable a listing → PATCH /provision/listing/:id. Owner-scoped. */
export async function toggleListingAction(
  _prev: ListingActionState,
  formData: FormData,
): Promise<ListingActionState> {
  const id = String(formData.get("id") ?? "");
  const enabled = String(formData.get("enabled") ?? "") === "true";
  try {
    await assertOwnsListing(id);
    await xrouter.setListingEnabled(id, !enabled);
    return { ok: true, action: "toggle", id };
  } catch (err) {
    return { ok: false, error: errMsg(err, "Toggle failed") };
  }
}

/** Delete a listing → DELETE /provision/listing/:id. Owner-scoped. */
export async function deleteListingAction(
  _prev: ListingActionState,
  formData: FormData,
): Promise<ListingActionState> {
  const id = String(formData.get("id") ?? "");
  try {
    await assertOwnsListing(id);
    await xrouter.deleteListing(id);
    return { ok: true, action: "delete", id };
  } catch (err) {
    return { ok: false, error: errMsg(err, "Delete failed") };
  }
}
