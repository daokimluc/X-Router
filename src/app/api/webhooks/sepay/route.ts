import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { paymentConfig } from "@/lib/xrouter/config";
import { xrouter } from "@/lib/xrouter/adapter";
import { XRouterError } from "@/lib/xrouter/types";
import { accountStore } from "@/lib/xrouter/account-store";
import {
  recordWebhookEvent,
  webhookEventSeen,
  findTopupByCode,
  claimTopupForCrediting,
  finalizeTopupCredited,
  releaseTopupCrediting,
} from "@/lib/db";

/**
 * SePay bank-transfer webhook. SePay watches the linked bank account and POSTs
 * here when money arrives. We:
 *   1. authenticate via `Authorization: Apikey <SEPAY_API_KEY>` (constant-time),
 *   2. accept only incoming transfers (transferType "in"),
 *   3. match the memo (content/code) to a PENDING top-up,
 *   4. verify the VND amount is at least what was requested,
 *   5. claim the row for crediting (pending → crediting, single-winner),
 *   6. credit the X-Router wallet/grant the pack — and ONLY THEN flip to
 *      "credited" (finalize). On failure we release the row back to pending so a
 *      retry can re-credit, and we do NOT record the dedupe key, so SePay's
 *      retry is allowed to try again rather than being swallowed as a duplicate.
 *
 * Crediting happens ONLY here, never from the browser. See docs/SePay payload:
 * { id, gateway, transactionDate, accountNumber, code, content, transferType,
 *   transferAmount, accumulated, referenceCode }.
 */

type SepayPayload = {
  id?: number | string;
  transferType?: string;
  transferAmount?: number;
  content?: string;
  code?: string | null;
  accountNumber?: string;
  referenceCode?: string;
};

