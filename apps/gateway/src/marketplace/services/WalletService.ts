/**
 * WalletService — usd-wallet (#1), SQLite-backed (persistence-sqlite).
 *
 * Per-key prepaid USD balances + hold-and-settle reservations, stored as integer
 * micro-USD in SQLite. Writes are synchronous + atomic (transactions): a
 * committed balance survives crash, concurrent in-process requests cannot reserve
 * the same funds twice, and reservations are persisted rows so a restart between
 * reserve and settle no longer orphans a debit.
 *
 * This change swaps ONLY the storage substrate; the public interface is identical
 * to the prior in-memory version (settleUsd still returns void). Refund /
 * settle-returns-collected land in money-correctness (#2).
 *
 * Wallet states: unprovisioned (no row) / provisioned-empty (0) / funded (>0).
 * Balance never goes below zero.
 */

import { randomUUID } from "node:crypto";
import type { Database, SqliteDatabase } from "../../services/Database.js";
import { microToUsd, usdToMicro } from "../utils/money.js";

export type ReserveUsdResult =
  | { ok: true; reservationId: string }
  | { ok: false; reason: "insufficient_funds"; balanceUsd: number };

/** Legacy shape, kept only for the one-time JSON→SQLite migration import. */
export type PersistedWallet = {
  balances: Record<string, number>;
};

export class WalletService {
  private readonly db: SqliteDatabase;
  private readonly tx: <T>(fn: () => T) => T;

  constructor(database: Database) {
    this.db = database.db;
    this.tx = database.transaction.bind(database);
  }

  private balanceMicro(keyId: string): number | undefined {
    const row = this.db.prepare("SELECT balance_micro FROM wallets WHERE key_id = ?").get(keyId) as
      | { balance_micro: number }
      | undefined;
    return row?.balance_micro;
  }

  /** Current balance in USD. Returns 0 for an unprovisioned wallet. */
  getUsd(keyId: string): number {
    const micro = this.balanceMicro(keyId);
    return micro === undefined ? 0 : microToUsd(micro);
  }

  /** Whether the key has a wallet row at all (even if empty). */
  isProvisioned(keyId: string): boolean {
    return this.balanceMicro(keyId) !== undefined;
  }

  /** Open an empty wallet ($0) if absent. Idempotent. */
  open(keyId: string): void {
    this.db.prepare("INSERT OR IGNORE INTO wallets (key_id, balance_micro) VALUES (?, 0)").run(keyId);
  }

  /** Add USD to a wallet (provisioning if absent). Returns new balance USD. */
  topupUsd(keyId: string, usd: number): number {
    const add = usdToMicro(usd);
    return this.tx(() => {
      this.db.prepare(
        `INSERT INTO wallets (key_id, balance_micro) VALUES (?, ?)
         ON CONFLICT(key_id) DO UPDATE SET balance_micro = balance_micro + excluded.balance_micro`
      ).run(keyId, add);
      return microToUsd(this.balanceMicro(keyId) ?? 0);
    });
  }

  /** Debit USD, floored at zero. ok:false (no debit) if underfunded. */
  debitUsd(keyId: string, usd: number): { ok: boolean; newBalanceUsd: number } {
    const cost = usdToMicro(usd);
    return this.tx(() => {
      const current = this.balanceMicro(keyId) ?? 0;
      if (current < cost) {
        return { ok: false, newBalanceUsd: microToUsd(current) };
      }
      const next = current - cost;
      this.db.prepare("UPDATE wallets SET balance_micro = ? WHERE key_id = ?").run(next, keyId);
      return { ok: true, newBalanceUsd: microToUsd(next) };
    });
  }

