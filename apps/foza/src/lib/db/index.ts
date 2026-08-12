import "server-only";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { mkdirSync } from "node:fs";

/**
 * SQLite persistence for the state Foza owns: identity, user↔resource mappings,
 * top-up history, money ledgers, and the webhook event log. Replaces the
 * in-memory globalThis stores so tenant-scoping and money correctness survive
 * restarts and concurrent writes.
 *
 * Catalog state (plans/sellers/listings/markup) is NOT stored here — it is read
 * live from X-Router per the integration contract.
 *
 * Uses Node's built-in `node:sqlite` (synchronous, in-process, atomic writes —
 * no native module, no Edge runtime). Server-only; never imported by client code.
 */

const DATA_DIR = path.join(process.cwd(), ".data");
const DB_FILE = path.join(DATA_DIR, "foza.db");
const SCHEMA_VERSION = 3;

// Singleton on globalThis so Next.js dev module re-evaluation reuses one
// connection (same pattern the in-memory stores used).
const g = globalThis as unknown as { __fozaDb?: DatabaseSync };

function open(): DatabaseSync {
  mkdirSync(DATA_DIR, { recursive: true });
  const conn = new DatabaseSync(DB_FILE);
  conn.exec("PRAGMA journal_mode = WAL");
  conn.exec("PRAGMA foreign_keys = ON");
  migrate(conn);
  return conn;
}

/** The shared connection. */
export function db(): DatabaseSync {
  return g.__fozaDb ?? (g.__fozaDb = open());
}

// PLACEHOLDER_SCHEMA

const SCHEMA = `
CREATE TABLE IF NOT EXISTS schema_version (v INTEGER NOT NULL);

CREATE TABLE IF NOT EXISTS users (
  email               TEXT PRIMARY KEY,
  name                TEXT NOT NULL,
  passwordHash        TEXT NOT NULL,
  verified            INTEGER NOT NULL DEFAULT 0,
  verifyToken         TEXT,
  verifyTokenExpires  INTEGER,
  createdAt           TEXT NOT NULL,
  role                TEXT NOT NULL DEFAULT 'user'
);

CREATE TABLE IF NOT EXISTS buyers (
  keyId           TEXT PRIMARY KEY,
  userEmail       TEXT NOT NULL,
  displayName     TEXT NOT NULL,
  keyMasked       TEXT NOT NULL,
  planId          TEXT,
  overageEnabled  INTEGER NOT NULL DEFAULT 0,
  walletUsd       REAL NOT NULL DEFAULT 0,
  models          TEXT NOT NULL DEFAULT '[]',
  isPrimary       INTEGER NOT NULL DEFAULT 0,
  createdAt       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_buyers_email ON buyers(userEmail);

CREATE TABLE IF NOT EXISTS sellers (
  userEmail     TEXT PRIMARY KEY,
  sellerId      TEXT NOT NULL,
  status        TEXT,
  externalRef   TEXT,
  createdAt     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS wallet_topups (
  id          TEXT PRIMARY KEY,
  userEmail   TEXT NOT NULL,
  keyId       TEXT NOT NULL,
  vndAmount   REAL,
  fxRate      REAL,
  usdAmount   REAL NOT NULL,
  gatewayTxId TEXT,
  status      TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'wallet',
  meta        TEXT,
  createdAt   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS webhook_events (
  dedupeKey         TEXT PRIMARY KEY,
  event             TEXT NOT NULL,
  rawBody           TEXT,
  signatureVerified INTEGER NOT NULL DEFAULT 0,
  requestId         TEXT,
  processedAt       TEXT NOT NULL
);

-- Money ledgers: tables created here (empty); written by xrouter-money-ledger.
CREATE TABLE IF NOT EXISTS billing_ledger (
  settlementId        TEXT PRIMARY KEY,
  requestId           TEXT,
  buyerKeyId          TEXT NOT NULL,
  baseModel           TEXT,
  promptTokens        INTEGER,
  completionTokens    INTEGER,
  actualSellCostMicro INTEGER NOT NULL,
  platformMarginMicro INTEGER NOT NULL DEFAULT 0,
  billTrack           TEXT,
  reversed            INTEGER NOT NULL DEFAULT 0,
  ts                  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_billing_key ON billing_ledger(buyerKeyId);

CREATE TABLE IF NOT EXISTS payable_ledger (
  settlementId      TEXT PRIMARY KEY,
  requestId         TEXT,
  sellerId          TEXT NOT NULL,
  sellerCreditMicro INTEGER NOT NULL,
  reversed          INTEGER NOT NULL DEFAULT 0,
  ts                TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_payable_seller ON payable_ledger(sellerId);

CREATE TABLE IF NOT EXISTS reconcile_state (
  k             TEXT PRIMARY KEY,
  lastSettledAt TEXT
);

-- Idempotency log for seller payouts (admin "mark paid"). One row per payoutRef
-- so a double-submit can't decrement a seller's unpaid balance twice.
CREATE TABLE IF NOT EXISTS payout_log (
  payoutRef   TEXT PRIMARY KEY,
  sellerId    TEXT NOT NULL,
  usdAmount   REAL NOT NULL,
  createdAt   TEXT NOT NULL
);
`;

