import "server-only";
import { db } from "@/lib/db";
import type {
  UsageRecordedData,
  QuotaBlockedData,
  WalletLowData,
  GrantExhaustedData,
  SupplyUnhealthyData,
} from "./types";

/**
 * Foza's money record. Buyer charges + seller credit are persisted to SQLite
 * (billing_ledger / payable_ledger), idempotent by settlementId, so money
 * survives restarts and missed webhooks. Amounts are stored as integer
 * micro-USD (1 = $0.000001) to avoid float drift on sums, matching X-Router.
 *
 * Edge signals (quota.blocked / wallet.low / grant.exhausted / supply.unhealthy)
 * are transient operational hints, not money — they stay in-memory (globalThis).
 */

const MICRO = 1_000_000;
const usdToMicro = (usd: number) => Math.round(usd * MICRO);
const microToUsd = (micro: number) => micro / MICRO;

// Transient edge-event signals (not money) — in-memory is fine.
type EdgeState = {
  walletLow: Map<string, WalletLowData>;
  blocks: QuotaBlockedData[];
  exhaustedGrants: Map<string, GrantExhaustedData>;
  unhealthySellers: Map<string, SupplyUnhealthyData>;
};
const g = globalThis as unknown as { __fozaEdge?: EdgeState };
const edge: EdgeState =
  g.__fozaEdge ??
  (g.__fozaEdge = {
    walletLow: new Map(),
    blocks: [],
    exhaustedGrants: new Map(),
    unhealthySellers: new Map(),
  });