  /**
   * Charge a subscription fee with a DURABLE per-period idempotency guard
   * (marketplace-money-hardening C1). The wallet debit, the `wallet_ledger` row,
   * AND a `plan_charges` row `(keyId, planId, periodEnd, kind)` all commit in ONE
   * transaction. The `plan_charges` UNIQUE constraint is the integrity boundary:
   * if a charge for this exact period already exists (e.g. a renewal that
   * committed before a restart, replayed against a stale in-memory period), the
   * insert conflicts → we roll back the would-be debit and return
   * `{ ok:true, alreadyCharged:true }` so the caller treats it as an idempotent
   * no-op instead of debiting twice. Underfunded → `{ ok:false }`, no mutation.
   */
  chargeForPeriod(
    keyId: string,
    usd: number,
    period: { planId: string; periodEnd: number; kind: "subscribe" | "renew" }
  ): { ok: boolean; alreadyCharged?: boolean; newBalanceUsd: number } {
    return this.tx(() => {
      // Already charged this exact period? → idempotent no-op (no second debit).
      const existing = this.db.prepare(
        "SELECT 1 FROM plan_charges WHERE key_id = ? AND plan_id = ? AND period_end = ? AND kind = ?"
      ).get(keyId, period.planId, period.periodEnd, period.kind);
      if (existing) {
        return { ok: true, alreadyCharged: true, newBalanceUsd: this.getUsd(keyId) };
      }
      if (usd <= 0) {
        // Free period: record the (zero) charge token so the period is still
        // guarded against a duplicate, but move no money.
        this.recordPlanCharge(keyId, period, 0);
        return { ok: true, newBalanceUsd: this.getUsd(keyId) };
      }
      const cost = usdToMicro(usd);
      const current = this.balanceMicro(keyId);
      if (current === undefined || current < cost) {
        return { ok: false, newBalanceUsd: current === undefined ? 0 : microToUsd(current) };
      }
      const next = current - cost;
      this.db.prepare("UPDATE wallets SET balance_micro = ? WHERE key_id = ?").run(next, keyId);
      this.db.prepare(
        "INSERT INTO wallet_ledger (id, key_id, delta_micro, kind, reason, ts) VALUES (?, ?, ?, 'charge', ?, ?)"
      ).run(`wl_${randomUUID()}`, keyId, -cost, `plan_${period.kind}:${period.planId}`, Date.now());
      this.recordPlanCharge(keyId, period, cost);
      return { ok: true, newBalanceUsd: microToUsd(next) };
    });
  }

