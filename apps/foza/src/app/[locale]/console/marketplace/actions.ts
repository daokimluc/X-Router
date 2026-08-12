"use server";

import { getServerSession } from "@/lib/xrouter/session";
import { accountStore, maskKey } from "@/lib/xrouter/account-store";
import { xrouter } from "@/lib/xrouter/adapter";
import { XRouterError } from "@/lib/xrouter/types";
import { assertOwnsKey, ForbiddenError } from "@/lib/xrouter/ownership";
import { rateLimit, sweepExpired } from "@/lib/rate-limit";

export type MarketSubscribeState =
  | { ok: true; model: string }
  | { ok: false; error: string }
  | null;

/**
 * Subscribe to a marketplace model. The user either adds it to an existing key
 * (keyId form field) or creates a new key (keyId="__new__"). The model is
 * recorded on that key; access is governed by the user's plan.
 */
export async function marketSubscribeAction(
  _prev: MarketSubscribeState,
  formData: FormData,
): Promise<MarketSubscribeState> {
  const model = String(formData.get("model") ?? "").trim();
  const choice = String(formData.get("keyId") ?? "").trim();
  const label = String(formData.get("label") ?? "").trim();

  const session = await getServerSession();
  if (!session) return { ok: false, error: "Not signed in" };

  try {
    let keyId: string;
    if (!choice || choice === "__new__") {
      // Same key-creation cap as createKeyAction — this path also mints a key.
      sweepExpired();
      if (!rateLimit(`createkey:${session.email.toLowerCase()}`, 10, 10 * 60_000).allowed) {
        return { ok: false, error: "Too many keys created. Please wait a few minutes." };
      }
      const created = await xrouter.createKey({ label: label || model });
      accountStore.addKey(session.email, {
        keyId: created.id,
        label: label || model,
        keyMasked: maskKey(created.key),
        models: [],
        createdAt: new Date().toISOString(),
      });
      keyId = created.id;
    } else {
      // Existing key chosen from the client — verify the user owns it before use.
      await assertOwnsKey(choice);
      keyId = choice;
    }
    accountStore.addModelToKey(session.email, keyId, model);
    return { ok: true, model };
  } catch (err) {
    if (err instanceof ForbiddenError) return { ok: false, error: err.message };
    const msg = err instanceof XRouterError ? err.message : "Subscribe failed";
    return { ok: false, error: msg };
  }
}
