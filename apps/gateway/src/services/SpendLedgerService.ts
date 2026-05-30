/**
 * SpendLedgerService — Phase 32 — spending-caps.
 *
 * Tracks per-scope (key or team) USD spend across calendar day and calendar
 * month windows. Supports the hold-and-settle pattern: pre-flight reserves an
 * upper-bound estimate, post-completion settles to actual cost (refunding the
 * delta), or releases the full reservation on failure.
 *
 * State is kept in memory and serialized to JSON via PersistenceService.
 * Day/month rollover happens lazily on access — no cron needed.
 */

import { randomUUID } from "node:crypto";

export type ScopeKey = string; // e.g. "key:abc123" or "team:default"

export type LedgerEntry = {
  /** UTC hour as "YYYY-MM-DDTHH" */
  hourKey: string;
  /** UTC date as "YYYY-MM-DD" */
  dayKey: string;
  /** UTC year-month as "YYYY-MM" */
  monthKey: string;
  /** Cumulative USD spent this hour (settled + active reservations) */
  hour: number;
  /** Cumulative USD spent today (settled + active reservations) */
  day: number;
  /** Cumulative USD spent this month */
  month: number;
  /** Last time a reservation was BLOCKED for this scope (ISO) */
  lastBlocked: string | null;
};

export type Reservation = {
  id: string;
  scope: ScopeKey;
  estimateUsd: number;
  createdAt: number; // ms
};

export type LedgerSnapshot = {
  scope: ScopeKey;
  hour: { spent: number; cap: number | null; remainingPct: number | null };
  day: { spent: number; cap: number | null; remainingPct: number | null };
  month: { spent: number; cap: number | null; remainingPct: number | null };
  lastBlocked: string | null;
};

export type PersistedLedger = {
  entries: Record<ScopeKey, PersistedLedgerEntry>;
};

/** On-disk entry shape. hourKey/hour optional for backward tolerance (pre-hour-window state). */
export type PersistedLedgerEntry = Omit<LedgerEntry, "hourKey" | "hour"> & {
  hourKey?: string;
  hour?: number;
};

