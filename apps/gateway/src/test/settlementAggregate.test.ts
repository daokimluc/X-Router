import { describe, expect, it } from "vitest";
import { WalletService } from "../marketplace/services/WalletService.js";
import { SellerEarningsLedger } from "../marketplace/services/SellerEarningsLedger.js";
import { SettlementLedger } from "../marketplace/services/SettlementLedger.js";
import { SpendLedgerService } from "../services/SpendLedgerService.js";
import { makeTestDb } from "./helpers.js";

function build() {
  const db = makeTestDb();
  const wallet = new WalletService(db);
  const earnings = new SellerEarningsLedger(db);
  const ledger = new SettlementLedger(db, wallet, earnings, new SpendLedgerService());
  return { db, ledger };
}

function rec(ledger: SettlementLedger, sellerId: string, baseModel: string, p: number, c: number) {
  return ledger.record({
    buyerKeyId: "b1", baseModel, sellerId, promptTokens: p, completionTokens: c,
    collected: 0.003, sellerCredit: 0.002, platformMargin: 0.001, billTrack: "payg"
  });
}

describe("SettlementLedger.aggregateByModel", () => {
  it("sums requests + tokens grouped by (sellerId, baseModel)", () => {
    const { ledger } = build();
    rec(ledger, "s1", "gpt-5.5", 100, 50);
    rec(ledger, "s1", "gpt-5.5", 200, 80);
    rec(ledger, "s1", "claude-opus-4-8", 10, 5);
    rec(ledger, "s2", "gpt-5.5", 1, 1);

    const agg = ledger.aggregateByModel();
    const find = (s: string, m: string) => agg.find((a) => a.sellerId === s && a.baseModel === m);

    expect(find("s1", "gpt-5.5")).toMatchObject({ requests: 2, promptTokens: 300, completionTokens: 130 });
    expect(find("s1", "claude-opus-4-8")).toMatchObject({ requests: 1, promptTokens: 10, completionTokens: 5 });
    expect(find("s2", "gpt-5.5")).toMatchObject({ requests: 1, promptTokens: 1, completionTokens: 1 });
  });

  it("excludes reversed settlements", () => {
    const { ledger } = build();
    rec(ledger, "s1", "gpt-5.5", 100, 50);
    const reversedId = rec(ledger, "s1", "gpt-5.5", 999, 999);
    ledger.reverseSettlement(reversedId);

    const agg = ledger.aggregateByModel();
    const row = agg.find((a) => a.sellerId === "s1" && a.baseModel === "gpt-5.5")!;
    expect(row.requests).toBe(1);
    expect(row.promptTokens).toBe(100);
    expect(row.completionTokens).toBe(50);
  });

  it("respects the since window", () => {
    const { ledger } = build();
    rec(ledger, "s1", "gpt-5.5", 100, 50);
    // Everything is "now"; a future `since` excludes all.
    const future = new Date(Date.now() + 60_000);
    expect(ledger.aggregateByModel({ since: future })).toHaveLength(0);
    // A past `since` includes it.
    const past = new Date(Date.now() - 60_000);
    expect(ledger.aggregateByModel({ since: past })).toHaveLength(1);
  });
});
