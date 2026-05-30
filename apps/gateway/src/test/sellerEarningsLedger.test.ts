import { describe, expect, it } from "vitest";
import { SellerEarningsLedger } from "../marketplace/services/SellerEarningsLedger.js";

describe("SellerEarningsLedger", () => {
  it("credit accrues day/month/lifetime/unpaid", () => {
    const l = new SellerEarningsLedger();
    l.credit("cinb", 0.004784);
    const s = l.snapshot("cinb");
    expect(s.day).toBeCloseTo(0.004784, 6);
    expect(s.month).toBeCloseTo(0.004784, 6);
    expect(s.lifetime).toBeCloseTo(0.004784, 6);
    expect(s.unpaid).toBeCloseTo(0.004784, 6);
  });

  it("house credit is a no-op", () => {
    const l = new SellerEarningsLedger();
    l.credit("house", 5);
    expect(l.snapshot("house").lifetime).toBe(0);
  });

  it("markPaid reduces unpaid only, leaves lifetime", () => {
    const l = new SellerEarningsLedger();
    l.credit("cinb", 10);
    l.markPaid("cinb", 10);
    const s = l.snapshot("cinb");
    expect(s.unpaid).toBe(0);
    expect(s.lifetime).toBe(10);
  });

  it("records platform margin running total", () => {
    const l = new SellerEarningsLedger();
    l.recordPlatformMargin(0.001216);
    l.recordPlatformMargin(0.002);
    expect(l.getPlatformMargin()).toBeCloseTo(0.003216, 6);
  });

  it("persistence round-trip keeps earnings + margin", () => {
    const l = new SellerEarningsLedger();
    l.credit("cinb", 3);
    l.recordPlatformMargin(1.5);
    const l2 = new SellerEarningsLedger();
    l2.load(l.toPersisted());
    expect(l2.snapshot("cinb").lifetime).toBe(3);
    expect(l2.getPlatformMargin()).toBe(1.5);
  });
});
