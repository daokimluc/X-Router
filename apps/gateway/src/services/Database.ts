/**
 * Database — persistence-sqlite (engine primitive).
 *
 * Synchronous SQLite for transactional money/ledger/usage state, via Node's
 * built-in `node:sqlite` (DatabaseSync) — no native module to install, available
 * on Node 22+ (stable 24+). Synchronous on purpose: the money services'
 * reserve/settle paths are synchronous, and that is what makes in-process
 * double-spend impossible. An async driver would reintroduce interleaving.
 *
 * NOTE (deviation from the proposal): the proposal named `better-sqlite3`;
 * `node:sqlite` is the same synchronous shape with zero install/compile risk, so
 * it is used instead.
 *
 * Configuration state (provider accounts, model mappings, plans, sellers,
 * listings, markup, webhook config) stays in the JSON PersistenceService — only
 * money/metering lives here.
 */
import { DatabaseSync } from "node:sqlite";

export type SqliteDatabase = DatabaseSync;

const SCHEMA_VERSION = 2;

/** Ordered migrations. Index+1 == version applied. */
const MIGRATIONS: Array<(db: DatabaseSync) => void> = [
  // v1 — initial money/metering schema
  (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS wallets (
        key_id TEXT PRIMARY KEY,
        balance_micro INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS wallet_reservations (
        id TEXT PRIMARY KEY,
        key_id TEXT NOT NULL,
        estimate_micro INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS seller_earnings (
        seller_id TEXT PRIMARY KEY,
        day_key TEXT NOT NULL,
        month_key TEXT NOT NULL,
        day_micro INTEGER NOT NULL DEFAULT 0,
        month_micro INTEGER NOT NULL DEFAULT 0,
        lifetime_micro INTEGER NOT NULL DEFAULT 0,
        unpaid_micro INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS platform_margin (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        margin_micro INTEGER NOT NULL DEFAULT 0
      );
      INSERT OR IGNORE INTO platform_margin (id, margin_micro) VALUES (1, 0);
      CREATE TABLE IF NOT EXISTS spend_entries (
        scope TEXT PRIMARY KEY,
        hour_key TEXT NOT NULL,
        day_key TEXT NOT NULL,
        month_key TEXT NOT NULL,
        hour REAL NOT NULL DEFAULT 0,
        day REAL NOT NULL DEFAULT 0,
        month REAL NOT NULL DEFAULT 0,
        last_blocked TEXT
      );
      CREATE TABLE IF NOT EXISTS spend_reservations (
        id TEXT PRIMARY KEY,
        scope TEXT NOT NULL,
        estimate_usd REAL NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS settlement_log (
        id TEXT PRIMARY KEY,
        ts INTEGER NOT NULL,
        buyer_key_id TEXT,
        base_model TEXT,
        seller_id TEXT,
        prompt_tokens INTEGER NOT NULL DEFAULT 0,
        completion_tokens INTEGER NOT NULL DEFAULT 0,
        actual_sell_cost_micro INTEGER NOT NULL DEFAULT 0,
        seller_credit_micro INTEGER NOT NULL DEFAULT 0,
        platform_margin_micro INTEGER NOT NULL DEFAULT 0,
        bill_track TEXT,
        reversed INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_settlement_seller ON settlement_log (seller_id);
      CREATE TABLE IF NOT EXISTS payouts (
        id TEXT PRIMARY KEY,
        seller_id TEXT NOT NULL,
        usd_micro INTEGER NOT NULL,
        ts INTEGER NOT NULL,
        payout_ref TEXT,
        kind TEXT NOT NULL DEFAULT 'paid'
      );
      CREATE INDEX IF NOT EXISTS idx_payouts_seller ON payouts (seller_id);
    `);
  },
  // v2 — money-correctness: a buyer wallet audit log for refunds, a seller-credit
  // reversal log so reconciliation can net reversals against credits, and the
  // plan-bucket scope on each settlement so a plan-track reversal can credit the
  // bucket back (not just refund a wallet).
  (db) => {
    db.exec(`
      ALTER TABLE settlement_log ADD COLUMN plan_scope TEXT;
      ALTER TABLE settlement_log ADD COLUMN collected_micro INTEGER NOT NULL DEFAULT 0;
      CREATE TABLE IF NOT EXISTS wallet_ledger (
        id TEXT PRIMARY KEY,
        key_id TEXT NOT NULL,
        delta_micro INTEGER NOT NULL,
        kind TEXT NOT NULL,
        reason TEXT,
        ts INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_wallet_ledger_key ON wallet_ledger (key_id);
      CREATE TABLE IF NOT EXISTS earnings_reversals (
        id TEXT PRIMARY KEY,
        seller_id TEXT NOT NULL,
        usd_micro INTEGER NOT NULL,
        kind TEXT NOT NULL,
        reason TEXT,
        settlement_id TEXT,
        ts INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_earnings_reversals_seller ON earnings_reversals (seller_id);
    `);
  }
];

export class Database {
  readonly db: DatabaseSync;
  /** Reentrancy depth so nested transaction() calls join the outer transaction. */
  private txDepth = 0;

  constructor(path = ":memory:") {
    this.db = new DatabaseSync(path);
    // WAL: better crash resilience + concurrent reads. NORMAL: fsync at
    // checkpoints, durable across process crash (not necessarily power loss on
    // all filesystems, but far stronger than the old 5s JSON debounce).
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA synchronous = NORMAL");
    this.db.exec("PRAGMA foreign_keys = ON");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec("CREATE TABLE IF NOT EXISTS schema_meta (version INTEGER NOT NULL)");
    const row = this.db.prepare("SELECT version FROM schema_meta LIMIT 1").get() as
      | { version: number }
      | undefined;
    let current = row?.version ?? 0;
    for (let i = current; i < MIGRATIONS.length; i++) {
      this.transaction(() => MIGRATIONS[i](this.db));
      current = i + 1;
    }
    if (!row) {
      this.db.prepare("INSERT INTO schema_meta (version) VALUES (?)").run(SCHEMA_VERSION);
    } else if (current !== row.version) {
      this.db.prepare("UPDATE schema_meta SET version = ?").run(current);
    }
  }

  /**
   * Run fn inside a transaction; commit on success, rollback on throw.
   *
   * Reentrant: a nested call (a money service that itself wraps a transaction,
   * invoked from inside another service's transaction — e.g. reverseSettlement →
   * refundUsd) joins the outer transaction instead of issuing a second BEGIN
   * (node:sqlite has no nested transactions). The outermost call owns
   * BEGIN/COMMIT/ROLLBACK, so a throw anywhere still rolls back the whole unit.
   */
  transaction<T>(fn: () => T): T {
    if (this.txDepth > 0) {
      this.txDepth++;
      try {
        return fn();
      } finally {
        this.txDepth--;
      }
    }
    this.db.exec("BEGIN");
    this.txDepth = 1;
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (err) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        // ignore rollback failure
      }
      throw err;
    } finally {
      this.txDepth = 0;
    }
  }

  close(): void {
    try {
      this.db.close();
    } catch {
      // already closed
    }
  }
}
