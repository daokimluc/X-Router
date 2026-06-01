/**
 * TokenGrantService — marketplace-token-packs.
 *
 * Owns prepaid per-(key, baseModel) token packs: a finite token balance a buyer
 * bought through Foza (which calls POST /provision/token-pack AFTER collecting
 * payment). x-router meters consumption against the pack and credits the serving
 * seller, but never charges the buyer's wallet for a pack request.
 *
 * Grants live in SQLite (token_grants); a pack RESERVATION is held in memory
 * (like SpendLedgerService's plan-bucket counter, not the wallet's persisted-row
 * model) — a pack is a usage counter, not locked money, so a crash mid-request
 * over-counts a pack by at most one in-flight estimate, which is acceptable and
 * needs no boot sweep. tokens_remaining is decremented by the estimate at reserve
 * and corrected by (estimate − actual) at settle.
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
   * The best usable pack for (keyId, baseModel): un-expired with tokens left,
   * most-remaining first (so a request is most likely to fit one pack — supports
   * the no-split rule). null when none.
   */
  findUsable(keyId: string, baseModel: string): TokenGrant | null {
    const row = this.db.prepare(
      `SELECT * FROM token_grants
       WHERE key_id = ? AND base_model = ? AND expires_at > ? AND tokens_remaining > 0
       ORDER BY tokens_remaining DESC LIMIT 1`
    ).get(keyId, baseModel, this.now()) as GrantRow | undefined;
    return row ? this.rowToGrant(row) : null;
  }

  /**
   * Reserve an upper-bound token estimate against a grant. Re-reads the balance in
   * the transaction so two concurrent requests can't both take the last tokens.
   * ok:false (no decrement) when the grant can't cover the estimate — the caller
   * then falls through to plan/PAYG (no split).
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
      this.reservations.set(reservationId, { grantId: args.grantId, estTokens: args.estTokens });
      return { ok: true, reservationId };
    });
  }

  /**
   * Settle a reservation to the actual token count: correct the grant by
   * (estimate − actual), floored at 0. No-op for an unknown id (double-settle safe).
   */
  settle(reservationId: string, actualTokens: number): void {
    const hold = this.reservations.get(reservationId);
    if (!hold) return;
    this.reservations.delete(reservationId);
    this.tx(() => {
      const row = this.db.prepare("SELECT tokens_remaining FROM token_grants WHERE id = ?").get(hold.grantId) as
        | { tokens_remaining: number }
        | undefined;
      if (!row) return;
      // We decremented by estTokens at reserve; give back (est − actual), floored.
      const refund = hold.estTokens - actualTokens;
      const next = Math.max(0, row.tokens_remaining + refund);
      this.db.prepare("UPDATE token_grants SET tokens_remaining = ? WHERE id = ?").run(next, hold.grantId);
    });
  }

  /** Release a reservation without spending — returns the held estimate. */
  release(reservationId: string): void {
    const hold = this.reservations.get(reservationId);
    if (!hold) return;
    this.reservations.delete(reservationId);
    this.tx(() => {
      const row = this.db.prepare("SELECT tokens_remaining FROM token_grants WHERE id = ?").get(hold.grantId) as
        | { tokens_remaining: number }
        | undefined;
      if (!row) return;
      this.db.prepare("UPDATE token_grants SET tokens_remaining = tokens_remaining + ? WHERE id = ?")
        .run(hold.estTokens, hold.grantId);
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
