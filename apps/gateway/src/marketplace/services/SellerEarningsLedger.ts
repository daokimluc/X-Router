/**
 * SellerEarningsLedger — two-sided-settlement (#6), SQLite-backed (persistence-sqlite).
 *
 * Per-seller accrued USD credit (cost minus commission), rolled up day / month /
 * lifetime, plus an `unpaid` balance reduced on payout. Distinct from the
 * buyer-debit WalletService. The `house` seller is never credited.
 *
 * Storage swap only: same public interface as the prior in-memory version.
 * Stored as integer micro-USD; lazy day/month rollover applied on read/write by
 * comparing the stored day_key/month_key to now. Per-request settlement log +
 * payout reconstruction land in money-correctness (#2).
 */

import type { Database, SqliteDatabase } from "../../services/Database.js";
import { microToUsd, usdToMicro } from "../utils/money.js";

const HOUSE_SELLER_ID = "house";

export type SellerEarningsSnapshot = {
  sellerId: string;
  day: number;
  month: number;
  lifetime: number;
  unpaid: number;
};

/** Legacy shape, kept only for the one-time JSON→SQLite migration import. */
export type PersistedSellerEarnings = {
  entries: Record<string, { dayKey: string; monthKey: string; day: number; month: number; lifetime: number; unpaid: number }>;
  platformMargin?: number;
};

function dayKeyNow(): string {
  return new Date().toISOString().slice(0, 10);
}
function monthKeyNow(): string {
  return new Date().toISOString().slice(0, 7);
}

type Row = {
  seller_id: string;
  day_key: string;
  month_key: string;
  day_micro: number;
  month_micro: number;
  lifetime_micro: number;
  unpaid_micro: number;
};

export class SellerEarningsLedger {
  private readonly db: SqliteDatabase;
  private readonly tx: <T>(fn: () => T) => T;

  constructor(database: Database) {
    this.db = database.db;
    this.tx = database.transaction.bind(database);
  }

  /** Read the row with lazy day/month rollover applied (and persisted if rolled). */
  private rolled(sellerId: string): Row | undefined {
    const row = this.db.prepare("SELECT * FROM seller_earnings WHERE seller_id = ?").get(sellerId) as Row | undefined;
    if (!row) return undefined;
    const d = dayKeyNow();
    const m = monthKeyNow();
    if (row.day_key !== d || row.month_key !== m) {
      if (row.day_key !== d) {
        row.day_micro = 0;
        row.day_key = d;
      }
      if (row.month_key !== m) {
        row.month_micro = 0;
        row.month_key = m;
      }
      this.db.prepare(
        "UPDATE seller_earnings SET day_key=?, month_key=?, day_micro=?, month_micro=? WHERE seller_id=?"
      ).run(row.day_key, row.month_key, row.day_micro, row.month_micro, sellerId);
    }
    return row;
  }

  /** Credit a seller. House is never credited (no-op). */
  credit(sellerId: string, usd: number): void {
    if (sellerId === HOUSE_SELLER_ID || usd <= 0) return;
    const add = usdToMicro(usd);
    this.tx(() => {
      const r = this.rolled(sellerId);
      if (!r) {
        this.db.prepare(
          "INSERT INTO seller_earnings (seller_id, day_key, month_key, day_micro, month_micro, lifetime_micro, unpaid_micro) VALUES (?, ?, ?, ?, ?, ?, ?)"
        ).run(sellerId, dayKeyNow(), monthKeyNow(), add, add, add, add);
      } else {
        this.db.prepare(
          "UPDATE seller_earnings SET day_micro=day_micro+?, month_micro=month_micro+?, lifetime_micro=lifetime_micro+?, unpaid_micro=unpaid_micro+? WHERE seller_id=?"
        ).run(add, add, add, add, sellerId);
      }
    });
  }

  /** Record platform margin (markup + commission retained). */
  recordPlatformMargin(usd: number): void {
    if (usd === 0) return;
    const add = usdToMicro(usd);
    this.db.prepare("UPDATE platform_margin SET margin_micro = margin_micro + ? WHERE id = 1").run(add);
  }

  getPlatformMargin(): number {
    const row = this.db.prepare("SELECT margin_micro FROM platform_margin WHERE id = 1").get() as { margin_micro: number } | undefined;
    return microToUsd(row?.margin_micro ?? 0);
  }

  /** Reduce unpaid after an off-platform payout. Floored at 0. */
  markPaid(sellerId: string, usd: number): SellerEarningsSnapshot {
    const sub = usdToMicro(usd);
    this.tx(() => {
      const r = this.rolled(sellerId);
      if (!r) return;
      const next = Math.max(0, r.unpaid_micro - sub);
      this.db.prepare("UPDATE seller_earnings SET unpaid_micro = ? WHERE seller_id = ?").run(next, sellerId);
    });
    return this.snapshot(sellerId);
  }

  snapshot(sellerId: string): SellerEarningsSnapshot {
    const r = this.rolled(sellerId);
    if (!r) return { sellerId, day: 0, month: 0, lifetime: 0, unpaid: 0 };
    return {
      sellerId,
      day: microToUsd(r.day_micro),
      month: microToUsd(r.month_micro),
      lifetime: microToUsd(r.lifetime_micro),
      unpaid: microToUsd(r.unpaid_micro)
    };
  }

  /** One-time import from the legacy JSON earnings slice. Idempotent per seller. */
  importLegacy(state: PersistedSellerEarnings | undefined | null): void {
    if (!state) return;
    this.tx(() => {
      if (typeof state.platformMargin === "number" && state.platformMargin !== 0) {
        // Only seed margin if still zero (don't double-import).
        const cur = this.db.prepare("SELECT margin_micro FROM platform_margin WHERE id = 1").get() as { margin_micro: number };
        if ((cur?.margin_micro ?? 0) === 0) {
          this.db.prepare("UPDATE platform_margin SET margin_micro = ? WHERE id = 1").run(usdToMicro(state.platformMargin));
        }
      }
      if (state.entries) {
        for (const [k, v] of Object.entries(state.entries)) {
          this.db.prepare(
            "INSERT OR IGNORE INTO seller_earnings (seller_id, day_key, month_key, day_micro, month_micro, lifetime_micro, unpaid_micro) VALUES (?, ?, ?, ?, ?, ?, ?)"
          ).run(k, v.dayKey ?? dayKeyNow(), v.monthKey ?? monthKeyNow(), usdToMicro(v.day ?? 0), usdToMicro(v.month ?? 0), usdToMicro(v.lifetime ?? 0), usdToMicro(v.unpaid ?? 0));
        }
      }
    });
  }
}
