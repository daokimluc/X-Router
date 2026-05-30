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

  /** Funds check — false for unprovisioned or underfunded. */
  hasFundsUsd(keyId: string, requiredUsd: number): boolean {
    const micro = this.balanceMicro(keyId);
    if (micro === undefined) return false;
    return micro >= usdToMicro(requiredUsd);
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
   * < estimate; debits the extra (floored at 0) when actual > estimate.
   */
  settleUsd(reservationId: string, actualUsd: number): void {
    const actual = usdToMicro(actualUsd);
    this.tx(() => {
      const r = this.db.prepare("SELECT key_id, estimate_micro FROM wallet_reservations WHERE id = ?").get(reservationId) as
        | { key_id: string; estimate_micro: number }
        | undefined;
      if (!r) return;
      this.db.prepare("DELETE FROM wallet_reservations WHERE id = ?").run(reservationId);
      const current = this.balanceMicro(r.key_id) ?? 0;
      const next = Math.max(0, current + (r.estimate_micro - actual));
      this.db.prepare("UPDATE wallets SET balance_micro = ? WHERE key_id = ?").run(next, r.key_id);
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
