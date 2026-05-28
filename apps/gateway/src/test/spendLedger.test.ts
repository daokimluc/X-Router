import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import { SpendLedgerService } from "../services/SpendLedgerService.js";

describe("SpendLedgerService (Phase 32)", () => {
  let svc: SpendLedgerService;

  beforeEach(() => {
    svc = new SpendLedgerService();
  });

  afterEach(() => {
    svc.clear();
    vi.useRealTimers();
  });

  it("first reserve under cap succeeds and increments ledger", () => {
    const r = svc.reserve({ scope: "key:abc", estimateUsd: 0.5, dayCap: 10 });
    expect(r.ok).toBe(true);
    const entry = svc.peek("key:abc");
    expect(entry?.day).toBe(0.5);
  });

  it("reserve over day cap returns error and records lastBlocked", () => {
    svc.reserve({ scope: "key:abc", estimateUsd: 9.95, dayCap: 10 });
    const r = svc.reserve({ scope: "key:abc", estimateUsd: 0.10, dayCap: 10 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("day_cap_exceeded");
      expect(r.cap).toBe(10);
    }
    const snap = svc.snapshot("key:abc", 10, null);
    expect(snap.lastBlocked).not.toBeNull();
  });

  it("settle adjusts day total to actual cost (refunding)", () => {
    const r = svc.reserve({ scope: "key:abc", estimateUsd: 1.0, dayCap: 10 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    svc.settle(r.reservationId, 0.42);
    const entry = svc.peek("key:abc");
    expect(entry?.day).toBeCloseTo(0.42, 4);
  });

  it("release refunds full estimate", () => {
    const r = svc.reserve({ scope: "key:abc", estimateUsd: 1.0, dayCap: 10 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    svc.release(r.reservationId);
    const entry = svc.peek("key:abc");
    expect(entry?.day).toBe(0);
  });

  it("two concurrent reservations near cap — second one fails", () => {
    svc.reserve({ scope: "key:abc", estimateUsd: 9.5, dayCap: 10 });
    const a = svc.reserve({ scope: "key:abc", estimateUsd: 0.4, dayCap: 10 });
    const b = svc.reserve({ scope: "key:abc", estimateUsd: 0.4, dayCap: 10 });
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(false);
  });

  it("month cap is enforced independently", () => {
    const r = svc.reserve({ scope: "key:abc", estimateUsd: 100, dayCap: 200, monthCap: 50 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("month_cap_exceeded");
    }
  });

  it("rollover resets day total when dayKey advances", () => {
    svc.reserve({ scope: "key:abc", estimateUsd: 1, dayCap: 10 });
    // Force the entry to look like yesterday
    const e = svc.peek("key:abc");
    if (e) {
      e.dayKey = "1999-01-01";
      e.day = 999;
    }
    const snap = svc.snapshot("key:abc", 10, null);
    expect(snap.day.spent).toBe(0);
  });

  it("snapshot returns zero entry for unseen scope", () => {
    const snap = svc.snapshot("key:never-seen", 10, 100);
    expect(snap.day.spent).toBe(0);
    expect(snap.month.spent).toBe(0);
    expect(snap.day.cap).toBe(10);
    expect(snap.month.cap).toBe(100);
  });

  it("persistence round-trip preserves entries", () => {
    svc.reserve({ scope: "key:abc", estimateUsd: 2, dayCap: 100 });
    svc.reserve({ scope: "team:default", estimateUsd: 5, dayCap: 100 });

    const persisted = svc.toPersisted();
    expect(Object.keys(persisted.entries).sort()).toEqual(["key:abc", "team:default"]);

    const svc2 = new SpendLedgerService();
    svc2.load(persisted);
    const entry = svc2.peek("key:abc");
    expect(entry?.day).toBe(2);
  });

  it("settle on unknown reservation is a no-op", () => {
    expect(() => svc.settle("res_does_not_exist", 5)).not.toThrow();
  });

  it("snapshot computes remainingPct correctly", () => {
    svc.reserve({ scope: "key:abc", estimateUsd: 2.5, dayCap: 10 });
    const snap = svc.snapshot("key:abc", 10, null);
    expect(snap.day.spent).toBe(2.5);
    expect(snap.day.remainingPct).toBe(75);
  });
});
