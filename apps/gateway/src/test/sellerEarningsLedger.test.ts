import { describe, expect, it } from "vitest";
import { SellerEarningsLedger } from "../marketplace/services/SellerEarningsLedger.js";
import { makeTestDb } from "./helpers.js";

describe("SellerEarningsLedger", () => {
  it("credit accrues day/month/lifetime/unpaid", () => {
    const l = new SellerEarningsLedger(makeTestDb());
    l.credit("cinb", 0.004784);
    const s = l.snapshot("cinb");
    expect(s.day).toBeCloseTo(0.004784, 6);
    expect(s.month).toBeCloseTo(0.004784, 6);
    expect(s.lifetime).toBeCloseTo(0.004784, 6);
    expect(s.unpaid).toBeCloseTo(0.004784, 6);
  });

  it("house credit is a no-op", () => {
    const l = new SellerEarningsLedger(makeTestDb());
    l.credit("house", 5);
    expect(l.snapshot("house").lifetime).toBe(0);
  });

  it("markPaid reduces unpaid only, leaves lifetime", () => {
    const l = new SellerEarningsLedger(makeTestDb());
    l.credit("cinb", 10);
    l.markPaid("cinb", 10);
    const s = l.snapshot("cinb");
    expect(s.unpaid).toBe(0);
    expect(s.lifetime).toBe(10);
  });

  it("records platform margin running total", () => {
    const l = new SellerEarningsLedger(makeTestDb());
    l.recordPlatformMargin(0.001216);
    l.recordPlatformMargin(0.002);
    expect(l.getPlatformMargin()).toBeCloseTo(0.003216, 6);
  });

  it("earnings + margin are durable across service instances on one store", () => {
    const db = makeTestDb();
    const l = new SellerEarningsLedger(db);
    l.credit("cinb", 3);
    l.recordPlatformMargin(1.5);
    const l2 = new SellerEarningsLedger(db);
    expect(l2.snapshot("cinb").lifetime).toBe(3);
    expect(l2.getPlatformMargin()).toBe(1.5);
  });

  it("importLegacy seeds earnings + margin from the JSON migration slice", () => {
    const l = new SellerEarningsLedger(makeTestDb());
    l.importLegacy({
      entries: {
        cinb: { dayKey: "2026-05-30", monthKey: "2026-05", day: 1, month: 2, lifetime: 3, unpaid: 2.5 }
      },
      platformMargin: 1.5
    });
    const s = l.snapshot("cinb");
    expect(s.lifetime).toBe(3);
    expect(s.unpaid).toBe(2.5);
    expect(l.getPlatformMargin()).toBe(1.5);
  });
});
