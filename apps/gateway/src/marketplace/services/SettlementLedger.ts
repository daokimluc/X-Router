/**
 * SettlementLedger — money-correctness (#2).
 *
 * Owns the durable `settlement_log` (one row per billable settle) and the
 * solvency reconciliation reads. A logged settlement row is the audit substrate
 * that makes a full reversal possible and lets us prove the books conserve money:
 *
 *   collected == sellerCredit + platformMargin   (per row, enforced at write)
 *   Σ collected ≥ Σ sellerCredit                 (platform never owes more than it took)
 *   seller.unpaid == Σ credits − Σ payouts − Σ reversals
 *
 * Reversing a row refunds the buyer the collected amount, claws back the seller
 * credit, and unwinds the platform margin — once (idempotent via the `reversed`
 * flag). Routes/UI for issuing reversals are marketplace-lifecycle /
 * admin-marketplace-ui; this ships the primitive + the invariant.
 */

import { randomUUID } from "node:crypto";
import type { Database, SqliteDatabase } from "../../services/Database.js";
import { microToUsd, usdToMicro } from "../utils/money.js";
import type { WalletService } from "./WalletService.js";
import type { SellerEarningsLedger } from "./SellerEarningsLedger.js";
import type { SpendLedgerService } from "../../services/SpendLedgerService.js";

const HOUSE_SELLER_ID = "house";

export type SettlementRecord = {
  buyerKeyId: string;
  baseModel: string;
  sellerId: string;
  promptTokens: number;
  completionTokens: number;
  collected: number;
  sellerCredit: number;
  platformMargin: number;
  billTrack: "plan" | "payg";
  /** Plan-bucket scope (for a plan-track reversal to credit the bucket back). */
  planScope?: string | null;
};

export type SellerReconciliation = {
  sellerId: string;
  expectedUnpaid: number;
  actualUnpaid: number;
  ok: boolean;
};

export type PlatformReconciliation = {
  totalCollected: number;
  totalSellerCredit: number;
  recordedMargin: number;
  expectedMargin: number;
  solvent: boolean;
  marginMatches: boolean;
  ok: boolean;
};

export class SettlementLedger {
  private readonly db: SqliteDatabase;
  private readonly tx: <T>(fn: () => T) => T;

  constructor(
    database: Database,
    private readonly wallet: WalletService,
    private readonly earnings: SellerEarningsLedger,
    private readonly spendLedger: SpendLedgerService
  ) {
    this.db = database.db;
    this.tx = database.transaction.bind(database);
  }

