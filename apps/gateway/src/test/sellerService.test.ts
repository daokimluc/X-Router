import { describe, expect, it } from "vitest";
import { SellerService, HOUSE_SELLER_ID } from "../marketplace/services/SellerService.js";

describe("SellerService", () => {
  it("seeds the house seller as approved", () => {
    const svc = new SellerService();
    const house = svc.getSeller(HOUSE_SELLER_ID);
    expect(house?.status).toBe("approved");
  });

  it("register → pending; approve → approved; suspend → suspended", () => {
    const svc = new SellerService();
    const s = svc.register({ displayName: "hoang" });
    expect(s.status).toBe("pending");
    expect(svc.approve(s.id)?.status).toBe("approved");
    expect(svc.suspend(s.id)?.status).toBe("suspended");
  });

  it("reject removes a seller but never house", () => {
    const svc = new SellerService();
    const s = svc.register({ displayName: "x" });
    expect(svc.reject(s.id)).toBe(true);
    expect(svc.getSeller(s.id)).toBeUndefined();
    expect(svc.reject(HOUSE_SELLER_ID)).toBe(false);
  });

  it("listing requires an approved seller", () => {
    const svc = new SellerService();
    const s = svc.register({ displayName: "hoang" });
    expect(() =>
      svc.createListing({ sellerId: s.id, baseModel: "gpt-5.5", costPrice: { inputPerM: 2.4, outputPerM: 7 }, providerInstanceId: "p1", providerAccountId: "a1" })
    ).toThrow(/not approved/);
    svc.approve(s.id);
    const listing = svc.createListing({ sellerId: s.id, baseModel: "gpt-5.5", costPrice: { inputPerM: 2.4, outputPerM: 7 }, providerInstanceId: "p1", providerAccountId: "a1" });
    expect(listing.namespacedModel).toBe("hoang/gpt-5.5");
  });

  it("rejects a non-canonical base model", () => {
    const svc = new SellerService();
    const s = svc.register({ displayName: "hoang" });
    svc.approve(s.id);
    expect(() =>
      svc.createListing({ sellerId: s.id, baseModel: "not-a-real-model", costPrice: { inputPerM: 1, outputPerM: 1 }, providerInstanceId: "p1", providerAccountId: "a1" })
    ).toThrow(/canonical/);
  });

  it("listingCostFor returns enabled approved candidates incl. house", () => {
    const svc = new SellerService();
    // house listing
    const house = svc.createListing({ sellerId: HOUSE_SELLER_ID, baseModel: "gpt-5.5", costPrice: { inputPerM: 2.3, outputPerM: 6.5 }, providerInstanceId: "ph", providerAccountId: "ah" });
    // approved third-party
    const hoang = svc.register({ displayName: "hoang" });
    svc.approve(hoang.id);
    svc.createListing({ sellerId: hoang.id, baseModel: "gpt-5.5", costPrice: { inputPerM: 2.4, outputPerM: 7 }, providerInstanceId: "p1", providerAccountId: "a1" });

    const candidates = svc.listingCostFor("gpt-5.5");
    expect(candidates).toHaveLength(2);
    expect(candidates.map((c) => c.sellerId).sort()).toEqual([HOUSE_SELLER_ID, hoang.id].sort());

    // disabling the third-party leaves house in the pool
    const tp = svc.listListings("gpt-5.5").find((l) => l.sellerId === hoang.id)!;
    svc.setListingEnabled(tp.id, false);
    const after = svc.listingCostFor("gpt-5.5");
    expect(after).toHaveLength(1);
    expect(after[0].sellerId).toBe(HOUSE_SELLER_ID);
    void house;
  });

  it("persistence round-trip keeps sellers + listings; house preserved", () => {
    const svc = new SellerService();
    const s = svc.register({ displayName: "hoang", commissionPct: 0.08 });
    svc.approve(s.id);
    svc.createListing({ sellerId: s.id, baseModel: "gpt-5.5", costPrice: { inputPerM: 2.4, outputPerM: 7 }, providerInstanceId: "p1", providerAccountId: "a1" });

    const svc2 = new SellerService();
    svc2.load(svc.toPersisted());
    expect(svc2.getSeller(HOUSE_SELLER_ID)?.status).toBe("approved");
    expect(svc2.getSeller(s.id)?.commissionPct).toBe(0.08);
    expect(svc2.listListings("gpt-5.5")).toHaveLength(1);
  });
});
