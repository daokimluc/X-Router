import { NextResponse, type NextRequest } from "next/server";
import { isAdmin } from "@/lib/xrouter/admin";
import { reconcileSettlements, checkPayoutDrift } from "@/lib/xrouter/reconcile";

/**
 * Manual reconciliation sweep. Replays GET /provision/settlements since the last
 * checkpoint and upserts missed rows into the money ledger idempotently (keyed by
 * settlementId). usage.recorded webhooks remain the realtime path. Optionally
 * checks payout drift for a seller (?sellerId=).
 *
 * ADMIN ONLY: this touches the money ledger and exposes a seller's payout drift,
 * so it must never be reachable by an unauthenticated caller. The proxy matcher
 * skips /api, so the gate has to live here.
 */
export async function POST(request: NextRequest) {
  if (!(await isAdmin())) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const keyId = request.nextUrl.searchParams.get("keyId") ?? undefined;
  const sellerId = request.nextUrl.searchParams.get("sellerId") ?? undefined;
  try {
    const res = await reconcileSettlements({ keyId, sellerId });
    const drift = sellerId ? await checkPayoutDrift(sellerId) : undefined;
    return NextResponse.json({ ok: true, ...res, ...(drift ? { drift } : {}) });
  } catch (err) {
    // Log the detail server-side; return a generic message so internal errors
    // (gateway URLs, stack hints) don't leak to the caller.
    console.error("[/api/xrouter/reconcile] error:", err);
    return NextResponse.json({ ok: false, error: "Reconcile failed" }, { status: 500 });
  }
}
