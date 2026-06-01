import { describe, expect, it, beforeEach } from "vitest";
import { WalletService } from "../marketplace/services/WalletService.js";
import { SpendLedgerService } from "../services/SpendLedgerService.js";
import { makeTestDb } from "./helpers.js";

describe("WalletService.chargeUsd (all-or-nothing, ledgered)", () => {
  let wallet: WalletService;
  beforeEach(() => {
    wallet = new WalletService(makeTestDb());
  });

  it("charges in full when funded and writes a ledger row", () => {
    wallet.topupUsd("k1", 15);
    const r = wallet.chargeUsd("k1", 10, "plan_subscribe:plan_claude");
    expect(r.ok).toBe(true);
    expect(r.newBalanceUsd).toBe(5);
    expect(wallet.getUsd("k1")).toBe(5);
    const ledger = wallet.ledgerFor("k1");
    expect(ledger).toHaveLength(1);
    expect(ledger[0].kind).toBe("charge");
    expect(ledger[0].deltaUsd).toBe(-10);
    expect(ledger[0].reason).toBe("plan_subscribe:plan_claude");
  });

  it("refuses an underfunded charge — no mutation, no ledger row", () => {
    wallet.topupUsd("k1", 4);
    const r = wallet.chargeUsd("k1", 10, "plan_renew:plan_claude");
    expect(r.ok).toBe(false);
    expect(wallet.getUsd("k1")).toBe(4); // untouched (not floored to 0)
    expect(wallet.ledgerFor("k1")).toHaveLength(0);
  });

  it("refuses a charge on an unprovisioned wallet", () => {
    const r = wallet.chargeUsd("ghost", 1, "plan_subscribe:x");
    expect(r.ok).toBe(false);
    expect(wallet.isProvisioned("ghost")).toBe(false);
  });

  it("zero/negative charge is a no-op success", () => {
    wallet.topupUsd("k1", 5);
    expect(wallet.chargeUsd("k1", 0, "noop").ok).toBe(true);
    expect(wallet.getUsd("k1")).toBe(5);
    expect(wallet.ledgerFor("k1")).toHaveLength(0);
  });
});

describe("SpendLedgerService.resetMonth", () => {
  let ledger: SpendLedgerService;
  beforeEach(() => {
    ledger = new SpendLedgerService();
  });

  it("zeroes the month counter but leaves hour/day untouched", () => {
    ledger.reserve({ scope: "key:k1:grp:claude", estimateUsd: 1 });
    const before = ledger.peek("key:k1:grp:claude")!;
    before.hour = 0.3;
    before.day = 0.8;
    before.month = 12;
    ledger.resetMonth("key:k1:grp:claude");
    const after = ledger.peek("key:k1:grp:claude")!;
    expect(after.month).toBe(0);
    expect(after.hour).toBe(0.3);
    expect(after.day).toBe(0.8);
  });

  it("is a no-op for a scope never seen", () => {
    expect(() => ledger.resetMonth("key:none:grp:claude")).not.toThrow();
    expect(ledger.peek("key:none:grp:claude")).toBeUndefined();
  });
});
