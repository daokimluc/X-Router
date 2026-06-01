import { describe, expect, it } from "vitest";
import { PlanRenewalMonitor } from "../marketplace/services/PlanRenewalMonitor.js";

describe("PlanRenewalMonitor.scan", () => {
  it("calls renewIfDue only for plan-bound keys past their period", () => {
    const now = 1_000_000;
    const renewed: string[] = [];
    const monitor = new PlanRenewalMonitor({
      now: () => now,
      renewIfDue: (id) => { renewed.push(id); return { changed: false }; },
      listKeys: () => [
        { id: "due", planId: "plan_claude", planPeriodEnd: now - 1 },     // due
        { id: "future", planId: "plan_claude", planPeriodEnd: now + 1000 }, // not due
        { id: "planless", planPeriodEnd: now - 1 },                         // no plan
        { id: "legacy", planId: "plan_claude" }                            // no period → renewIfDue (grandfather)
      ]
    });
    monitor.scan();
    expect(renewed.sort()).toEqual(["due", "legacy"]);
  });

  it("one throwing key does not stop the sweep", () => {
    const renewed: string[] = [];
    const monitor = new PlanRenewalMonitor({
      now: () => 100,
      renewIfDue: (id) => {
        if (id === "bad") throw new Error("boom");
        renewed.push(id);
        return { changed: false };
      },
      listKeys: () => [
        { id: "bad", planId: "p", planPeriodEnd: 0 },
        { id: "good", planId: "p", planPeriodEnd: 0 }
      ]
    });
    expect(() => monitor.scan()).not.toThrow();
    expect(renewed).toEqual(["good"]);
  });
});
