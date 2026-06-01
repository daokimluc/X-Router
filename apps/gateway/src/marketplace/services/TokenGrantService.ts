/**
 * TokenGrantService — marketplace-token-packs.
 *
 * Owns prepaid per-(key, baseModel) token packs: a finite token balance a buyer
 * bought through Foza (which calls POST /provision/token-pack AFTER collecting
 * payment). x-router meters consumption against the pack and credits the serving
 * seller, but never charges the buyer's wallet for a pack request.
 *
 * Grants live in SQLite (token_grants); a pack reservation is ALSO persisted
 * (token_grant_reservations, Database v8) and swept back to the grant at boot, so
 * a crash between reserve and settle does not permanently consume buyer-paid
 * tokens. tokens_remaining is decremented by the estimate at reserve and corrected
 * by (estimate − actual) at settle. An in-memory map mirrors the rows as a fast
 * path; a settle/release after a restart reads the estimate from the row.
 */

import { randomUUID } from "node:crypto";
import type { Database, SqliteDatabase } from "../../services/Database.js";
import { microToUsd, usdToMicro } from "../utils/money.js";

export type TokenGrant = {
  id: string;
  keyId: string;
  baseModel: string;
  tokensTotal: number;
  tokensRemaining: number;
  pricePaidUsd: number;
  expiresAt: number; // epoch-ms
  createdAt: number; // epoch-ms
  idempotencyKey: string;
};

type GrantRow = {
  id: string;
  key_id: string;
  base_model: string;
  tokens_total: number;
  tokens_remaining: number;
  price_paid_micro: number;
  expires_at: number;
  created_at: number;
  idempotency_key: string;
};

export class TokenGrantService {
  private readonly db: SqliteDatabase;
  private readonly tx: <T>(fn: () => T) => T;
  /** In-memory holds: reservationId → {grantId, estTokens}. */
  private readonly reservations = new Map<string, { grantId: string; estTokens: number }>();
  private readonly now: () => number;

  constructor(database: Database, opts: { now?: () => number } = {}) {
    this.db = database.db;
    this.tx = database.transaction.bind(database);
    this.now = opts.now ?? (() => Date.now());
  }

  private rowToGrant(r: GrantRow): TokenGrant {
    return {
      id: r.id,
      keyId: r.key_id,
      baseModel: r.base_model,
      tokensTotal: r.tokens_total,
      tokensRemaining: r.tokens_remaining,
      pricePaidUsd: microToUsd(r.price_paid_micro),
      expiresAt: r.expires_at,
      createdAt: r.created_at,
      idempotencyKey: r.idempotency_key
    };
  }