  /** Append one settlement row. Returns its id. Asserts conservation. */
  record(rec: SettlementRecord): string {
    const id = `stl_${randomUUID()}`;
    this.db.prepare(
      `INSERT INTO settlement_log
        (id, ts, buyer_key_id, base_model, seller_id, prompt_tokens, completion_tokens,
         actual_sell_cost_micro, seller_credit_micro, platform_margin_micro, bill_track,
         reversed, plan_scope, collected_micro)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
    ).run(
      id,
      Date.now(),
      rec.buyerKeyId,
      rec.baseModel,
      rec.sellerId,
      rec.promptTokens,
      rec.completionTokens,
      usdToMicro(rec.collected),
      usdToMicro(rec.sellerCredit),
      usdToMicro(rec.platformMargin),
      rec.billTrack,
      rec.planScope ?? null,
      usdToMicro(rec.collected)
    );
    return id;
  }

  /**
   * Fully reverse one settlement row: refund the buyer the collected amount,
   * claw back the seller credit, and unwind the platform margin. Idempotent — a
   * row already flagged `reversed` is a no-op. Returns whether it reversed.
   */
  reverseSettlement(settlementId: string, reason?: string): boolean {
    return this.tx(() => {
      const row = this.db.prepare(
        `SELECT buyer_key_id, seller_id, collected_micro, seller_credit_micro,
                platform_margin_micro, bill_track, plan_scope, reversed
         FROM settlement_log WHERE id = ?`
      ).get(settlementId) as
        | {
            buyer_key_id: string;
            seller_id: string;
            collected_micro: number;
            seller_credit_micro: number;
            platform_margin_micro: number;
            bill_track: string;
            plan_scope: string | null;
            reversed: number;
          }
        | undefined;
      if (!row || row.reversed) return false;

      this.db.prepare("UPDATE settlement_log SET reversed = 1 WHERE id = ?").run(settlementId);

      // Refund the buyer: wallet track → credit the wallet; plan track → credit
      // the plan bucket back (negative settle on the scope, no real money moved).
      const collectedUsd = microToUsd(row.collected_micro);
      if (collectedUsd > 0) {
        if (row.bill_track === "plan" && row.plan_scope) {
          this.spendLedger.credit(row.plan_scope, collectedUsd);
        } else if (row.buyer_key_id) {
          this.wallet.refundUsd(row.buyer_key_id, collectedUsd, reason ?? `reverse:${settlementId}`);
        }
      }

      // Claw back the seller credit + unwind the platform margin.
      const creditUsd = microToUsd(row.seller_credit_micro);
      if (creditUsd > 0 && row.seller_id !== HOUSE_SELLER_ID) {
        this.earnings.reverse(row.seller_id, creditUsd, reason ?? "settlement_reversal", settlementId);
      }
      const marginUsd = microToUsd(row.platform_margin_micro);
      if (marginUsd !== 0) this.earnings.recordPlatformMargin(-marginUsd);

      return true;
    });
  }

  /** Reconcile one seller's unpaid against the log. */
  reconcileSeller(sellerId: string): SellerReconciliation {
    // Credits sum over ALL rows (reversed or not): a reversal is captured
    // incrementally by an earnings_reversals row, mirroring how the live ledger
    // claws back (credit added unpaid; reverse subtracted it). Filtering reversed
    // rows here AND subtracting reversals would double-count.
    const credits = (this.db.prepare(
      "SELECT COALESCE(SUM(seller_credit_micro),0) AS s FROM settlement_log WHERE seller_id = ?"
    ).get(sellerId) as { s: number }).s;
    const payouts = (this.db.prepare(
      "SELECT COALESCE(SUM(usd_micro),0) AS s FROM payouts WHERE seller_id = ?"
    ).get(sellerId) as { s: number }).s;
    const reversals = (this.db.prepare(
      "SELECT COALESCE(SUM(usd_micro),0) AS s FROM earnings_reversals WHERE seller_id = ? AND kind = 'reverse'"
    ).get(sellerId) as { s: number }).s;
    const payoutReversals = (this.db.prepare(
      "SELECT COALESCE(SUM(usd_micro),0) AS s FROM earnings_reversals WHERE seller_id = ? AND kind = 'payout_reversal'"
    ).get(sellerId) as { s: number }).s;

    // unpaid = credits − payouts + failed-payout-restorations − clawbacks
    const expectedMicro = Math.max(0, credits - payouts + payoutReversals - reversals);
    const expectedUnpaid = microToUsd(expectedMicro);
    const actualUnpaid = this.earnings.snapshot(sellerId).unpaid;
    return {
      sellerId,
      expectedUnpaid,
      actualUnpaid,
      ok: Math.abs(expectedUnpaid - actualUnpaid) < 1e-6
    };
  }

  /** Reconcile platform solvency from the log. */
  reconcilePlatform(): PlatformReconciliation {
    const totalCollectedMicro = (this.db.prepare(
      "SELECT COALESCE(SUM(collected_micro),0) AS s FROM settlement_log WHERE reversed = 0"
    ).get() as { s: number }).s;
    const totalCreditMicro = (this.db.prepare(
      "SELECT COALESCE(SUM(seller_credit_micro),0) AS s FROM settlement_log WHERE reversed = 0"
    ).get() as { s: number }).s;
    const recordedMargin = this.earnings.getPlatformMargin();
    const expectedMargin = microToUsd(totalCollectedMicro - totalCreditMicro);
    const totalCollected = microToUsd(totalCollectedMicro);
    const totalSellerCredit = microToUsd(totalCreditMicro);
    const solvent = totalCollectedMicro >= totalCreditMicro;
    const marginMatches = Math.abs(recordedMargin - expectedMargin) < 1e-6;
    return {
      totalCollected,
      totalSellerCredit,
      recordedMargin,
      expectedMargin,
      solvent,
      marginMatches,
      ok: solvent && marginMatches
    };
  }

  /**
   * Per-record settlement query for reconciliation replay (provision-read). Lets
   * the website rebuild exact buyer bills + seller credit for a window it missed
   * via webhook — every figure (collected, sellerCredit, platformMargin) is the
   * actually-recorded value, not an estimate. Newest-first, bounded.
   */
  query(q: { sellerId?: string; buyerKeyId?: string; since?: Date; limit?: number } = {}): {
    total: number;
    data: Array<{
      id: string;
      ts: number;
      buyerKeyId: string | null;
      baseModel: string | null;
      sellerId: string | null;
      promptTokens: number;
      completionTokens: number;
      collected: number;
      sellerCredit: number;
      platformMargin: number;
      billTrack: string | null;
      reversed: boolean;
    }>;
  } {
    const limit = Math.max(1, Math.min(q.limit ?? 100, 1000));
    const where: string[] = [];
    const params: Array<string | number> = [];
    if (q.sellerId) { where.push("seller_id = ?"); params.push(q.sellerId); }
    if (q.buyerKeyId) { where.push("buyer_key_id = ?"); params.push(q.buyerKeyId); }
    if (q.since) { where.push("ts >= ?"); params.push(q.since.getTime()); }
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const total = (this.db.prepare(`SELECT COUNT(*) AS c FROM settlement_log ${clause}`).get(...params) as { c: number }).c;
    const rows = this.db.prepare(
      `SELECT id, ts, buyer_key_id, base_model, seller_id, prompt_tokens, completion_tokens,
              collected_micro, seller_credit_micro, platform_margin_micro, bill_track, reversed
       FROM settlement_log ${clause} ORDER BY ts DESC LIMIT ?`
    ).all(...params, limit) as Array<{
      id: string; ts: number; buyer_key_id: string | null; base_model: string | null;
      seller_id: string | null; prompt_tokens: number; completion_tokens: number;
      collected_micro: number; seller_credit_micro: number; platform_margin_micro: number;
      bill_track: string | null; reversed: number;
    }>;

    return {
      total,
      data: rows.map((r) => ({
        id: r.id,
        ts: r.ts,
        buyerKeyId: r.buyer_key_id,
        baseModel: r.base_model,
        sellerId: r.seller_id,
        promptTokens: r.prompt_tokens,
        completionTokens: r.completion_tokens,
        collected: microToUsd(r.collected_micro),
        sellerCredit: microToUsd(r.seller_credit_micro),
        platformMargin: microToUsd(r.platform_margin_micro),
        billTrack: r.bill_track,
        reversed: r.reversed === 1
      }))
    };
  }
}
