"use server";

import { ensureUserKey } from "@/lib/xrouter/session";
import { recordPendingTopup, getTopupStatus } from "@/lib/db";
import { paymentConfig } from "@/lib/xrouter/config";

export type TopupState =
  | {
      ok: true;
      pending: true;
      usd: number;
      /** Bank-transfer instructions for the buyer (server-authoritative). */
      payment: {
        memo: string; // transfer content — SePay matches this back to us
        vnd: number;
        bankAccount: string;
        bankName: string;
        bankAccountName: string;
        qrUrl: string; // VietQR image with amount + memo prefilled
      };
    }
  | { ok: false; error: string }
  | null;

/** Max single top-up request (USD). Guards against absurd/overflow amounts. */
const MAX_TOPUP_USD = 10_000;

/**
 * Start a wallet top-up: record a PENDING row and return the bank-transfer
 * instructions (memo = the pending id, server-generated). It does NOT credit
 * the wallet — that only happens when SePay's webhook confirms the matching
 * transfer arrived (see /api/webhooks/sepay). The buyer transfers VND with
 * `memo` in the content; SePay echoes it back and we credit then.
 */
export async function confirmTopupAction(
  _prev: TopupState,
  formData: FormData,
): Promise<TopupState> {
  const usd = Number(formData.get("usd") ?? 0);
  if (!Number.isFinite(usd) || usd <= 0) {
    return { ok: false, error: "Invalid amount" };
  }
  if (usd > MAX_TOPUP_USD) {
    return { ok: false, error: `Amount exceeds the ${MAX_TOPUP_USD} USD limit` };
  }

  const acct = await ensureUserKey();
  if (!acct) return { ok: false, error: "Not signed in" };

  const amount = Math.round(usd * 100) / 100;
  const vnd = Math.round(amount * paymentConfig.usdToVndRate);

  const memo = recordPendingTopup({
    userEmail: acct.email,
    keyId: acct.keyId,
    usdAmount: amount,
    vndAmount: vnd,
    fxRate: paymentConfig.usdToVndRate,
    memoPrefix: paymentConfig.memoPrefix,
  });

  // VietQR image: amount + memo prefilled so the buyer can't fat-finger them.
  const qrUrl =
    `https://img.vietqr.io/image/${encodeURIComponent(paymentConfig.bankName)}-` +
    `${encodeURIComponent(paymentConfig.bankAccount)}-compact2.png` +
    `?amount=${vnd}&addInfo=${encodeURIComponent(memo)}` +
    `&accountName=${encodeURIComponent(paymentConfig.bankAccountName)}`;

  return {
    ok: true,
    pending: true,
    usd: amount,
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

/**
 * Poll a top-up's status (the payment screen calls this until "credited"). Only
 * returns status for a row owned by the current user — no cross-user lookups.
 */
export async function topupStatusAction(
  memo: string,
): Promise<{ status: "pending" | "credited" | "unknown" }> {
  const acct = await ensureUserKey();
  if (!acct) return { status: "unknown" };
  const row = getTopupStatus(memo);
  if (!row || row.userEmail !== acct.email) return { status: "unknown" };
  return { status: row.status === "credited" ? "credited" : "pending" };
}
