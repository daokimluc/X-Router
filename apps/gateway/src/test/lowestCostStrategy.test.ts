import { describe, expect, it } from "vitest";
import { LowestCostStrategy } from "../account-pool/LowestCostStrategy.js";
import type { ProviderAccount } from "../providers/base/ProviderAccount.js";
import type { CostPrice } from "../account-pool/types.js";

function acct(id: string, active = 0, priority?: number): ProviderAccount {
  return {
    id,
    providerInstanceId: "p1",
    providerType: "kiro",
    displayName: id,
    status: "active",
    weight: 1,
    priority,
    maxConcurrency: 10,
    credentialRef: "c1",
    runtime: { activeRequests: active, totalRequests: 0, failedRequests: 0, consecutiveFailures: 0 },
    createdAt: new Date(),
    updatedAt: new Date()
  };
}

function costFor(map: Record<string, CostPrice>) {
  return (id: string) => map[id] ?? null;
}

describe("LowestCostStrategy", () => {
  const strat = new LowestCostStrategy();
  const now = new Date();

  it("selects the cheapest candidate", () => {
    const accounts = [acct("cinb"), acct("house"), acct("hoang")];
    const picked = strat.select(accounts, {
      now,
      costFor: costFor({
        cinb: { inputPerM: 2.1, outputPerM: 6.3 },
        house: { inputPerM: 2.3, outputPerM: 6.9 },
        hoang: { inputPerM: 2.4, outputPerM: 7.2 }
      })
    });
    expect(picked?.id).toBe("cinb");
  });

  it("fails over to the next cheapest (house) when cheapest absent", () => {
    const accounts = [acct("house"), acct("hoang")]; // cinb unavailable
    const picked = strat.select(accounts, {
      now,
      costFor: costFor({
        house: { inputPerM: 2.3, outputPerM: 6.9 },
        hoang: { inputPerM: 2.4, outputPerM: 7.2 }
      })
    });
    expect(picked?.id).toBe("house");
  });

  it("breaks an equal-cost tie by least busy", () => {
    const accounts = [acct("a", 4), acct("b", 1)];
    const picked = strat.select(accounts, {
      now,
      costFor: costFor({ a: { inputPerM: 1, outputPerM: 1.2 }, b: { inputPerM: 1, outputPerM: 1.2 } })
    });
    expect(picked?.id).toBe("b");
  });

  it("excludes candidates with no cost", () => {
    const accounts = [acct("nocost"), acct("priced")];
    const picked = strat.select(accounts, {
      now,
      costFor: costFor({ priced: { inputPerM: 5, outputPerM: 5 } })
    });
    expect(picked?.id).toBe("priced");
  });

  it("returns null when no candidate has a cost", () => {
    const picked = strat.select([acct("x")], { now, costFor: () => null });
    expect(picked).toBeNull();
  });

  it("returns null without a cost lookup", () => {
    expect(strat.select([acct("x")], { now })).toBeNull();
  });
});
