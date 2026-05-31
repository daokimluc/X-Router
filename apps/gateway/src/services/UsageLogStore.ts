/**
 * UsageLogStore — durable append-only usage log (engine, SQLite-backed).
 *
 * The in-memory UsageService is a ~1000-row ring buffer that serves the live
 * dashboard + charts. This store mirrors each billable usage record into SQLite
 * so long-range reconciliation (the marketplace `/provision/usage` read) survives
 * the ring-buffer cap and restarts. Append-only; never trimmed here.
 *
 * Money is stored as integer micro-USD; tokens as integers. Queries are bounded
 * (default 100, max 1000) and ordered newest-first.
 */
import { randomUUID } from "node:crypto";
import type { Database, SqliteDatabase } from "./Database.js";

export type UsageLogEntry = {
  requestId?: string;
  apiKeyHash?: string;
  model?: string;
  providerType?: string;
  protocol?: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedTokens?: number;
  estimatedCost?: number;
};

export type UsageLogQuery = {
  apiKeyHash?: string;
  since?: Date;
  limit?: number;
};

export type UsageLogRow = {
  id: string;
  requestId: string | null;
  ts: number;
  apiKeyHash: string | null;
  model: string | null;
  providerType: string | null;
  protocol: string | null;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedTokens: number;
  estimatedCost: number;
};

export class UsageLogStore {
  private readonly db: SqliteDatabase;

  constructor(database: Database) {
    this.db = database.db;
  }

  /** Append one usage record. Best-effort — never throws into the request path. */
  append(entry: UsageLogEntry): void {
    try {
      this.db.prepare(
        `INSERT INTO usage_log
          (id, ts, request_id, api_key_hash, model, provider_type, protocol,
           prompt_tokens, completion_tokens, total_tokens, cached_tokens, estimated_cost_micro)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        `ulog_${randomUUID()}`,
        Date.now(),
        entry.requestId ?? null,
        entry.apiKeyHash ?? null,
        entry.model ?? null,
        entry.providerType ?? null,
        entry.protocol ?? null,
        Math.round(entry.promptTokens || 0),
        Math.round(entry.completionTokens || 0),
        Math.round(entry.totalTokens || 0),
        Math.round(entry.cachedTokens || 0),
        Math.round((entry.estimatedCost || 0) * 1_000_000)
      );
    } catch {
      // durability is best-effort; live UsageService still has the record
    }
  }

  /** Total row count (cheap; used by the one-time backfill guard). */
  count(): number {
    return (this.db.prepare("SELECT COUNT(*) AS c FROM usage_log").get() as { c: number }).c;
  }

  /**
   * One-time backfill of historical usage rows that preserves the ORIGINAL
   * timestamp + id (unlike append(), which stamps Date.now() and a fresh id).
   * Used to migrate the pre-SQLite JSON `usage` slice into usage_log so the
   * Usage page is not empty after upgrading. Idempotent per id (INSERT OR
   * IGNORE). Returns how many rows were inserted.
   */
  importRows(rows: Array<UsageLogEntry & { id?: string; ts?: number }>): number {
    const stmt = this.db.prepare(
      `INSERT OR IGNORE INTO usage_log
        (id, ts, request_id, api_key_hash, model, provider_type, protocol,
         prompt_tokens, completion_tokens, total_tokens, cached_tokens, estimated_cost_micro)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    let inserted = 0;
    for (const r of rows) {
      try {
        const res = stmt.run(
          r.id ?? `ulog_${randomUUID()}`,
          r.ts ?? Date.now(),
          r.requestId ?? null,
          r.apiKeyHash ?? null,
          r.model ?? null,
          r.providerType ?? null,
          r.protocol ?? null,
          Math.round(r.promptTokens || 0),
          Math.round(r.completionTokens || 0),
          Math.round(r.totalTokens || 0),
          Math.round(r.cachedTokens || 0),
          Math.round((r.estimatedCost || 0) * 1_000_000)
        );
        inserted += Number(res.changes ?? 0);
      } catch {
        // skip a malformed legacy row rather than abort the whole backfill
      }
    }
    return inserted;
  }

  query(q: UsageLogQuery = {}): { data: UsageLogRow[]; total: number } {
    const limit = Math.max(1, Math.min(q.limit ?? 100, 1000));
    const where: string[] = [];
    const params: Array<string | number> = [];
    if (q.apiKeyHash) { where.push("api_key_hash = ?"); params.push(q.apiKeyHash); }
    if (q.since) { where.push("ts >= ?"); params.push(q.since.getTime()); }
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const total = (this.db.prepare(`SELECT COUNT(*) AS c FROM usage_log ${clause}`).get(...params) as { c: number }).c;
    const rows = this.db.prepare(
      `SELECT * FROM usage_log ${clause} ORDER BY ts DESC LIMIT ?`
    ).all(...params, limit) as Array<{
      id: string; request_id: string | null; ts: number; api_key_hash: string | null; model: string | null;
      provider_type: string | null; protocol: string | null;
      prompt_tokens: number; completion_tokens: number; total_tokens: number;
      cached_tokens: number; estimated_cost_micro: number;
    }>;

    return {
      total,
      data: rows.map((r) => ({
        id: r.id,
        requestId: r.request_id,
        ts: r.ts,
        apiKeyHash: r.api_key_hash,
        model: r.model,
        providerType: r.provider_type,
        protocol: r.protocol,
        promptTokens: r.prompt_tokens,
        completionTokens: r.completion_tokens,
        totalTokens: r.total_tokens,
        cachedTokens: r.cached_tokens,
        estimatedCost: r.estimated_cost_micro / 1_000_000
      }))
    };
  }
}