export const ledger = {
  /**
   * Record a settled request. Writes one billing row (buyer charge) and, unless
   * sellerId="house", one payable row (seller credit). Idempotent by
   * settlementId — a re-delivered event is a no-op (INSERT OR IGNORE).
   */
  recordUsage(d: UsageRecordedData) {
    // settlementId is the idempotency key (Phase 34d.1) and MUST match the key
    // reconcile uses (also settlementId), or the same settlement could be stored
    // under two different PKs and double-counted. We therefore key strictly on
    // settlementId; a payload lacking it is logged and skipped (reconcile will
    // still pick it up from /provision/settlements, where it always has an id).
    const id = d.settlementId;
    if (!id) {
      console.warn(
        "[ledger] usage.recorded without settlementId — skipped (reconcile will backfill)",
      );
      return;
    }
    const ts = new Date().toISOString();
    db()
      .prepare(
        `INSERT OR IGNORE INTO billing_ledger
           (settlementId, requestId, buyerKeyId, baseModel, promptTokens,
            completionTokens, actualSellCostMicro, platformMarginMicro, billTrack, reversed, ts)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      )
      .run(
        id,
        d.requestId ?? null,
        d.buyerKeyId,
        d.baseModel ?? null,
        d.promptTokens ?? null,
        d.completionTokens ?? null,
        usdToMicro(d.actualSellCost),
        usdToMicro(d.platformMargin),
        d.billTrack ?? null,
        ts,
      );

    if (d.sellerId && d.sellerId !== "house") {
      db()
        .prepare(
          `INSERT OR IGNORE INTO payable_ledger
             (settlementId, requestId, sellerId, sellerCreditMicro, reversed, ts)
           VALUES (?, ?, ?, ?, 0, ?)`,
        )
        .run(id, d.requestId ?? null, d.sellerId, usdToMicro(d.sellerCredit), ts);
    }
  },

  /** Mark a settlement reversed (excluded from totals). Idempotent. */
  markReversed(settlementId: string) {
    db().prepare("UPDATE billing_ledger SET reversed = 1 WHERE settlementId = ?").run(settlementId);
    db().prepare("UPDATE payable_ledger SET reversed = 1 WHERE settlementId = ?").run(settlementId);
  },

  // ---- Edge signals (in-memory) ----

  recordBlock(d: QuotaBlockedData) {
    edge.blocks.push(d);
    if (edge.blocks.length > 100) edge.blocks.shift();
  },
  recordWalletLow(d: WalletLowData) {
    edge.walletLow.set(d.keyId, d);
  },
  recordGrantExhausted(d: GrantExhaustedData) {
    edge.exhaustedGrants.set(`${d.keyId}:${d.group}`, d);
  },
  clearGrantExhausted(keyId: string, group: string) {
    edge.exhaustedGrants.delete(`${keyId}:${group}`);
  },
  recordSupplyUnhealthy(d: SupplyUnhealthyData) {
    edge.unhealthySellers.set(d.sellerId, d);
  },

  // CHUNK2

  // ---- Money reads (from the tables, excluding reversed) ----

  summary() {
    const conn = db();
    const b = conn
      .prepare(
        "SELECT COUNT(*) AS requests, COALESCE(SUM(actualSellCostMicro),0) AS spend, COALESCE(SUM(platformMarginMicro),0) AS margin FROM billing_ledger WHERE reversed = 0",
      )
      .get() as { requests: number; spend: number; margin: number };
    const keys = conn
      .prepare("SELECT COUNT(DISTINCT buyerKeyId) AS c FROM billing_ledger WHERE reversed = 0")
      .get() as { c: number };
    const sellers = conn
      .prepare("SELECT COUNT(DISTINCT sellerId) AS c FROM payable_ledger WHERE reversed = 0")
      .get() as { c: number };
    return {
      totalRequests: b.requests,
      totalSpendUsd: microToUsd(b.spend),
      totalMarginUsd: microToUsd(b.margin),
      keys: keys.c,
      sellers: sellers.c,
      exhaustedGrants: edge.exhaustedGrants.size,
      unhealthySellers: edge.unhealthySellers.size,
    };
  },

  forKey(keyId: string) {
    const r = db()
      .prepare(
        "SELECT COUNT(*) AS requests, COALESCE(SUM(actualSellCostMicro),0) AS spend FROM billing_ledger WHERE reversed = 0 AND buyerKeyId = ?",
      )
      .get(keyId) as { requests: number; spend: number };
    const exhausted = [...edge.exhaustedGrants.values()].filter((x) => x.keyId === keyId);
    return {
      requests: r.requests,
      spendUsd: microToUsd(r.spend),
      walletLow: edge.walletLow.get(keyId) ?? null,
      exhaustedGroups: exhausted,
    };
  },

  /**
   * Spend (USD) for one key since an ISO timestamp — used for period-scoped plan
   * quota (the billing_ledger `ts` is when Foza recorded the row). Excludes
   * reversed rows. `sinceIso` null → all-time.
   */
  spendUsdForKeySince(keyId: string, sinceIso: string | null): number {
    const r =
      sinceIso == null
        ? (db()
            .prepare(
              "SELECT COALESCE(SUM(actualSellCostMicro),0) AS spend FROM billing_ledger WHERE reversed = 0 AND buyerKeyId = ?",
            )
            .get(keyId) as { spend: number })
        : (db()
            .prepare(
              "SELECT COALESCE(SUM(actualSellCostMicro),0) AS spend FROM billing_ledger WHERE reversed = 0 AND buyerKeyId = ? AND ts >= ?",
            )
            .get(keyId, sinceIso) as { spend: number });
    return microToUsd(r.spend);
  },

  /** Aggregate requests + spend across SEVERAL keys (a user's keys). */
  forKeys(keyIds: string[]) {
    if (keyIds.length === 0) return { requests: 0, spendUsd: 0 };
    const placeholders = keyIds.map(() => "?").join(",");
    const r = db()
      .prepare(
        `SELECT COUNT(*) AS requests, COALESCE(SUM(actualSellCostMicro),0) AS spend
         FROM billing_ledger WHERE reversed = 0 AND buyerKeyId IN (${placeholders})`,
      )
      .get(...keyIds) as { requests: number; spend: number };
    return { requests: r.requests, spendUsd: microToUsd(r.spend) };
  },

  /** Per-model breakdown across a user's keys: [{ model, requests, tokens, spendUsd }]. */
  byModelForKeys(keyIds: string[]) {
    if (keyIds.length === 0) return [] as Array<{ model: string; requests: number; tokens: number; spendUsd: number }>;
    const placeholders = keyIds.map(() => "?").join(",");
    const rows = db()
      .prepare(
        `SELECT COALESCE(baseModel,'—') AS model,
                COUNT(*) AS requests,
                COALESCE(SUM(promptTokens + completionTokens),0) AS tokens,
                COALESCE(SUM(actualSellCostMicro),0) AS spend
         FROM billing_ledger
         WHERE reversed = 0 AND buyerKeyId IN (${placeholders})
         GROUP BY baseModel
         ORDER BY spend DESC`,
      )
      .all(...keyIds) as Array<{ model: string; requests: number; tokens: number; spend: number }>;
    return rows.map((r) => ({
      model: r.model,
      requests: r.requests,
      tokens: r.tokens,
      spendUsd: microToUsd(r.spend),
    }));
  },

  /**
   * GROSS lifetime seller credit from Foza's ledger, in USD (sum of non-reversed
   * payable rows). NOTE: this does NOT subtract payouts already made — it is the
   * accrual basis, not the net amount still owed. X-Router's earnings snapshot
   * (`unpaid`) is the authoritative net-owed figure for actual payout; this value
   * is used by checkPayoutDrift to compare accrual bases, not to decide payment.
   */
  sellerUnpaidUsd(sellerId: string) {
    const r = db()
      .prepare(
        "SELECT COALESCE(SUM(sellerCreditMicro),0) AS credit FROM payable_ledger WHERE reversed = 0 AND sellerId = ?",
      )
      .get(sellerId) as { credit: number };
    return microToUsd(r.credit);
  },

  sellerHealth(sellerId: string): SupplyUnhealthyData | null {
    return edge.unhealthySellers.get(sellerId) ?? null;
  },

  listUnhealthy(): SupplyUnhealthyData[] {
    return [...edge.unhealthySellers.values()];
  },

  // ---- Reconciliation helpers ----

  /**
   * Fold a settlement record (from GET /provision/settlements) into the ledger.
   * Idempotent by settlementId. Reversed rows are recorded then flagged so they
   * are excluded from totals. Returns true if newly inserted.
   */
  upsertSettlement(r: {
    settlementId: string;
    requestId?: string;
    buyerKeyId: string;
    sellerId: string;
    baseModel?: string;
    promptTokens?: number;
    completionTokens?: number;
    collected: number;
    sellerCredit: number;
    billTrack?: "plan" | "payg";
    reversed?: boolean;
  }): boolean {
    const ts = new Date().toISOString();
    // platformMargin = collected − sellerCredit (house: full collected is margin).
    const marginMicro = usdToMicro(r.collected) - usdToMicro(r.sellerCredit);
    const res = db()
      .prepare(
        `INSERT OR IGNORE INTO billing_ledger
           (settlementId, requestId, buyerKeyId, baseModel, promptTokens,
            completionTokens, actualSellCostMicro, platformMarginMicro, billTrack, reversed, ts)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        r.settlementId,
        r.requestId ?? null,
        r.buyerKeyId,
        r.baseModel ?? null,
        r.promptTokens ?? null,
        r.completionTokens ?? null,
        usdToMicro(r.collected),
        marginMicro,
        r.billTrack ?? null,
        r.reversed ? 1 : 0,
        ts,
      );
    const inserted = Number(res.changes) > 0;
    if (r.sellerId && r.sellerId !== "house") {
      db()
        .prepare(
          `INSERT OR IGNORE INTO payable_ledger
             (settlementId, requestId, sellerId, sellerCreditMicro, reversed, ts)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(r.settlementId, r.requestId ?? null, r.sellerId, usdToMicro(r.sellerCredit), r.reversed ? 1 : 0, ts);
    }
    // Keep reversed flag in sync even if the row already existed.
    if (r.reversed) this.markReversed(r.settlementId);
    return inserted;
  },

  getLastSettledAt(): string | null {
    const r = db().prepare("SELECT lastSettledAt FROM reconcile_state WHERE k = 'settlements'").get() as
      | { lastSettledAt: string | null }
      | undefined;
    return r?.lastSettledAt ?? null;
  },

  setLastSettledAt(ts: string) {
    db()
      .prepare(
        `INSERT INTO reconcile_state (k, lastSettledAt) VALUES ('settlements', ?)
         ON CONFLICT(k) DO UPDATE SET lastSettledAt = excluded.lastSettledAt`,
      )
      .run(ts);
  },

  /**
   * Reversal reconcile checkpoint (epoch-ms, stored as text). Tracks the newest
   * `reversedAt` Foza has folded so the sweep can query
   * `/provision/settlements?reversedSince=` for ONLY new reversals — independent
   * of the original settle `ts` (which a reversal never changes). Separate key
   * from 'settlements' so the forward-usage checkpoint and the reversal
   * checkpoint advance independently.
   */
  getLastReversedAt(): number | null {
    const r = db().prepare("SELECT lastSettledAt FROM reconcile_state WHERE k = 'reversals'").get() as
      | { lastSettledAt: string | null }
      | undefined;
    const v = r?.lastSettledAt;
    return v != null ? Number(v) : null;
  },

  setLastReversedAt(epochMs: number) {
    db()
      .prepare(
        `INSERT INTO reconcile_state (k, lastSettledAt) VALUES ('reversals', ?)
         ON CONFLICT(k) DO UPDATE SET lastSettledAt = excluded.lastSettledAt`,
      )
      .run(String(epochMs));
  },
};