function migrate(conn: DatabaseSync): void {
  conn.exec(SCHEMA);

  // Idempotent column adds for DBs created before a column existed. CREATE TABLE
  // IF NOT EXISTS never alters an existing table, so each new column needs an
  // explicit guarded ALTER (checked via PRAGMA table_info) — this preserves the
  // existing .data/foza.db (users, money ledgers) instead of forcing a drop.
  ensureColumn(conn, "users", "role", "TEXT NOT NULL DEFAULT 'user'");
  ensureColumn(conn, "wallet_topups", "kind", "TEXT NOT NULL DEFAULT 'wallet'");
  ensureColumn(conn, "wallet_topups", "meta", "TEXT");

  const row = conn.prepare("SELECT v FROM schema_version LIMIT 1").get() as
    | { v: number }
    | undefined;
  if (!row) {
    conn.prepare("INSERT INTO schema_version (v) VALUES (?)").run(SCHEMA_VERSION);
  } else if (row.v < SCHEMA_VERSION) {
    conn.prepare("UPDATE schema_version SET v = ?").run(SCHEMA_VERSION);
  }
}

/** Add `column` to `table` only if it doesn't already exist (safe re-run). */
function ensureColumn(
  conn: DatabaseSync,
  table: string,
  column: string,
  decl: string,
): void {
  const cols = conn.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === column)) {
    conn.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`);
  }
}

/**
 * Record a webhook event for idempotency. Returns true if this is the FIRST time
 * the dedupeKey is seen (caller should process it), false if it's a duplicate.
 * Keyed by settlementId (Phase 34d.1) — never a content hash of the envelope.
 */
export function recordWebhookEvent(input: {
  dedupeKey: string;
  event: string;
  rawBody: string;
  signatureVerified: boolean;
  requestId?: string;
}): boolean {
  const res = db()
    .prepare(
      `INSERT OR IGNORE INTO webhook_events
         (dedupeKey, event, rawBody, signatureVerified, requestId, processedAt)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.dedupeKey,
      input.event,
      input.rawBody,
      input.signatureVerified ? 1 : 0,
      input.requestId ?? null,
      new Date().toISOString(),
    );
  // changes === 0 means the row already existed → duplicate.
  return Number(res.changes) > 0;
}

/**
 * Record a wallet top-up request as PENDING. Crediting the wallet must NOT
 * happen here — it may only follow a verified bank/payment-gateway callback.
 * This row is the audit trail a real payment webhook later flips to "credited".
 *
 * The `id` doubles as the transfer MEMO the buyer puts in the bank-transfer
 * content, so it must be bank-safe: `<prefix>` + base36, UPPERCASE, no
 * separators (some banks strip non-alphanumerics). SePay echoes it back in the
 * webhook so we can match the payment to this row. Returns that memo/id.
 */
