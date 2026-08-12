import "server-only";
import { xrouterConfig } from "./config";
import { xrouter } from "./adapter";
import { ledger } from "./ledger";

/**
 * Reconcile Foza's money ledger against X-Router's authoritative settlement log.
 *
 * Two independent sweeps, each with its own checkpoint:
 *  1. FORWARD (new settles): replay GET /provision/settlements?since=<lastSettledAt>
 *     and upsert missed rows. usage.recorded webhooks are the realtime path; this
 *     backfills any missed. Idempotent by settlementId.
 *  2. REVERSALS: replay GET /provision/settlements?reversedSince=<lastReversedAt>
 *     and markReversed each. settlement.reversed webhooks (v0.6.3+) are the
 *     realtime path; this is the catch-up backstop. `reversedSince` filters by
 *     `reversedAt` — INDEPENDENT of the original settle `ts` — so a reversal of
 *     an old settlement is always caught (no time-window blind spot). This
 *     replaces the earlier 7-day `since` lookback hack.
 *
 * No-op when the integration is disabled.
 */
export async function reconcileSettlements(opts: {
  keyId?: string;
  sellerId?: string;
} = {}): Promise<{
  folded: number;
  scanned: number;
  reversedSynced: number;
  newestAt: string | null;
}> {
  if (xrouterConfig.enabled === false) {
    return { folded: 0, scanned: 0, reversedSynced: 0, newestAt: null };
  }

  // ── Sweep 1: forward (new settles) ──────────────────────────────────────────
  const since =
    ledger.getLastSettledAt() ??
    new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const page = await xrouter.getSettlements({ since, limit: 1000, ...opts });
  let folded = 0;
  let newestAt = ledger.getLastSettledAt();

  for (const r of page.data) {
    const inserted = ledger.upsertSettlement({
      settlementId: r.settlementId,
      requestId: r.requestId,
      buyerKeyId: r.buyerKeyId,
      sellerId: r.sellerId,
      baseModel: r.baseModel,
      promptTokens: r.promptTokens,
      completionTokens: r.completionTokens,
      collected: r.collected,
      sellerCredit: r.sellerCredit,
      billTrack: r.billTrack,
      reversed: r.reversed,
    });
    if (inserted) folded += 1;
    if (r.createdAt && (!newestAt || r.createdAt > newestAt)) newestAt = r.createdAt;
  }
  if (newestAt) ledger.setLastSettledAt(newestAt);

  // ── Sweep 2: reversals (catch-up backstop for missed settlement.reversed) ────
  const reversedCheckpoint = ledger.getLastReversedAt();
  // First-ever run: look back 24h of reversals (after that the checkpoint drives it).
  const reversedSince = new Date(
    reversedCheckpoint ?? Date.now() - 24 * 60 * 60 * 1000,
  ).toISOString();
  const reversedPage = await xrouter.getSettlements({
    reversedSince,
    limit: 1000,
    ...opts,
  });
  let reversedSynced = 0;
  let newestReversedAt = reversedCheckpoint ?? 0;

  for (const r of reversedPage.data) {
    if (!r.reversed) continue; // reversedSince should only return reversed rows; guard anyway
    // upsert (not bare markReversed): if Foza never folded the original settle
    // (missed both the webhook and the forward window), markReversed would touch
    // 0 rows and lose the reversal. upsertSettlement inserts-if-missing AND
    // re-syncs the reversed flag on an existing row — idempotent either way.
    ledger.upsertSettlement({
      settlementId: r.settlementId,
      requestId: r.requestId,
      buyerKeyId: r.buyerKeyId,
      sellerId: r.sellerId,
      baseModel: r.baseModel,
      promptTokens: r.promptTokens,
      completionTokens: r.completionTokens,
      collected: r.collected,
      sellerCredit: r.sellerCredit,
      billTrack: r.billTrack,
      reversed: true,
    });
    reversedSynced += 1;
    if (r.reversedAt != null && r.reversedAt > newestReversedAt) {
      newestReversedAt = r.reversedAt;
    }
  }
  if (newestReversedAt > 0) ledger.setLastReversedAt(newestReversedAt);

  return { folded, scanned: page.data.length, reversedSynced, newestAt };
}

/**
 * Check Foza's accrued seller credit against X-Router's authoritative earnings
 * snapshot. The snapshot is the figure of record for payout; a mismatch surfaces
 * a drift alert rather than silently trusting Foza's own sum.
 */
export async function checkPayoutDrift(
  sellerId: string,
): Promise<{ fozaUsd: number; xrouterUsd: number; driftUsd: number; ok: boolean }> {
  const fozaUsd = ledger.sellerUnpaidUsd(sellerId);
  if (!xrouterConfig.enabled) {
    return { fozaUsd, xrouterUsd: fozaUsd, driftUsd: 0, ok: true };
  }
  const snap = await xrouter.getEarnings(sellerId);
  // X-Router's lifetime credit is the authoritative accrual basis.
  const xrouterUsd = snap.lifetime ?? 0;
  const driftUsd = Math.round((fozaUsd - xrouterUsd) * 1e6) / 1e6;
  // Tolerate sub-cent rounding; flag anything larger.
  const ok = Math.abs(driftUsd) < 0.01;
  return { fozaUsd, xrouterUsd, driftUsd, ok };
}
