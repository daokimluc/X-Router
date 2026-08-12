"use server";

import { getServerSession } from "@/lib/xrouter/session";
import { ensureUserKey } from "@/lib/xrouter/session";
import { assertOwnsKey, ForbiddenError } from "@/lib/xrouter/ownership";
import { recordPendingTopup, getTopupStatus } from "@/lib/db";
import { paymentConfig } from "@/lib/xrouter/config";
import { xrouter } from "@/lib/xrouter/adapter";

export type BuyPackState =
  | {
      ok: true;
      pending: true;
      usd: number;
      tokens: number;
      payment: {
        memo: string;
        vnd: number;
        bankAccount: string;
        bankName: string;
        bankAccountName: string;
        qrUrl: string;
      };
    }
  | { ok: false; error: string }
  | null;

const MAX_PACK_USD = 10_000;
const TTL_MS = 365 * 24 * 60 * 60 * 1000; // 12 months
/** The only pack sizes the UI offers — the server clamps to this set. */
const ALLOWED_PACK_TOKENS = [1_000_000, 5_000_000, 10_000_000] as const;

/**
 * Start a token-pack purchase. Records a PENDING top-up (kind="tokenpack") with
 * the pack details in `meta`, and returns the bank-transfer instructions. The
 * pack is only granted when SePay's webhook confirms payment (see
 * /api/webhooks/sepay → grantTokenPack).
 *
 * SECURITY: price is computed SERVER-SIDE from the live listing + markup — the
 * client-submitted `usd` is never trusted (it only drives the UI preview).
 * Otherwise a crafted POST (`tokens=10M, usd=0.01`) would mint a ~$750 pack for
 * a cent. We refetch the listing by baseModel, recompute the price from the
 * authoritative cost × markup, and clamp `tokens` to the offered sizes.
 */
export async function buyTokenPackAction(
  _prev: BuyPackState,
  formData: FormData,
): Promise<BuyPackState> {
  const baseModel = String(formData.get("baseModel") ?? "").trim();
  const tokens = Number(formData.get("tokens") ?? 0);
  const keyChoice = String(formData.get("keyId") ?? "").trim();

  if (!baseModel) return { ok: false, error: "Missing model" };
  // Only the published pack sizes are sellable — reject anything else outright
  // (the client `tokens` is the one quantity we accept, but bounded to the menu).
  if (!ALLOWED_PACK_TOKENS.includes(tokens as (typeof ALLOWED_PACK_TOKENS)[number])) {
    return { ok: false, error: "Invalid pack size" };
  }

  const session = await getServerSession();
  if (!session) return { ok: false, error: "Not signed in" };

  // Authoritative price: refetch the live listing for this model + the current
  // markup, then recompute. Never trust the client's `usd`. The price basis is
  // the sell OUTPUT rate (cost × (1+markup)) — conservative, matching the card.
  const [listings, markup] = await Promise.all([
    xrouter.listListings(baseModel),
    xrouter.getMarkup(),
  ]);
  const listing = listings.find((l) => l.baseModel === baseModel && l.enabled);
  if (!listing) return { ok: false, error: "Model is not available" };

  const markupMult = 1 + (markup.defaultMarkup ?? 0);
  const sellOutputPerM = listing.costPrice.outputPerM * markupMult;
  const usd = Math.round((sellOutputPerM * tokens) / 1_000_000 * 100) / 100;
  if (!Number.isFinite(usd) || usd <= 0) return { ok: false, error: "Invalid price" };
  if (usd > MAX_PACK_USD) return { ok: false, error: `Amount exceeds the ${MAX_PACK_USD} USD limit` };

  // Resolve target key: a chosen existing key (must own it) or the primary key.
  let keyId: string;
  try {
    if (keyChoice && keyChoice !== "__primary__") {
      await assertOwnsKey(keyChoice);
      keyId = keyChoice;
    } else {
      const acct = await ensureUserKey();
      if (!acct) return { ok: false, error: "Not signed in" };
      keyId = acct.keyId;
    }
  } catch (err) {
    if (err instanceof ForbiddenError) return { ok: false, error: err.message };
    return { ok: false, error: "Could not resolve key" };
  }

  const amount = Math.round(usd * 100) / 100;
  const vnd = Math.round(amount * paymentConfig.usdToVndRate);
  const expiresAt = Date.now() + TTL_MS;

  const memo = recordPendingTopup({
    userEmail: session.email,
    keyId,
    usdAmount: amount,
    vndAmount: vnd,
    fxRate: paymentConfig.usdToVndRate,
    memoPrefix: paymentConfig.memoPrefix,
    kind: "tokenpack",
    meta: { baseModel, tokens, expiresAt },
  });

  const qrUrl =
    `https://img.vietqr.io/image/${encodeURIComponent(paymentConfig.bankName)}-` +
    `${encodeURIComponent(paymentConfig.bankAccount)}-compact2.png` +
    `?amount=${vnd}&addInfo=${encodeURIComponent(memo)}` +
    `&accountName=${encodeURIComponent(paymentConfig.bankAccountName)}`;

  return {
    ok: true,
    pending: true,
    usd: amount,
    tokens,
    payment: {
      memo,
      vnd,
      bankAccount: paymentConfig.bankAccount,
      bankName: paymentConfig.bankName,
      bankAccountName: paymentConfig.bankAccountName,
      qrUrl,
    },
  };
}

/** Poll a pack purchase status (owner-scoped). */
export async function packStatusAction(
  memo: string,
): Promise<{ status: "pending" | "credited" | "unknown" }> {
  const session = await getServerSession();
  if (!session) return { status: "unknown" };
  const row = getTopupStatus(memo);
  if (!row || row.userEmail !== session.email) return { status: "unknown" };
  return { status: row.status === "credited" ? "credited" : "pending" };
}