function hourKeyNow(): string {
  return new Date().toISOString().slice(0, 13);
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function monthKey(): string {
  return new Date().toISOString().slice(0, 7);
}

function emptyEntry(): LedgerEntry {
  return {
    hourKey: hourKeyNow(),
    dayKey: todayKey(),
    monthKey: monthKey(),
    hour: 0,
    day: 0,
    month: 0,
    lastBlocked: null
  };
}

function rollover(entry: LedgerEntry): LedgerEntry {
  const th = hourKeyNow();
  const td = todayKey();
  const tm = monthKey();
  if (entry.hourKey !== th) {
    entry.hour = 0;
    entry.hourKey = th;
  }
  if (entry.dayKey !== td) {
    entry.day = 0;
    entry.dayKey = td;
  }
  if (entry.monthKey !== tm) {
    entry.month = 0;
    entry.monthKey = tm;
  }
  return entry;
}

export type ReserveResult =
  | { ok: true; reservationId: string }
  | { ok: false; reason: "hour_cap_exceeded" | "day_cap_exceeded" | "month_cap_exceeded"; cap: number; spent: number };

export class SpendLedgerService {
  private readonly entries = new Map<ScopeKey, LedgerEntry>();
  private readonly reservations = new Map<string, Reservation>();
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

  /**
   * Pre-flight check + atomic reservation. If `currentSpend + estimate` exceeds
   * either day or month cap, returns ok:false. Otherwise increments ledger by
   * the estimate and returns a reservationId to settle/release later.
   */
  reserve(args: {
    scope: ScopeKey;
    estimateUsd: number;
    hourCap?: number | null;
    dayCap?: number | null;
    monthCap?: number | null;
  }): ReserveResult {
    const entry = this.getOrInit(args.scope);
    rollover(entry);

    if (typeof args.hourCap === "number" && args.hourCap > 0 && entry.hour + args.estimateUsd > args.hourCap) {
      entry.lastBlocked = new Date().toISOString();
      this.scheduleSave();
      return { ok: false, reason: "hour_cap_exceeded", cap: args.hourCap, spent: entry.hour };
    }
    if (typeof args.dayCap === "number" && args.dayCap > 0 && entry.day + args.estimateUsd > args.dayCap) {
      entry.lastBlocked = new Date().toISOString();
      this.scheduleSave();
      return { ok: false, reason: "day_cap_exceeded", cap: args.dayCap, spent: entry.day };
    }
    if (typeof args.monthCap === "number" && args.monthCap > 0 && entry.month + args.estimateUsd > args.monthCap) {
      entry.lastBlocked = new Date().toISOString();
      this.scheduleSave();
      return { ok: false, reason: "month_cap_exceeded", cap: args.monthCap, spent: entry.month };
    }

    const id = `res_${randomUUID()}`;
    this.reservations.set(id, {
      id,
      scope: args.scope,
      estimateUsd: args.estimateUsd,
      createdAt: Date.now()
    });
    entry.hour += args.estimateUsd;
    entry.day += args.estimateUsd;
    entry.month += args.estimateUsd;
    this.scheduleSave();
    return { ok: true, reservationId: id };
  }

  /**
   * Post-completion adjust. Replace the estimate amount with the actual cost.
   * If actual < estimate, refund difference. If actual > estimate, debit extra.
   */
  settle(reservationId: string, actualUsd: number): void {
    const r = this.reservations.get(reservationId);
    if (!r) return;
    this.reservations.delete(reservationId);
    const entry = this.getOrInit(r.scope);
    rollover(entry);
    const delta = actualUsd - r.estimateUsd;
    entry.hour += delta;
    entry.day += delta;
    entry.month += delta;
    if (entry.hour < 0) entry.hour = 0;
    if (entry.day < 0) entry.day = 0;
    if (entry.month < 0) entry.month = 0;
    this.scheduleSave();
  }

  /**
   * Release a reservation without spending — used on request failure.
   */
  release(reservationId: string): void {
    const r = this.reservations.get(reservationId);
    if (!r) return;
    this.reservations.delete(reservationId);
    const entry = this.getOrInit(r.scope);
    rollover(entry);
    entry.hour -= r.estimateUsd;
    entry.day -= r.estimateUsd;
    entry.month -= r.estimateUsd;
    if (entry.hour < 0) entry.hour = 0;
    if (entry.day < 0) entry.day = 0;
    if (entry.month < 0) entry.month = 0;
    this.scheduleSave();
  }

  /**
   * Read-only snapshot of current spend for a scope. Returns zero entry if
   * scope was never seen.
   */
  snapshot(scope: ScopeKey, dayCap: number | null, monthCap: number | null, hourCap: number | null = null): LedgerSnapshot {
    const entry = this.entries.get(scope);
    if (!entry) {
      return {
        scope,
        hour: { spent: 0, cap: hourCap, remainingPct: hourCap ? 100 : null },
        day: { spent: 0, cap: dayCap, remainingPct: dayCap ? 100 : null },
        month: { spent: 0, cap: monthCap, remainingPct: monthCap ? 100 : null },
        lastBlocked: null
      };
    }
    rollover(entry);
    return {
      scope,
      hour: {
        spent: round4(entry.hour),
        cap: hourCap,
        remainingPct: hourCap && hourCap > 0 ? round1(Math.max(0, (1 - entry.hour / hourCap) * 100)) : null
      },
      day: {
        spent: round4(entry.day),
        cap: dayCap,
        remainingPct: dayCap && dayCap > 0 ? round1(Math.max(0, (1 - entry.day / dayCap) * 100)) : null
      },
      month: {
        spent: round4(entry.month),
        cap: monthCap,
        remainingPct: monthCap && monthCap > 0 ? round1(Math.max(0, (1 - entry.month / monthCap) * 100)) : null
      },
      lastBlocked: entry.lastBlocked
    };
  }

  toPersisted(): PersistedLedger {
    const out: PersistedLedger = { entries: {} };
    for (const [k, v] of this.entries) out.entries[k] = { ...v };
    return out;
  }

  load(state: PersistedLedger | undefined | null): void {
    this.entries.clear();
    if (!state || !state.entries) return;
    for (const [k, v] of Object.entries(state.entries)) {
      // Backward tolerance: entries written before the hour window have no
      // hourKey/hour. Treat them as a fresh hour (0), normalized by first rollover.
      const entry: LedgerEntry = {
        hourKey: v.hourKey ?? hourKeyNow(),
        dayKey: v.dayKey,
        monthKey: v.monthKey,
        hour: typeof v.hour === "number" ? v.hour : 0,
        day: v.day,
        month: v.month,
        lastBlocked: v.lastBlocked ?? null
      };
      this.entries.set(k, entry);
    }
  }

  /** Test helper. */
  clear(): void {
    this.entries.clear();
    this.reservations.clear();
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
  }

  /** Test helper — return raw entry. */
  peek(scope: ScopeKey): LedgerEntry | undefined {
    const e = this.entries.get(scope);
    if (e) rollover(e);
    return e;
  }

  private getOrInit(scope: ScopeKey): LedgerEntry {
    let e = this.entries.get(scope);
    if (!e) {
      e = emptyEntry();
      this.entries.set(scope, e);
    }
    return e;
  }
}

function round4(v: number): number {
  return Math.round(v * 10000) / 10000;
}
function round1(v: number): number {
  return Math.round(v * 10) / 10;
}
