/**
 * WalletService — usd-wallet (marketplace #1).
 *
 * Single source of truth for per-key prepaid USD balances, stored as integer
 * micro-USD to eliminate float drift. Supports the hold-and-settle pattern
 * (reserve an upper-bound, settle to actual, or release on failure) mirroring
 * SpendLedgerService so a PAYG request can hold against both the spend bucket
 * and the wallet and roll back symmetrically.
 *
 * Wallet states:
 *   - unprovisioned (no entry)      → PAYG not available; hasFundsUsd → false
 *   - provisioned + empty (0)       → PAYG available, no funds → 402
 *   - funded (> 0)                  → spendable
 *
 * A balance never goes below zero. State persists via the engine's
 * persist callback (debounced), same as SpendLedgerService.
 */

import { randomUUID } from "node:crypto";
import { microToUsd, usdToMicro } from "../utils/money.js";

export type WalletReservation = {
  id: string;
  keyId: string;
  estimateMicro: number;
  createdAt: number; // ms
};

export type ReserveUsdResult =
  | { ok: true; reservationId: string }
  | { ok: false; reason: "insufficient_funds"; balanceUsd: number };

export type PersistedWallet = {
  balances: Record<string, number>; // keyId → micro-USD
};

export class WalletService {
  /** keyId → balance in integer micro-USD. Absence = unprovisioned wallet. */
  private readonly balances = new Map<string, number>();
  private readonly reservations = new Map<string, WalletReservation>();
  private dirty = false;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private onPersist?: () => void;

  setPersistCallback(cb: () => void): void {
    this.onPersist = cb;
  }

  private scheduleSave(): void {
    this.dirty = true;
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      if (this.dirty && this.onPersist) {
        this.dirty = false;
        this.onPersist();
      }
    }, 5000);
  }

  /** Current balance in USD. Returns 0 for an unprovisioned wallet. */
  getUsd(keyId: string): number {
    const micro = this.balances.get(keyId);
    return micro === undefined ? 0 : microToUsd(micro);
  }

  /** Whether the key has a wallet at all (even if empty). */
  isProvisioned(keyId: string): boolean {
    return this.balances.has(keyId);
  }

  /** Open an empty wallet ($0) if one does not already exist. Idempotent. */
  open(keyId: string): void {
    if (!this.balances.has(keyId)) {
      this.balances.set(keyId, 0);
      this.scheduleSave();
    }
  }

  /** Add USD to a wallet (provisioning it if absent). Returns new balance USD. */
  topupUsd(keyId: string, usd: number): number {
    const add = usdToMicro(usd);
    const next = (this.balances.get(keyId) ?? 0) + add;
    this.balances.set(keyId, next);
    this.scheduleSave();
    return microToUsd(next);
  }

  /**
   * Debit USD, floored at zero. ok:false (and no debit) if the wallet cannot
   * fully cover the amount.
   */
  debitUsd(keyId: string, usd: number): { ok: boolean; newBalanceUsd: number } {
    const cost = usdToMicro(usd);
    const current = this.balances.get(keyId) ?? 0;
    if (current < cost) {
      return { ok: false, newBalanceUsd: microToUsd(current) };
    }
    const next = current - cost;
    this.balances.set(keyId, next);
    this.scheduleSave();
    return { ok: true, newBalanceUsd: microToUsd(next) };
  }

  /**
   * Funds check. False for an unprovisioned wallet AND for a provisioned wallet
   * whose balance is below the requirement. True only when a provisioned wallet
   * has at least the required amount.
   */
  hasFundsUsd(keyId: string, requiredUsd: number): boolean {
    const micro = this.balances.get(keyId);
    if (micro === undefined) return false;
    return micro >= usdToMicro(requiredUsd);
  }

  /**
   * Reserve an upper-bound estimate. Deducts immediately so concurrent requests
   * cannot reserve the same funds twice. ok:false if the wallet is unprovisioned
   * or cannot cover the estimate.
   */
  reserveUsd(args: { keyId: string; estimateUsd: number }): ReserveUsdResult {
    const micro = this.balances.get(args.keyId);
    const estimate = usdToMicro(args.estimateUsd);
    if (micro === undefined || micro < estimate) {
      return {
        ok: false,
        reason: "insufficient_funds",
        balanceUsd: micro === undefined ? 0 : microToUsd(micro)
      };
    }
    this.balances.set(args.keyId, micro - estimate);
    const id = `wres_${randomUUID()}`;
    this.reservations.set(id, {
      id,
      keyId: args.keyId,
      estimateMicro: estimate,
      createdAt: Date.now()
    });
    this.scheduleSave();
    return { ok: true, reservationId: id };
  }

  /**
   * Settle a reservation to the actual cost. Refunds (estimate − actual) when
   * the actual is less than reserved. If actual exceeds the estimate, the extra
   * is debited (floored at zero).
   */
  settleUsd(reservationId: string, actualUsd: number): void {
    const r = this.reservations.get(reservationId);
    if (!r) return;
    this.reservations.delete(reservationId);
    const actual = usdToMicro(actualUsd);
    const refund = r.estimateMicro - actual; // may be negative (extra debit)
    const current = this.balances.get(r.keyId) ?? 0;
    const next = Math.max(0, current + refund);
    this.balances.set(r.keyId, next);
    this.scheduleSave();
  }

  /** Release a reservation without spending — refunds the full estimate. */
  releaseUsd(reservationId: string): void {
    const r = this.reservations.get(reservationId);
    if (!r) return;
    this.reservations.delete(reservationId);
    const current = this.balances.get(r.keyId) ?? 0;
    this.balances.set(r.keyId, current + r.estimateMicro);
    this.scheduleSave();
  }

  toPersisted(): PersistedWallet {
    const out: PersistedWallet = { balances: {} };
    for (const [k, v] of this.balances) out.balances[k] = v;
    return out;
  }

  load(state: PersistedWallet | undefined | null): void {
    this.balances.clear();
    if (!state || !state.balances) return;
    for (const [k, v] of Object.entries(state.balances)) {
      if (typeof v === "number" && Number.isFinite(v)) {
        this.balances.set(k, v);
      }
    }
  }

  /** Test helper. */
  clear(): void {
    this.balances.clear();
    this.reservations.clear();
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
  }
}