  /**
   * Issue a pack, idempotent on `idempotencyKey`. A repeated call returns the
   * existing grant without crediting a second one (Foza-retry safe).
   */
  grant(input: {
    keyId: string;
    baseModel: string;
    tokens: number;
    pricePaidUsd: number;
    expiresAt: number;
    idempotencyKey: string;
  }): TokenGrant {
    return this.tx(() => {
      const existing = this.db
        .prepare("SELECT * FROM token_grants WHERE idempotency_key = ?")
        .get(input.idempotencyKey) as GrantRow | undefined;
      if (existing) return this.rowToGrant(existing);

      const id = `tg_${randomUUID()}`;
      const now = this.now();
      this.db.prepare(
        `INSERT INTO token_grants
          (id, key_id, base_model, tokens_total, tokens_remaining, price_paid_micro,
           expires_at, created_at, idempotency_key)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        id,
        input.keyId,
        input.baseModel,
        input.tokens,
        input.tokens,
        usdToMicro(input.pricePaidUsd),
        input.expiresAt,
        now,
        input.idempotencyKey
      );
      const row = this.db.prepare("SELECT * FROM token_grants WHERE id = ?").get(id) as GrantRow;
      return this.rowToGrant(row);
    });
  }

  /**
   * The best usable pack for (keyId, baseModel): un-expired with tokens left.
   * When an `estTokens` is given (marketplace-money-hardening-2 M5), prefer the
   * SOONEST-expiring pack that can still cover the request, so near-expiry
   * buyer-paid tokens are consumed before they lapse; fall back to most-remaining
   * when no single pack covers the estimate (supports the no-split rule). null
   * when none usable.
   */
  findUsable(keyId: string, baseModel: string, estTokens?: number): TokenGrant | null {
    const now = this.now();
    if (typeof estTokens === "number" && estTokens > 0) {
      const covering = this.db.prepare(
        `SELECT * FROM token_grants
         WHERE key_id = ? AND base_model = ? AND expires_at > ? AND tokens_remaining >= ?
         ORDER BY expires_at ASC LIMIT 1`
      ).get(keyId, baseModel, now, estTokens) as GrantRow | undefined;
      if (covering) return this.rowToGrant(covering);
    }
    const row = this.db.prepare(
      `SELECT * FROM token_grants
       WHERE key_id = ? AND base_model = ? AND expires_at > ? AND tokens_remaining > 0
       ORDER BY tokens_remaining DESC LIMIT 1`
    ).get(keyId, baseModel, now) as GrantRow | undefined;
    return row ? this.rowToGrant(row) : null;
  }

  /**
   * Reserve an upper-bound token estimate against a grant. Re-reads the balance in
   * the transaction so two concurrent requests can't both take the last tokens.
   * The reservation is persisted (token_grant_reservations) so a crash before
   * settle is recoverable by the boot sweep. ok:false (no decrement) when the
   * grant can't cover the estimate — the caller then falls through to plan/PAYG.
   */
  reserve(args: { grantId: string; estTokens: number }): { ok: true; reservationId: string } | { ok: false } {
    return this.tx<{ ok: true; reservationId: string } | { ok: false }>(() => {
      const row = this.db.prepare("SELECT tokens_remaining FROM token_grants WHERE id = ?").get(args.grantId) as
        | { tokens_remaining: number }
        | undefined;
      if (!row || row.tokens_remaining < args.estTokens) return { ok: false };
      this.db.prepare("UPDATE token_grants SET tokens_remaining = tokens_remaining - ? WHERE id = ?")
        .run(args.estTokens, args.grantId);
      const reservationId = `tgr_${randomUUID()}`;
      this.db.prepare(
        "INSERT INTO token_grant_reservations (id, grant_id, est_tokens, created_at) VALUES (?, ?, ?, ?)"
      ).run(reservationId, args.grantId, args.estTokens, this.now());
      this.reservations.set(reservationId, { grantId: args.grantId, estTokens: args.estTokens });
      return { ok: true, reservationId };
    });
  }

  /** Resolve a held reservation from the in-memory map or (post-restart) the row. */
  private holdFor(reservationId: string): { grantId: string; estTokens: number } | undefined {
    const mem = this.reservations.get(reservationId);
    if (mem) return mem;
    const row = this.db.prepare(
      "SELECT grant_id, est_tokens FROM token_grant_reservations WHERE id = ?"
    ).get(reservationId) as { grant_id: string; est_tokens: number } | undefined;
    return row ? { grantId: row.grant_id, estTokens: row.est_tokens } : undefined;
  }

  /**
   * Settle a reservation to the actual token count: correct the grant by
   * (estimate − actual), floored at 0. Returns the number of tokens OVER-DELIVERED
   * (served beyond what the grant could cover — normally 0); the caller can record
   * it for audit (marketplace-money-hardening-2 M6). No-op (returns 0) for an
   * unknown id (double-settle safe).
   */
  settle(reservationId: string, actualTokens: number): number {
    const hold = this.holdFor(reservationId);
    if (!hold) return 0;
    this.reservations.delete(reservationId);
    return this.tx<number>(() => {
      this.db.prepare("DELETE FROM token_grant_reservations WHERE id = ?").run(reservationId);
      const row = this.db.prepare("SELECT tokens_remaining FROM token_grants WHERE id = ?").get(hold.grantId) as
        | { tokens_remaining: number }
        | undefined;
      if (!row) return 0;
      // We decremented by estTokens at reserve; give back (est − actual). If actual
      // exceeds est + what's left, the grant floors at 0 and the remainder is
      // over-delivered (served free) — reported, not hidden.
      const refund = hold.estTokens - actualTokens;
      const raw = row.tokens_remaining + refund;
      const next = Math.max(0, raw);
      this.db.prepare("UPDATE token_grants SET tokens_remaining = ? WHERE id = ?").run(next, hold.grantId);
      return raw < 0 ? -raw : 0;
    });
  }

  /** Release a reservation without spending — returns the held estimate. */
  release(reservationId: string): void {
    const hold = this.holdFor(reservationId);
    if (!hold) return;
    this.reservations.delete(reservationId);
    this.tx(() => {
      this.db.prepare("DELETE FROM token_grant_reservations WHERE id = ?").run(reservationId);
      const row = this.db.prepare("SELECT tokens_remaining, tokens_total FROM token_grants WHERE id = ?").get(hold.grantId) as
        | { tokens_remaining: number; tokens_total: number }
        | undefined;
      if (!row) return;
      const next = Math.min(row.tokens_total, row.tokens_remaining + hold.estTokens);
      this.db.prepare("UPDATE token_grants SET tokens_remaining = ? WHERE id = ?").run(next, hold.grantId);
    });
  }

  /**
   * Re-credit consumed tokens to a grant (marketplace-money-hardening-2 M4) — used
   * when a token-pack settlement is reversed. Capped at the grant's total. No-op
   * for an unknown grant or non-positive amount.
   */
  recredit(grantId: string, tokens: number): void {
    if (tokens <= 0) return;
    this.tx(() => {
      const row = this.db.prepare("SELECT tokens_remaining, tokens_total FROM token_grants WHERE id = ?").get(grantId) as
        | { tokens_remaining: number; tokens_total: number }
        | undefined;
      if (!row) return;
      const next = Math.min(row.tokens_total, row.tokens_remaining + tokens);
      this.db.prepare("UPDATE token_grants SET tokens_remaining = ? WHERE id = ?").run(next, grantId);
    });
  }

  /**
   * Release reservations older than `olderThanMs` (default: all) back to their
   * grant, returning held tokens. Run at boot — a pack reserved before a crash
   * that never settled is recovered (mirrors WalletService.sweepReservations).
   */
  sweepReservations(olderThanMs = 0): number {
    return this.tx<number>(() => {
      const cutoff = this.now() - olderThanMs;
      const rows = this.db.prepare(
        "SELECT id, grant_id, est_tokens FROM token_grant_reservations WHERE created_at <= ?"
      ).all(cutoff) as Array<{ id: string; grant_id: string; est_tokens: number }>;
      for (const r of rows) {
        const g = this.db.prepare("SELECT tokens_remaining, tokens_total FROM token_grants WHERE id = ?").get(r.grant_id) as
          | { tokens_remaining: number; tokens_total: number }
          | undefined;
        if (g) {
          const next = Math.min(g.tokens_total, g.tokens_remaining + r.est_tokens);
          this.db.prepare("UPDATE token_grants SET tokens_remaining = ? WHERE id = ?").run(next, r.grant_id);
        }
        this.db.prepare("DELETE FROM token_grant_reservations WHERE id = ?").run(r.id);
        this.reservations.delete(r.id);
      }
      return rows.length;
    });
  }

  /** A key's packs, un-expired first then newest, for the read surface. */
  listForKey(keyId: string): TokenGrant[] {
    const rows = this.db.prepare(
      "SELECT * FROM token_grants WHERE key_id = ? ORDER BY (expires_at > ?) DESC, created_at DESC"
    ).all(keyId, this.now()) as GrantRow[];
    return rows.map((r) => this.rowToGrant(r));
  }
}
