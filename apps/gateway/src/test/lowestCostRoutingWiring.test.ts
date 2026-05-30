import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { testConfig } from "./helpers.js";
import { buildCostFor, routedContextFor } from "../marketplace/policy/marketplaceRouting.js";
import { SellerService, HOUSE_SELLER_ID } from "../marketplace/services/SellerService.js";
import { MarketPricingService } from "../marketplace/services/MarketPricingService.js";

const ADMIN = "admin-key-1";
const apps: FastifyInstance[] = [];

afterEach(async () => {
  while (apps.length) {
    const a = apps.pop();
    if (a) await a.close();
  }
});

async function build() {
  const app = await buildApp(testConfig({ marketplaceEnabled: true, requestBodyLimit: "1mb" }));
  await app.ready();
  apps.push(app);
  return app;
}

describe("lowest-cost-routing wiring", () => {
  it("GET/PUT markup; rejects negative", async () => {
    const app = await build();
    const get = await app.inject({ method: "GET", url: "/admin/v1/markup", headers: { authorization: `Bearer ${ADMIN}` } });
    expect(get.statusCode).toBe(200);
    expect(get.json().defaultMarkup).toBe(0.15);

    const put = await app.inject({
      method: "PUT",
      url: "/admin/v1/markup",
      headers: { authorization: `Bearer ${ADMIN}` },
      payload: { defaultMarkup: 0.2, perModel: { "gpt-5.5": 0.25 } }
    });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toMatchObject({ defaultMarkup: 0.2, perModel: { "gpt-5.5": 0.25 } });

    const bad = await app.inject({
      method: "PUT",
      url: "/admin/v1/markup",
      headers: { authorization: `Bearer ${ADMIN}` },
      payload: { defaultMarkup: -1 }
    });
    expect(bad.statusCode).toBe(400);
  });

  it("buildCostFor + routedContextFor produce sell rates from listings", () => {
    const sellers = new SellerService();
    const pricing = new MarketPricingService(); // default markup 0.15

    // house listing + approved third-party
    sellers.createListing({ sellerId: HOUSE_SELLER_ID, baseModel: "gpt-5.5", costPrice: { inputPerM: 2.3, outputPerM: 6.9 }, providerInstanceId: "ph", providerAccountId: "ah" });
    const hoang = sellers.register({ displayName: "hoang" });
    sellers.approve(hoang.id);
    sellers.createListing({ sellerId: hoang.id, baseModel: "gpt-5.5", costPrice: { inputPerM: 2.4, outputPerM: 7.2 }, providerInstanceId: "p1", providerAccountId: "a1" });

    const costFor = buildCostFor(sellers, "gpt-5.5");
    expect(costFor).not.toBeNull();
    expect(costFor!("ah")).toMatchObject({ inputPerM: 2.3 });
    expect(costFor!("unknown")).toBeNull();

    const routed = routedContextFor(sellers, pricing, "gpt-5.5", "a1");
    expect(routed?.sellerId).toBe(hoang.id);
    expect(routed?.sellRates.inputPerM).toBeCloseTo(2.4 * 1.15, 6); // 2.76
    expect(routed?.costPrice.inputPerM).toBe(2.4);
  });

  it("buildCostFor returns null when no listings exist for the model", () => {
    const sellers = new SellerService();
    expect(buildCostFor(sellers, "no-listings")).toBeNull();
  });
});
