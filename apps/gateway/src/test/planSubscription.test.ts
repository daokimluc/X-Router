import { describe, expect, it, beforeEach } from "vitest";
import { PlanSubscriptionService } from "../marketplace/services/PlanSubscriptionService.js";
import { WalletService } from "../marketplace/services/WalletService.js";
import { PlanService } from "../marketplace/services/PlanService.js";
import { SpendLedgerService } from "../services/SpendLedgerService.js";
import { ApiKeyService } from "../services/ApiKeyService.js";
import { WebhookService } from "../services/WebhookService.js";
import { addOneCalendarMonth } from "../marketplace/utils/subscriptionPeriod.js";
import { makeTestDb } from "./helpers.js";

/** Capture business webhook emissions without network. */
class RecordingWebhook extends WebhookService {
  events: Array<{ event: string; data: Record<string, unknown> }> = [];
  override async notifyBusiness(event: never, data: Record<string, unknown>): Promise<void> {
    this.events.push({ event, data });
  }
}

function setup(now: () => number) {
  const wallet = new WalletService(makeTestDb());
  const plans = new PlanService();
  const ledger = new SpendLedgerService();
  const keys = new ApiKeyService();
  const webhook = new RecordingWebhook();
  const svc = new PlanSubscriptionService({
    apiKeyService: keys,
    walletService: wallet,
    planService: plans,
    spendLedgerService: ledger,
    webhookService: webhook,
    now
  });
  const key = keys.create({ owner: "buyer" });
  return { wallet, plans, ledger, keys, webhook, svc, keyId: key.id };
}

const T0 = Date.UTC(2026, 5, 1, 12, 0, 0, 0); // 2026-06-01T12:00Z

describe("PlanSubscriptionService.subscribe", () => {
  it("charges a funded wallet, binds the plan, sets the period, resets buckets", () => {
    const { svc, wallet, keys, ledger, keyId } = setup(() => T0);
    wallet.topupUsd(keyId, 25);
    ledger.reserve({ scope: `key:${keyId}:grp:claude`, estimateUsd: 5 }); // pre-spend
    const plan = new PlanService().get("plan_claude")!;
    const r = svc.subscribe(keyId, plan);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.planId).toBe("plan_claude");
      expect(r.walletUsd).toBe(15);
      expect(r.planPeriodEnd).toBe(addOneCalendarMonth(T0));
      expect(r.planChargedAt).toBe(T0);
    }
    expect(keys.findById(keyId)!.planId).toBe("plan_claude");
    expect(keys.findById(keyId)!.planPeriodEnd).toBe(addOneCalendarMonth(T0));
    expect(ledger.peek(`key:${keyId}:grp:claude`)!.month).toBe(0); // reset
  });

  it("rejects an underfunded subscribe — plan not bound, no debit", () => {
    const { svc, wallet, keys, plans, keyId } = setup(() => T0);
    wallet.topupUsd(keyId, 4);
    const r = svc.subscribe(keyId, plans.get("plan_claude")!);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("insufficient_funds");
    expect(keys.findById(keyId)!.planId).toBeUndefined();
    expect(wallet.getUsd(keyId)).toBe(4);
  });

  it("Free ($0) plan binds with no charge and no period", () => {
    const { svc, wallet, keys, plans, keyId } = setup(() => T0);
    wallet.topupUsd(keyId, 1);
    const r = svc.subscribe(keyId, plans.get("plan_free")!);
    expect(r.ok).toBe(true);
    expect(keys.findById(keyId)!.planId).toBe("plan_free");
    expect(keys.findById(keyId)!.planPeriodEnd).toBeUndefined();
    expect(wallet.getUsd(keyId)).toBe(1);
  });

  it("re-subscribing the same active plan is idempotent — no second charge", () => {
    const { svc, wallet, plans, keyId } = setup(() => T0);
    wallet.topupUsd(keyId, 25);
    svc.subscribe(keyId, plans.get("plan_claude")!);
    expect(wallet.getUsd(keyId)).toBe(15);
    const again = svc.subscribe(keyId, plans.get("plan_claude")!);
    expect(again.ok && again.idempotent).toBe(true);
    expect(wallet.getUsd(keyId)).toBe(15); // unchanged
  });

  it("switching to a pricier plan charges the new plan in full", () => {
    const { svc, wallet, keys, plans, keyId } = setup(() => T0);
    wallet.topupUsd(keyId, 40);
    svc.subscribe(keyId, plans.get("plan_claude")!); // −10 → 30
    const sw = svc.subscribe(keyId, plans.get("plan_pro")!); // −20 → 10
    expect(sw.ok).toBe(true);
    expect(wallet.getUsd(keyId)).toBe(10);
    expect(keys.findById(keyId)!.planId).toBe("plan_pro");
  });

  it("cancel unbinds the plan and clears the period (no refund)", () => {
    const { svc, wallet, keys, plans, keyId } = setup(() => T0);
    wallet.topupUsd(keyId, 25);
    svc.subscribe(keyId, plans.get("plan_claude")!);
    svc.cancel(keyId);
    expect(keys.findById(keyId)!.planId).toBeUndefined();
    expect(keys.findById(keyId)!.planPeriodEnd).toBeUndefined();
    expect(wallet.getUsd(keyId)).toBe(15); // no refund of the $10
  });
});