/** Constant-time check of `Authorization: Apikey <key>`. */
function authOk(header: string | null): boolean {
  if (!paymentConfig.sepayApiKey || !header) return false;
  const expected = `Apikey ${paymentConfig.sepayApiKey}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();

  if (!authOk(request.headers.get("authorization"))) {
    return NextResponse.json({ success: false, error: "unauthorized" }, { status: 401 });
  }

  let p: SepayPayload;
  try {
    p = JSON.parse(rawBody) as SepayPayload;
  } catch {
    return NextResponse.json({ success: false, error: "invalid json" }, { status: 400 });
  }

  // Only incoming money matters; ignore outgoing/other events (ack so SePay stops retrying).
  if (p.transferType !== "in") {
    return NextResponse.json({ success: true, ignored: "not an incoming transfer" });
  }

  const sepayId = String(p.id ?? "");
  const memoText = `${p.code ?? ""} ${p.content ?? ""}`.trim();
  const amountVnd = Number(p.transferAmount ?? 0);
  if (!sepayId || !memoText) {
    return NextResponse.json({ success: true, ignored: "missing id/content" });
  }

  // Dedupe by SePay's transaction id — a retried webhook for a transfer we
  // ALREADY credited must not double-credit. This is a READ-ONLY check: we only
  // persist the dedupe key AFTER a successful credit (below), so a retry that
  // arrives because a previous attempt FAILED mid-credit is still allowed to
  // retry rather than being swallowed here.
  if (webhookEventSeen(`sepay:${sepayId}`)) {
    return NextResponse.json({ success: true, duplicate: true });
  }

  // Match the memo to a pending top-up.
  const topup = findTopupByCode(memoText);
  if (!topup) {
    // Unmatched transfer (manual deposit, wrong memo) — ack so SePay doesn't
    // retry; a human reconciles via the dashboard. Don't leak details.
    console.warn(`[sepay] no pending top-up matched memo: ${memoText} (id ${sepayId})`);
    return NextResponse.json({ success: true, matched: false });
  }

  // Amount sanity: the transfer must cover the requested VND (allow overpay).
  if (topup.vndAmount != null && amountVnd < Math.floor(topup.vndAmount)) {
    console.warn(
      `[sepay] underpaid top-up ${topup.id}: got ${amountVnd} VND, expected ${topup.vndAmount}`,
    );
    return NextResponse.json({ success: true, matched: true, underpaid: true });
  }

  // Phase 1 — claim the row (pending → crediting). Only the winner proceeds; a
  // concurrent/duplicate delivery for the same still-pending row gets false.
  if (!claimTopupForCrediting(topup.id, sepayId)) {
    // Either already credited, or another in-flight delivery owns the credit.
    return NextResponse.json({ success: true, alreadyClaimed: true });
  }

  // Phase 2 — credit the gateway FIRST, then finalize. If the gateway call
  // throws, release the claim back to pending so a retry can re-credit.
  try {
    if (topup.kind === "tokenpack") {
      // Token-pack purchase: grant the pack (X-Router stores tokens, doesn't
      // debit). Meta carries baseModel/tokens/expiresAt set when the intent was
      // created. The topup id is the idempotencyKey (stable per purchase).
      const meta = (topup.meta ? JSON.parse(topup.meta) : {}) as {
        baseModel?: string;
        tokens?: number;
        expiresAt?: number;
      };
      if (!meta.baseModel || !meta.tokens || !meta.expiresAt) {
        // Bad/missing meta is NOT a transient error — releasing to pending would
        // just loop. Leave the row 'crediting' for manual reconcile and ack.
        console.error(`[sepay] token-pack topup ${topup.id} missing meta:`, topup.meta);
        return NextResponse.json({ success: true, creditDeferred: true });
      }
      await xrouter.grantTokenPack({
        keyId: topup.keyId,
        baseModel: meta.baseModel,
        tokens: meta.tokens,
        pricePaidUsd: topup.usdAmount,
        expiresAt: meta.expiresAt,
        idempotencyKey: topup.id,
      });
    } else {
      // Plain wallet top-up. Pass topup.id as idempotencyKey (v0.6.3+) so a retry
      // after an ambiguous failure (gateway committed but response lost) is a
      // no-op instead of a double-credit — making the wallet path retry-safe like
      // the token-pack path.
      const res = await xrouter.topUpWallet({
        keyId: topup.keyId,
        usd: topup.usdAmount,
        idempotencyKey: topup.id,
      });
      accountStore.update(topup.userEmail, { walletUsd: res.walletUsd });
    }
  } catch (err) {
    // Gateway credit failed. Both credit paths are now IDEMPOTENT — token-pack on
    // idempotencyKey, wallet top-up on idempotencyKey=topup.id (v0.6.3+) — so a
    // replay can never double-credit. Recovery therefore only depends on whether
    // the failure is PERMANENT or TRANSIENT:
    //
    //  - PERMANENT (HTTP 4xx: amount_too_large, validation_error, not_found):
    //    the gateway will reject identically on retry, so retrying loops forever
    //    (SePay re-POSTs → same 4xx). Stop the loop: record the dedupe key to
    //    short-circuit this txid, and park the row in 'crediting' for manual
    //    reconcile. The money arrived but cannot be auto-applied.
    //  - TRANSIENT (5xx / network / timeout): release back to pending so a SePay
    //    retry — or the reconcile sweep — re-credits. Idempotency guarantees a
    //    re-credit after a lost-response commit is a no-op, not a double-credit.
    const status = err instanceof XRouterError ? err.status : undefined;
    const isPermanent = status !== undefined && status >= 400 && status < 500;

    if (isPermanent) {
      recordWebhookEvent({
        dedupeKey: `sepay:${sepayId}`,
        event: "sepay.transfer",
        rawBody,
        signatureVerified: true,
      });
      console.error(
        `[sepay] PERMANENT credit rejection (${status} ${err instanceof XRouterError ? err.code : "?"}) — parked 'crediting' for manual reconcile, topup ${topup.id} (${topup.kind}), key ${topup.keyId}, $${topup.usdAmount}:`,
        err,
      );
    } else {
      releaseTopupCrediting(topup.id);
      console.error(
        `[sepay] transient credit failure, released to pending for retry — topup ${topup.id} (${topup.kind}), key ${topup.keyId}, $${topup.usdAmount}, status ${status ?? "network"}:`,
        err,
      );
    }
    return NextResponse.json({ success: true, creditDeferred: true });
  }

  // Credit succeeded. Finalize (crediting → credited) and ONLY NOW record the
  // dedupe key, so a future retry of this exact transaction is short-circuited.
  finalizeTopupCredited(topup.id);
  recordWebhookEvent({
    dedupeKey: `sepay:${sepayId}`,
    event: "sepay.transfer",
    rawBody,
    signatureVerified: true,
  });

  return NextResponse.json({ success: true });
}
