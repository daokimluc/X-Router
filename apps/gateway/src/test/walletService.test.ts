import { describe, expect, it } from "vitest";
import { WalletService } from "../marketplace/services/WalletService.js";

describe("WalletService", () => {
  it("topup then debit", () => {
    const w = new WalletService();
    expect(w.isProvisioned("k1")).toBe(false);
    expect(w.topupUsd("k1", 20)).toBe(20);
    expect(w.isProvisioned("k1")).toBe(true);
    const r = w.debitUsd("k1", 0.0004);
    expect(r.ok).toBe(true);
    expect(r.newBalanceUsd).toBeCloseTo(19.9996, 6);
  });

  it("topup converts to micro-USD losslessly", () => {
    const w = new WalletService();
    w.topupUsd("k1", 20);
    expect(w.toPersisted().balances.k1).toBe(20_000_000);
    expect(w.getUsd("k1")).toBe(20);
  });

  it("sub-cent debit floored at zero reports ok:false", () => {
    const w = new WalletService();
    w.topupUsd("k1", 0.0003);
    const r = w.debitUsd("k1", 0.0004);
    expect(r.ok).toBe(false);
    expect(w.getUsd("k1")).toBeCloseTo(0.0003, 6); // unchanged
  });

  it("exact debit reaches zero and succeeds", () => {
    const w = new WalletService();
    w.topupUsd("k1", 0.0004);
    const r = w.debitUsd("k1", 0.0004);
    expect(r.ok).toBe(true);
    expect(w.getUsd("k1")).toBe(0);
  });

  it("hasFundsUsd distinguishes unprovisioned, empty, and funded", () => {
    const w = new WalletService();
    expect(w.hasFundsUsd("missing", 0.01)).toBe(false); // unprovisioned
    w.open("empty");
    expect(w.hasFundsUsd("empty", 0.01)).toBe(false); // provisioned but empty
    w.topupUsd("funded", 0.5);
    expect(w.hasFundsUsd("funded", 0.01)).toBe(true);
    expect(w.hasFundsUsd("funded", 0.5)).toBe(true); // exact
    expect(w.hasFundsUsd("funded", 0.51)).toBe(false);
  });

  it("reserve rejected when funds insufficient", () => {
    const w = new WalletService();
    w.topupUsd("k1", 0.05);
    const r = w.reserveUsd({ keyId: "k1", estimateUsd: 0.1 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("insufficient_funds");
      expect(r.balanceUsd).toBeCloseTo(0.05, 6);
    }
    expect(w.getUsd("k1")).toBeCloseTo(0.05, 6); // untouched
  });

  it("reserve then settle refunds the unused estimate", () => {
    const w = new WalletService();
    w.topupUsd("k1", 1.0);
    const r = w.reserveUsd({ keyId: "k1", estimateUsd: 0.2 });
    expect(r.ok).toBe(true);
    expect(w.getUsd("k1")).toBeCloseTo(0.8, 6); // deducted up-front
    if (r.ok) w.settleUsd(r.reservationId, 0.07);
    expect(w.getUsd("k1")).toBeCloseTo(0.93, 6); // refunded 0.13
  });

  it("reserve then release refunds the full estimate", () => {
    const w = new WalletService();
    w.topupUsd("k1", 1.0);
    const r = w.reserveUsd({ keyId: "k1", estimateUsd: 0.2 });
    expect(r.ok).toBe(true);
    if (r.ok) w.releaseUsd(r.reservationId);
    expect(w.getUsd("k1")).toBeCloseTo(1.0, 6);
  });

  it("concurrent reservations cannot overspend", () => {
    const w = new WalletService();
    w.topupUsd("k1", 0.15);
    const a = w.reserveUsd({ keyId: "k1", estimateUsd: 0.1 });
    const b = w.reserveUsd({ keyId: "k1", estimateUsd: 0.1 });
    const successes = [a, b].filter((x) => x.ok).length;
    expect(successes).toBe(1);
    expect(w.getUsd("k1")).toBeCloseTo(0.05, 6); // only one 0.10 held
  });

  it("settle with actual above estimate debits the extra (floored at zero)", () => {
    const w = new WalletService();
    w.topupUsd("k1", 1.0);
    const r = w.reserveUsd({ keyId: "k1", estimateUsd: 0.2 });
    expect(r.ok).toBe(true);
    // balance now 0.80; settle to 0.30 actual → extra 0.10 debit → 0.70
    if (r.ok) w.settleUsd(r.reservationId, 0.3);
    expect(w.getUsd("k1")).toBeCloseTo(0.7, 6);
  });

  it("persistence round-trip", () => {
    const w = new WalletService();
    w.topupUsd("k1", 12.34);
    w.open("k2");
    const snap = w.toPersisted();

    const w2 = new WalletService();
    w2.load(snap);
    expect(w2.getUsd("k1")).toBeCloseTo(12.34, 6);
    expect(w2.isProvisioned("k2")).toBe(true);
    expect(w2.getUsd("k2")).toBe(0);
    expect(w2.isProvisioned("k3")).toBe(false);
  });
});
