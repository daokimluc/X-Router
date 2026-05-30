import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { SpendLedgerService } from "../services/SpendLedgerService.js";
import { secondsUntilNextHourUTC } from "../middleware/enforceKeyPolicy.js";

describe("SpendLedgerService — hourly-spend-buckets", () => {
  let svc: SpendLedgerService;

  beforeEach(() => {
    svc = new SpendLedgerService();
  });
  afterEach(() => {
    svc.clear();
    vi.useRealTimers();
  });

  it("hour total resets on hour change; day/month unaffected", () => {
    svc.reserve({ scope: "key:abc", estimateUsd: 0.3, hourCap: 1, dayCap: 10, monthCap: 100 });
    const e = svc.peek("key:abc");
    expect(e?.hour).toBeCloseTo(0.3, 4);
    expect(e?.day).toBeCloseTo(0.3, 4);
    // Force the stored hour to a previous hour, keep day/month current.
    if (e) e.hourKey = "1999-01-01T00";
    const snap = svc.snapshot("key:abc", 10, 100, 1);
    expect(snap.hour.spent).toBe(0); // rolled over
    expect(snap.day.spent).toBeCloseTo(0.3, 4); // unchanged
    expect(snap.month.spent).toBeCloseTo(0.3, 4);
  });

  it("hour cap breached rejects before day/month considered", () => {
    svc.reserve({ scope: "key:abc", estimateUsd: 0.29, hourCap: 0.3, dayCap: 100, monthCap: 1000 });
    const r = svc.reserve({ scope: "key:abc", estimateUsd: 0.05, hourCap: 0.3, dayCap: 100, monthCap: 1000 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("hour_cap_exceeded");
      expect(r.cap).toBe(0.3);
    }
  });

  it("hour cap omitted preserves prior day/month-only behavior", () => {
    // No hourCap → only day cap enforced, identical to before.
    const r1 = svc.reserve({ scope: "key:abc", estimateUsd: 5, dayCap: 10 });
    expect(r1.ok).toBe(true);
    const r2 = svc.reserve({ scope: "key:abc", estimateUsd: 6, dayCap: 10 });
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.reason).toBe("day_cap_exceeded");
  });

  it("settle adjusts the hour window (refund of unused estimate)", () => {
    const r = svc.reserve({ scope: "key:abc", estimateUsd: 0.2, hourCap: 1 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    svc.settle(r.reservationId, 0.05);
    const e = svc.peek("key:abc");
    expect(e?.hour).toBeCloseTo(0.05, 4); // 0.20 − 0.15 refund
  });

  it("release refunds the hour window too", () => {
    const r = svc.reserve({ scope: "key:abc", estimateUsd: 0.2, hourCap: 1 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    svc.release(r.reservationId);
    expect(svc.peek("key:abc")?.hour).toBe(0);
  });

  it("snapshot reports the hour window with remainingPct", () => {
    svc.reserve({ scope: "key:abc", estimateUsd: 0.15, hourCap: 0.3 });
    const snap = svc.snapshot("key:abc", null, null, 0.3);
    expect(snap.hour.spent).toBeCloseTo(0.15, 4);
    expect(snap.hour.cap).toBe(0.3);
    expect(snap.hour.remainingPct).toBe(50);
  });

  it("per-model-group scopes meter independently", () => {
    svc.reserve({ scope: "key:abc:grp:claude", estimateUsd: 1.0, monthCap: 100 });
    svc.reserve({ scope: "key:abc:grp:codex", estimateUsd: 2.0, monthCap: 100 });
    expect(svc.snapshot("key:abc:grp:claude", null, null).month.spent).toBeCloseTo(1.0, 4);
    expect(svc.snapshot("key:abc:grp:codex", null, null).month.spent).toBeCloseTo(2.0, 4);
  });

  it("loads an old-shape entry (no hour fields) as a fresh hour", () => {
    const oldShape = {
      entries: {
        "key:legacy": {
          dayKey: new Date().toISOString().slice(0, 10),
          monthKey: new Date().toISOString().slice(0, 7),
          day: 5,
          month: 42,
          lastBlocked: null
        }
      }
    };
    expect(() => svc.load(oldShape as never)).not.toThrow();
    const snap = svc.snapshot("key:legacy", null, null, 1);
    expect(snap.hour.spent).toBe(0);
    expect(snap.day.spent).toBe(5);
    expect(snap.month.spent).toBe(42);
  });

  it("persistence round-trip preserves the hour window", () => {
    svc.reserve({ scope: "key:abc", estimateUsd: 0.25, hourCap: 1 });
    const svc2 = new SpendLedgerService();
    svc2.load(svc.toPersisted());
    expect(svc2.peek("key:abc")?.hour).toBeCloseTo(0.25, 4);
  });

  it("secondsUntilNextHourUTC returns whole seconds to the next hour boundary", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-29T14:30:00Z"));
    expect(secondsUntilNextHourUTC()).toBe(1800);
    vi.setSystemTime(new Date("2026-05-29T14:59:59Z"));
    expect(secondsUntilNextHourUTC()).toBe(1);
  });
});
