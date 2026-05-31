import { describe, expect, it } from "vitest";
import { createCandidateRanker, routedContextFor } from "../marketplace/policy/marketplaceRouting.js";
import { SellerService, HOUSE_SELLER_ID } from "../marketplace/services/SellerService.js";
import { MarketPricingService } from "../marketplace/services/MarketPricingService.js";
import { MarketplaceSeam } from "../services/MarketplaceSeam.js";
import type { ResolvedModelCandidate } from "../router/ModelResolver.js";

function cand(providerInstanceId: string): ResolvedModelCandidate {
  return { publicModel: "gpt-5.5", providerInstanceId, providerType: "kiro", upstreamModel: "gpt-5.5", capabilities: ["chat"] };
}

/**
 * Build a SellerService with one listing per seller for gpt-5.5, each on its own
 * provider instance, so listingCostFor maps instanceId → cost (the ranker's input).
 */
function sellersWithListings(costs: Array<{ sellerId: string; instance: string; account: string; inPerM: number; outPerM: number; approved?: boolean }>) {
  const svc = new SellerService();
  for (const c of costs) {
    if (c.sellerId !== HOUSE_SELLER_ID) {
      // register + approve a real seller whose displayName drives the namespaced name
      const s = svc.register({ displayName: c.sellerId });
      if (c.approved !== false) svc.approve(s.id);
      svc.createListing({ sellerId: s.id, baseModel: "gpt-5.5", costPrice: { inputPerM: c.inPerM, outputPerM: c.outPerM }, providerInstanceId: c.instance, providerAccountId: c.account });
      c.sellerId = s.id; // capture generated id for assertions
    } else {
      svc.createListing({ sellerId: HOUSE_SELLER_ID, baseModel: "gpt-5.5", costPrice: { inputPerM: c.inPerM, outputPerM: c.outPerM }, providerInstanceId: c.instance, providerAccountId: c.account });
    }
  }
  return svc;
}

describe("lowest-cost-routing-wiring: candidate ranker", () => {
  it("orders candidates cheapest-seller-first", () => {
    const svc = sellersWithListings([
      { sellerId: "hoang", instance: "pi_hoang", account: "a_hoang", inPerM: 2.4, outPerM: 7.2 },
      { sellerId: HOUSE_SELLER_ID, instance: "pi_house", account: "a_house", inPerM: 2.3, outPerM: 6.9 },
      { sellerId: "cinb", instance: "pi_cinb", account: "a_cinb", inPerM: 2.1, outPerM: 6.3 },
    ]);
    const rank = createCandidateRanker(svc);
    const ordered = rank("gpt-5.5", [cand("pi_hoang"), cand("pi_house"), cand("pi_cinb")]);
    expect(ordered.map((c) => c.providerInstanceId)).toEqual(["pi_cinb", "pi_house", "pi_hoang"]);
  });

  it("house (lowest) ranks at or below third-party", () => {
    const svc = sellersWithListings([
      { sellerId: "hoang", instance: "pi_hoang", account: "a_hoang", inPerM: 2.4, outPerM: 7.0 },
      { sellerId: HOUSE_SELLER_ID, instance: "pi_house", account: "a_house", inPerM: 2.3, outPerM: 6.9 },
    ]);
    const rank = createCandidateRanker(svc);
    const ordered = rank("gpt-5.5", [cand("pi_hoang"), cand("pi_house")]);
    expect(ordered[0].providerInstanceId).toBe("pi_house");
  });

  it("uncosted candidate is appended after costed ones, preserving order", () => {
    const svc = sellersWithListings([
      { sellerId: "cinb", instance: "pi_cinb", account: "a_cinb", inPerM: 2.1, outPerM: 6.3 },
    ]);
    const rank = createCandidateRanker(svc);
    // pi_unknown has no listing → must sort last
    const ordered = rank("gpt-5.5", [cand("pi_unknown"), cand("pi_cinb")]);
    expect(ordered.map((c) => c.providerInstanceId)).toEqual(["pi_cinb", "pi_unknown"]);
  });

  it("single candidate is returned untouched", () => {
    const svc = new SellerService();
    const rank = createCandidateRanker(svc);
    const one = [cand("pi_x")];
    expect(rank("gpt-5.5", one)).toBe(one);
  });
});

describe("lowest-cost-routing-wiring: routedContextFor (by leased account)", () => {
  it("resolves seller + sell rates from the leased account", () => {
    const svc = sellersWithListings([
      { sellerId: "hoang", instance: "pi_hoang", account: "a_hoang", inPerM: 2.4, outPerM: 7.0 },
    ]);
    const pricing = new MarketPricingService(); // 0.15
    const sellerId = svc.listSellers({ status: "approved" }).find((s) => s.displayName === "hoang")!.id;
    const routed = routedContextFor(svc, pricing, "gpt-5.5", "a_hoang");
    expect(routed?.sellerId).toBe(sellerId);
    expect(routed?.sellRates.inputPerM).toBeCloseTo(2.4 * 1.15, 6);
    // unknown account → null (settlement no-routed fallback)
    expect(routedContextFor(svc, pricing, "gpt-5.5", "a_missing")).toBeNull();
  });
});

describe("MarketplaceSeam: ranker + routed capture", () => {
  it("rankCandidates is identity when no ranker is set", () => {
    const seam = new MarketplaceSeam();
    const cands = [cand("a"), cand("b")];
    expect(seam.rankCandidates("gpt-5.5", cands)).toBe(cands);
  });

  it("captureRouted is a no-op when unset, runs the registered fn otherwise", () => {
    const seam = new MarketplaceSeam();
    const req = {} as never;
    seam.captureRouted(req, "gpt-5.5", "acct"); // no throw, no-op
    let called: string | null = null;
    seam.setRoutedCapture((_r, _m, accountId) => { called = accountId; });
    seam.captureRouted(req, "gpt-5.5", "acct");
    expect(called).toBe("acct");
  });

  it("rankCandidates swallows a throwing ranker and falls back to input order", () => {
    const seam = new MarketplaceSeam();
    seam.setCandidateRanker(() => { throw new Error("boom"); });
    const cands = [cand("a"), cand("b")];
    expect(seam.rankCandidates("gpt-5.5", cands)).toBe(cands);
  });
});
