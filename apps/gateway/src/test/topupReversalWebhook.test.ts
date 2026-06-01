import { describe, expect, it } from "vitest";
import { Database } from "../services/Database.js";
import { WalletService } from "../marketplace/services/WalletService.js";
import { SellerService } from "../marketplace/services/SellerService.js";
import { MarketPricingService } from "../marketplace/services/MarketPricingService.js";
import { SellerEarningsLedger } from "../marketplace/services/SellerEarningsLedger.js";
import { SettlementLedger } from "../marketplace/services/SettlementLedger.js";
import { SpendLedgerService } from "../services/SpendLedgerService.js";
import { WebhookService } from "../services/WebhookService.js";

class RecordingWebhook extends WebhookService {
  events: Array<{ event: string; data: Record<string, unknown> }> = [];
  override async notifyBusiness(event: never, data: Record<string, unknown>): Promise<void> {
    this.events.push({ event, data });
  }
}

// ── Topup idempotency ───────────────────────────────────────────────────────
describe("topupUsdIdempotent", () => {
  it("credits once per idempotency key", () => {
    const wallet = new WalletService(new Database(":memory:"));
    const a = wallet.topupUsdIdempotent("k1", 10, "sepay_1");
    expect(a).toEqual({ walletUsd: 10, idempotent: false });
    const b = wallet.topupUsdIdempotent("k1", 10, "sepay_1"); // retry
    expect(b).toEqual({ walletUsd: 10, idempotent: true });
    expect(wallet.getUsd("k1")).toBe(10); // not 20
  });

  it("different keys both credit", () => {
    const wallet = new WalletService(new Database(":memory:"));
    wallet.topupUsdIdempotent("k1", 10, "sepay_1");
    wallet.topupUsdIdempotent("k1", 5, "sepay_2");
    expect(wallet.getUsd("k1")).toBe(15);
  });

  it("legacy topupUsd stays additive", () => {
    const wallet = new WalletService(new Database(":memory:"));
    wallet.topupUsd("k1", 10);
    wallet.topupUsd("k1", 10);
    expect(wallet.getUsd("k1")).toBe(20);
  });
});

// ── Reversal webhook + reversedAt ───────────────────────────────────────────
describe("settlement reversal webhook + reversedAt", () => {
  function setup() {
    const db = new Database(":memory:");
    const wallet = new WalletService(db);
    const sellers = new SellerService();
    const earnings = new SellerEarningsLedger(db);
    const ledger = new SpendLedgerService();
    const settlementLedger = new SettlementLedger(db, wallet, earnings, ledger);
    const webhook = new RecordingWebhook();
    settlementLedger.setWebhookService(webhook);
    return { wallet, settlementLedger, webhook };
  }

  it("emits settlement.reversed once and stamps reversedAt", () => {
    const { wallet, settlementLedger, webhook } = setup();
    wallet.topupUsd("k1", 5);
    const id = settlementLedger.record({ buyerKeyId: "k1", baseModel: "gpt-5.5", sellerId: "house", promptTokens: 100, completionTokens: 50, collected: 0.01, sellerCredit: 0, platformMargin: 0.01, billTrack: "payg" });

    expect(settlementLedger.reverseSettlement(id, "fraud")).toBe(true);
    const ev = webhook.events.find((e) => e.event === "settlement.reversed");
    expect(ev).toBeDefined();
    expect(ev?.data.settlementId).toBe(id);
    expect(typeof ev?.data.reversedAt).toBe("number");
    expect(ev?.data.collected).toBe(0.01);

    // re-reverse → no-op, no second emit
    expect(settlementLedger.reverseSettlement(id, "again")).toBe(false);
    expect(webhook.events.filter((e) => e.event === "settlement.reversed")).toHaveLength(1);
  });

  it("query reversedSince finds an old settlement's reversal regardless of original ts", () => {
    const { wallet, settlementLedger } = setup();
    wallet.topupUsd("k1", 5);
    const id = settlementLedger.record({ buyerKeyId: "k1", baseModel: "gpt-5.5", sellerId: "house", promptTokens: 100, completionTokens: 50, collected: 0.01, sellerCredit: 0, platformMargin: 0.01, billTrack: "payg" });
    const before = Date.now();
    settlementLedger.reverseSettlement(id);

    const res = settlementLedger.query({ reversedSince: new Date(before - 1000) });
    const row = res.data.find((r) => r.id === id);
    expect(row).toBeDefined();
    expect(row?.reversed).toBe(true);
    expect(typeof row?.reversedAt).toBe("number");

    // a non-reversed settlement is NOT returned by reversedSince
    const id2 = settlementLedger.record({ buyerKeyId: "k1", baseModel: "x", sellerId: "house", promptTokens: 1, completionTokens: 1, collected: 0.001, sellerCredit: 0, platformMargin: 0.001, billTrack: "payg" });
    const res2 = settlementLedger.query({ reversedSince: new Date(before - 1000) });
    expect(res2.data.some((r) => r.id === id2)).toBe(false);
  });
});

// ── Database v9 migration ───────────────────────────────────────────────────
describe("Database v9 migration", () => {
  it("adds settlement_log.reversed_at at schema v9", () => {
    const db = new Database(":memory:");
    expect((db.db.prepare("SELECT version FROM schema_meta LIMIT 1").get() as { version: number }).version).toBe(9);
    const cols = db.db.prepare("PRAGMA table_info(settlement_log)").all() as Array<{ name: string }>;
    expect(cols.some((c) => c.name === "reversed_at")).toBe(true);
    db.close();
  });
});
