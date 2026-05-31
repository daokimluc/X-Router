import { describe, expect, it } from "vitest";
import { SupplyHealthMonitor, type SupplyHealthAccount } from "../marketplace/services/SupplyHealthMonitor.js";

function fakeWebhook() {
  const events: Array<{ event: string; data: Record<string, unknown> }> = [];
  return {
    events,
    svc: { notifyBusiness: async (event: string, data: Record<string, unknown>) => { events.push({ event, data }); } } as never
  };
}

function acct(id: string, sellerId: string | undefined, status: SupplyHealthAccount["status"], fails = 0): SupplyHealthAccount {
  return { id, sellerId, status, runtime: { consecutiveFailures: fails } };
}

describe("SupplyHealthMonitor", () => {
  it("emits supply.unhealthy once on the transition into unhealthy, re-arms on recovery", () => {
    let accounts: SupplyHealthAccount[] = [acct("a1", "hoang", "active", 0)];
    const wh = fakeWebhook();
    const mon = new SupplyHealthMonitor({ listAccounts: () => accounts, webhookService: wh.svc, failureThreshold: 3 });

    mon.scan();
    expect(wh.events.length).toBe(0); // healthy

    accounts = [acct("a1", "hoang", "disabled", 0)];
    mon.scan();
    expect(wh.events.length).toBe(1);
    expect(wh.events[0].data).toMatchObject({ sellerId: "hoang", providerAccountId: "a1", reason: "account_disabled" });

    mon.scan(); // still unhealthy → no duplicate
    expect(wh.events.length).toBe(1);

    accounts = [acct("a1", "hoang", "active", 0)];
    mon.scan(); // recovered → re-arm, still 1
    expect(wh.events.length).toBe(1);

    accounts = [acct("a1", "hoang", "active", 5)]; // now failing
    mon.scan();
    expect(wh.events.length).toBe(2);
    expect(wh.events[1].data).toMatchObject({ reason: "consecutive_failures" });
  });

  it("never reports house supply", () => {
    const wh = fakeWebhook();
    const mon = new SupplyHealthMonitor({ listAccounts: () => [acct("h1", "house", "disabled", 9), acct("h2", undefined, "cooldown", 9)], webhookService: wh.svc });
    mon.scan();
    expect(wh.events.length).toBe(0); // house + undefined-seller(=house) both skipped
  });

  it("cooldown is reported with the cooldown reason", () => {
    const wh = fakeWebhook();
    const mon = new SupplyHealthMonitor({ listAccounts: () => [acct("a1", "hoang", "cooldown", 0)], webhookService: wh.svc });
    mon.scan();
    expect(wh.events[0].data).toMatchObject({ reason: "account_cooldown" });
  });
});