describe("PlanSubscriptionService.renewIfDue", () => {
  it("charges + advances the period + resets the bucket + emits plan.renewed when due and funded", () => {
    let now = T0;
    const { svc, wallet, keys, ledger, webhook, plans, keyId } = setup(() => now);
    wallet.topupUsd(keyId, 25);
    svc.subscribe(keyId, plans.get("plan_claude")!); // −10 → 15, period = +1mo
    const firstEnd = keys.findById(keyId)!.planPeriodEnd!;
    // spend into the month bucket, then jump to the period boundary
    ledger.reserve({ scope: `key:${keyId}:grp:claude`, estimateUsd: 7 });
    now = firstEnd + 1000;
    const r = svc.renewIfDue(keyId);
    expect(r.changed && r.kind).toBe("renewed");
    expect(wallet.getUsd(keyId)).toBe(5); // another −10
    expect(keys.findById(keyId)!.planPeriodEnd).toBe(addOneCalendarMonth(firstEnd));
    expect(ledger.peek(`key:${keyId}:grp:claude`)!.month).toBe(0);
    expect(webhook.events.some((e) => e.event === "plan.renewed")).toBe(true);
  });

  it("downgrades to Free + emits plan.downgraded when due and underfunded", () => {
    let now = T0;
    const { svc, wallet, keys, webhook, plans, keyId } = setup(() => now);
    wallet.topupUsd(keyId, 10);
    svc.subscribe(keyId, plans.get("plan_claude")!); // −10 → 0
    const firstEnd = keys.findById(keyId)!.planPeriodEnd!;
    now = firstEnd + 1000;
    const r = svc.renewIfDue(keyId);
    expect(r.changed && r.kind).toBe("downgraded");
    expect(keys.findById(keyId)!.planId).toBeUndefined();
    expect(keys.findById(keyId)!.planPeriodEnd).toBeUndefined();
    const dg = webhook.events.find((e) => e.event === "plan.downgraded");
    expect(dg?.data.reason).toBe("renewal_underfunded");
  });

  it("is not due before the period boundary", () => {
    let now = T0;
    const { svc, wallet, plans, keyId } = setup(() => now);
    wallet.topupUsd(keyId, 25);
    svc.subscribe(keyId, plans.get("plan_claude")!);
    now = T0 + 1000; // still within the period
    const r = svc.renewIfDue(keyId);
    expect(r.changed).toBe(false);
    expect(wallet.getUsd(keyId)).toBe(15); // no second charge
  });

  it("grandfathers a legacy plan-bound key (no period) with no charge", () => {
    const { svc, wallet, keys, keyId } = setup(() => T0);
    wallet.topupUsd(keyId, 25);
    // simulate an old free-subscribe: plan bound, NO period fields
    keys.update(keyId, { planId: "plan_claude" });
    const r = svc.renewIfDue(keyId);
    expect(r.changed && r.kind).toBe("grandfathered");
    expect(wallet.getUsd(keyId)).toBe(25); // not billed retroactively
    expect(keys.findById(keyId)!.planPeriodEnd).toBe(addOneCalendarMonth(T0));
  });

  it("never double-charges: a second renewIfDue at the same instant sees the advanced period", () => {
    let now = T0;
    const { svc, wallet, keys, plans, keyId } = setup(() => now);
    wallet.topupUsd(keyId, 30);
    svc.subscribe(keyId, plans.get("plan_claude")!); // −10 → 20
    const firstEnd = keys.findById(keyId)!.planPeriodEnd!;
    now = firstEnd + 1000;
    svc.renewIfDue(keyId); // −10 → 10, advances period
    const second = svc.renewIfDue(keyId); // period already advanced → not due
    expect(second.changed).toBe(false);
    expect(wallet.getUsd(keyId)).toBe(10); // only ONE renewal charge
  });

  it("noop for a plan-less key", () => {
    const { svc, keyId } = setup(() => T0);
    expect(svc.renewIfDue(keyId).changed).toBe(false);
  });
});