  private recordPlanCharge(
    keyId: string,
    period: { planId: string; periodEnd: number; kind: string },
    amountMicro: number
  ): void {
    this.db.prepare(
      "INSERT INTO plan_charges (id, key_id, plan_id, period_end, kind, amount_micro, ts) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(`pc_${randomUUID()}`, keyId, period.planId, period.periodEnd, period.kind, amountMicro, Date.now());
  }

  /**
   * Durable subscribe idempotency (marketplace-money-hardening C1b). A subscribe
   * computes its period from `now`, so an exact-period token can't dedupe a
   * re-subscribe at a different time after a crash that lost the plan binding.
   * This returns the period_end of an existing un-expired charge for
   * `(keyId, planId)` — i.e. "the buyer already paid for a still-active period of
   * this plan" — so the caller can rebind the plan WITHOUT charging again. Null if
   * no active paid period exists (a genuine fresh subscribe).
   */
  activeChargedPeriodEnd(keyId: string, planId: string, now: number): number | null {
    const row = this.db.prepare(
      "SELECT period_end FROM plan_charges WHERE key_id = ? AND plan_id = ? AND period_end > ? ORDER BY period_end DESC LIMIT 1"
    ).get(keyId, planId, now) as { period_end: number } | undefined;
    return row?.period_end ?? null;
  }

  /** Funds check — false for unprovisioned or underfunded. */
  hasFundsUsd(keyId: string, requiredUsd: number): boolean {
    const micro = this.balanceMicro(keyId);
    if (micro === undefined) return false;
    return micro >= usdToMicro(requiredUsd);
  }

  /**
   * Charge USD all-or-nothing (marketplace-plan-subscription): a subscription
   * fee must be charged in full or not at all — unlike `debitUsd`, this never
   * floors a partial charge to zero. Funds-check + debit + an audited
   * `wallet_ledger` row (`kind:'charge'`) happen in one transaction so a
   * concurrent reserve can't pass the check then drain the balance. `ok:false`
   * leaves the wallet untouched and writes no ledger row.
   */
  chargeUsd(keyId: string, usd: number, reason: string): { ok: boolean; newBalanceUsd: number } {
    if (usd <= 0) return { ok: true, newBalanceUsd: this.getUsd(keyId) };
    const cost = usdToMicro(usd);
    return this.tx(() => {
      const current = this.balanceMicro(keyId);
      if (current === undefined || current < cost) {
        return { ok: false, newBalanceUsd: current === undefined ? 0 : microToUsd(current) };
      }
      const next = current - cost;
      this.db.prepare("UPDATE wallets SET balance_micro = ? WHERE key_id = ?").run(next, keyId);
      this.db.prepare(
        "INSERT INTO wallet_ledger (id, key_id, delta_micro, kind, reason, ts) VALUES (?, ?, ?, 'charge', ?, ?)"
      ).run(`wl_${randomUUID()}`, keyId, -cost, reason, Date.now());
      return { ok: true, newBalanceUsd: microToUsd(next) };
    });
  }

  /**
   * Reserve an upper-bound estimate atomically: check funds, debit, insert the
   * reservation row — one transaction. ok:false if unprovisioned/underfunded.
   */
  reserveUsd(args: { keyId: string; estimateUsd: number }): ReserveUsdResult {
    const estimate = usdToMicro(args.estimateUsd);
    return this.tx<ReserveUsdResult>(() => {
      const micro = this.balanceMicro(args.keyId);
      if (micro === undefined || micro < estimate) {
        return {
          ok: false,
          reason: "insufficient_funds",
          balanceUsd: micro === undefined ? 0 : microToUsd(micro)
        };
      }
      this.db.prepare("UPDATE wallets SET balance_micro = ? WHERE key_id = ?").run(micro - estimate, args.keyId);
      const id = `wres_${randomUUID()}`;
      this.db.prepare(
        "INSERT INTO wallet_reservations (id, key_id, estimate_micro, created_at) VALUES (?, ?, ?, ?)"
      ).run(id, args.keyId, estimate, Date.now());
      return { ok: true, reservationId: id };
    });
  }

  /**
   * Settle a reservation to actual cost. Refunds (estimate − actual) when actual
   * < estimate; debits the extra (floored at 0) when actual > estimate. Returns
   * the amount actually COLLECTED for this reservation in USD — i.e. the net
   * removed from the wallet across reserve+settle. When the wallet floored at
   * zero, collected is less than `actualUsd` (the buyer is charged only what they
   * had), which is what conservation in money-correctness (#2) keys off.
   */
  settleUsd(reservationId: string, actualUsd: number): number {
    const actual = usdToMicro(actualUsd);
    return this.tx<number>(() => {
      const r = this.db.prepare("SELECT key_id, estimate_micro FROM wallet_reservations WHERE id = ?").get(reservationId) as
        | { key_id: string; estimate_micro: number }
        | undefined;
      if (!r) return 0;
      this.db.prepare("DELETE FROM wallet_reservations WHERE id = ?").run(reservationId);
      const current = this.balanceMicro(r.key_id) ?? 0;
      const next = Math.max(0, current + (r.estimate_micro - actual));
      this.db.prepare("UPDATE wallets SET balance_micro = ? WHERE key_id = ?").run(next, r.key_id);
      // collected = held estimate minus the amount refunded (next − current).
      // Floors naturally: if the extra debit hit the zero floor, collected is
      // capped at what the wallet actually held (estimate + current).
      const collected = r.estimate_micro - (next - current);
      return microToUsd(Math.max(0, collected));
    });
  }

  /** Release a reservation without spending — refunds the full estimate. */
  releaseUsd(reservationId: string): void {
    this.tx(() => {
      const r = this.db.prepare("SELECT key_id, estimate_micro FROM wallet_reservations WHERE id = ?").get(reservationId) as
        | { key_id: string; estimate_micro: number }
        | undefined;
      if (!r) return;
      this.db.prepare("DELETE FROM wallet_reservations WHERE id = ?").run(reservationId);
      const current = this.balanceMicro(r.key_id) ?? 0;
      this.db.prepare("UPDATE wallets SET balance_micro = ? WHERE key_id = ?").run(current + r.estimate_micro, r.key_id);
    });
  }

  /**
   * Refund USD back to a wallet (money-correctness #2) — credit a prior charge
   * back, distinct from `topupUsd` (buyer paying more in). Provisions the wallet
   * if absent, appends an audited `wallet_ledger` row, and returns the new
   * balance. Non-negative amounts only. Used by admin refund + full settlement
   * reversal.
   */
  refundUsd(keyId: string, usd: number, reason?: string): number {
    if (usd <= 0) return this.getUsd(keyId);
    const add = usdToMicro(usd);
    return this.tx(() => {
      this.db.prepare(
        `INSERT INTO wallets (key_id, balance_micro) VALUES (?, ?)
         ON CONFLICT(key_id) DO UPDATE SET balance_micro = balance_micro + excluded.balance_micro`
      ).run(keyId, add);
      this.db.prepare(
        "INSERT INTO wallet_ledger (id, key_id, delta_micro, kind, reason, ts) VALUES (?, ?, ?, 'refund', ?, ?)"
      ).run(`wl_${randomUUID()}`, keyId, add, reason ?? null, Date.now());
      return microToUsd(this.balanceMicro(keyId) ?? 0);
    });
  }

  /** Audited wallet movements for a key (refunds etc.), newest first. */
  ledgerFor(keyId: string): Array<{ id: string; deltaUsd: number; kind: string; reason: string | null; ts: number }> {
    const rows = this.db.prepare(
      "SELECT id, delta_micro, kind, reason, ts FROM wallet_ledger WHERE key_id = ? ORDER BY ts DESC"
    ).all(keyId) as Array<{ id: string; delta_micro: number; kind: string; reason: string | null; ts: number }>;
    return rows.map((r) => ({ id: r.id, deltaUsd: microToUsd(r.delta_micro), kind: r.kind, reason: r.reason, ts: r.ts }));
  }

  /**
   * Release reservations older than `olderThanMs` (default: all), returning held
   * funds. Run at boot — an in-flight hold that didn't survive a restart is freed.
   */
  sweepReservations(olderThanMs = 0): number {
    return this.tx<number>(() => {
      const cutoff = Date.now() - olderThanMs;
      const rows = this.db.prepare("SELECT id, key_id, estimate_micro FROM wallet_reservations WHERE created_at <= ?").all(cutoff) as Array<{ id: string; key_id: string; estimate_micro: number }>;
      for (const r of rows) {
        const current = this.balanceMicro(r.key_id) ?? 0;
        this.db.prepare("UPDATE wallets SET balance_micro = ? WHERE key_id = ?").run(current + r.estimate_micro, r.key_id);
        this.db.prepare("DELETE FROM wallet_reservations WHERE id = ?").run(r.id);
      }
      return rows.length;
    });
  }

  /** One-time import from the legacy JSON wallet slice. Idempotent per key. */
  importLegacy(state: PersistedWallet | undefined | null): void {
    if (!state?.balances) return;
    this.tx(() => {
      for (const [k, v] of Object.entries(state.balances)) {
        if (typeof v === "number" && Number.isFinite(v)) {
          this.db.prepare("INSERT OR IGNORE INTO wallets (key_id, balance_micro) VALUES (?, ?)").run(k, v);
        }
      }
    });
  }
}