export function recordPendingTopup(input: {
  userEmail: string;
  keyId: string;
  usdAmount: number;
  vndAmount?: number;
  fxRate?: number;
  memoPrefix?: string;
  /** "wallet" (default) or "tokenpack". */
  kind?: string;
  /** Arbitrary JSON metadata (e.g. token-pack baseModel/tokens/expiresAt). */
  meta?: Record<string, unknown>;
}): string {
  const prefix = (input.memoPrefix ?? "VEXA").replace(/[^A-Z0-9]/gi, "").toUpperCase();
  const rand = (Date.now().toString(36) + Math.random().toString(36).slice(2))
    .replace(/[^a-z0-9]/gi, "")
    .toUpperCase()
    .slice(0, 14);
  const id = `${prefix}${rand}`;
  db()
    .prepare(
      `INSERT INTO wallet_topups
         (id, userEmail, keyId, vndAmount, fxRate, usdAmount, gatewayTxId, status, kind, meta, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
    )
    .run(
      id,
      input.userEmail,
      input.keyId,
      input.vndAmount ?? null,
      input.fxRate ?? null,
      input.usdAmount,
      null,
      input.kind ?? "wallet",
      input.meta ? JSON.stringify(input.meta) : null,
      new Date().toISOString(),
    );
  return id;
}

export type TopupRow = {
  id: string;
  userEmail: string;
  keyId: string;
  usdAmount: number;
  vndAmount: number | null;
  status: string;
  gatewayTxId: string | null;
  kind: string;
  meta: string | null;
};

/**
 * Find a pending top-up by its memo code, scanning the webhook content for our
 * memo (banks/SePay may wrap it in surrounding text). Returns the row or null.
 * Matching is case-insensitive and ignores non-alphanumerics in the haystack.
 */
export function findTopupByCode(memoOrContent: string): TopupRow | null {
  const hay = (memoOrContent ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!hay) return null;
  // Pull pending rows (small table) and find the one whose id appears in the memo.
  const rows = db()
    .prepare(
      "SELECT id, userEmail, keyId, usdAmount, vndAmount, status, gatewayTxId, kind, meta FROM wallet_topups WHERE status = 'pending'",
    )
    .all() as TopupRow[];
  return rows.find((r) => hay.includes(r.id.toUpperCase())) ?? null;
}

/**
 * Mark a pending top-up credited. Idempotent: only flips a row still in
 * 'pending' → returns true if THIS call did the transition (caller should then
 * credit the wallet), false if it was already credited (duplicate webhook).
 *
 * NOTE: prefer the two-phase claim/finalize/release helpers below for the money
 * path — they credit the gateway BEFORE marking 'credited', so a failed gateway
 * call can be safely retried instead of stranding money in a falsely-credited
 * row. This single-shot flip is kept only for callers that have no gateway step.
 */
export function markTopupCredited(id: string, gatewayTxId: string): boolean {
  const res = db()
    .prepare(
      "UPDATE wallet_topups SET status = 'credited', gatewayTxId = ? WHERE id = ? AND status = 'pending'",
    )
    .run(gatewayTxId, id);
  return Number(res.changes) > 0;
}

/**
 * Phase 1 of crediting: atomically claim a PENDING top-up for crediting
 * ('pending' → 'crediting'). Only ONE concurrent caller wins the transition
 * (single-winner lock); the rest get false. The winner must then credit the
 * gateway and call finalizeTopupCredited on success, or releaseTopupCrediting on
 * failure. The attempting gatewayTxId is stored so a row stuck in 'crediting'
 * (process crash between claim and finalize) is identifiable for reconcile.
 */
export function claimTopupForCrediting(id: string, gatewayTxId: string): boolean {
  const res = db()
    .prepare(
      "UPDATE wallet_topups SET status = 'crediting', gatewayTxId = ? WHERE id = ? AND status = 'pending'",
    )
    .run(gatewayTxId, id);
  return Number(res.changes) > 0;
}

/**
 * Phase 2 (success): finalize a claimed top-up ('crediting' → 'credited') AFTER
 * the gateway credit succeeded. Returns true if it transitioned.
 */
export function finalizeTopupCredited(id: string): boolean {
  const res = db()
    .prepare("UPDATE wallet_topups SET status = 'credited' WHERE id = ? AND status = 'crediting'")
    .run(id);
  return Number(res.changes) > 0;
}

/**
 * Phase 2 (failure): release a claimed top-up back to PENDING ('crediting' →
 * 'pending') when the gateway credit threw. This lets a later webhook retry (or
 * a manual reconcile) re-attempt the credit — the money arrived but was not yet
 * applied, so 'pending' is the truthful state.
 */
export function releaseTopupCrediting(id: string): boolean {
  const res = db()
    .prepare("UPDATE wallet_topups SET status = 'pending' WHERE id = ? AND status = 'crediting'")
    .run(id);
  return Number(res.changes) > 0;
}

/** Read-only check: has this webhook dedupe key already been recorded? */
export function webhookEventSeen(dedupeKey: string): boolean {
  const row = db()
    .prepare("SELECT 1 FROM webhook_events WHERE dedupeKey = ? LIMIT 1")
    .get(dedupeKey);
  return !!row;
}

/** Read a top-up's status + owner (for the payment screen's poll). */
export function getTopupStatus(id: string): { userEmail: string; status: string } | null {
  const row = db()
    .prepare("SELECT userEmail, status FROM wallet_topups WHERE id = ?")
    .get(id) as { userEmail: string; status: string } | undefined;
  return row ?? null;
}

/**
 * Claim a payout idempotency key. Returns true if this `payoutRef` is being seen
 * for the FIRST time (caller should proceed to mark the seller paid), false if
 * it already exists (a duplicate submit — caller must NOT pay again).
 */
export function claimPayout(input: {
  payoutRef: string;
  sellerId: string;
  usdAmount: number;
}): boolean {
  const res = db()
    .prepare(
      `INSERT OR IGNORE INTO payout_log (payoutRef, sellerId, usdAmount, createdAt)
       VALUES (?, ?, ?, ?)`,
    )
    .run(input.payoutRef, input.sellerId, input.usdAmount, new Date().toISOString());
  return Number(res.changes) > 0;
}

/** Roll back a payout claim if the downstream mark-paid call failed. */
export function releasePayout(payoutRef: string): void {
  db().prepare("DELETE FROM payout_log WHERE payoutRef = ?").run(payoutRef);
}
