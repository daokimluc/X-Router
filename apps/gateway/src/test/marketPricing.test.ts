import { describe, expect, it } from "vitest";
import { MarketPricingService, DEFAULT_MARKUP } from "../marketplace/services/MarketPricingService.js";

describe("MarketPricingService", () => {
  it("applies the default markup to each rate", () => {
    const svc = new MarketPricingService();
    const sell = svc.sellPriceFor("gpt-5.5", { inputPerM: 2.1, outputPerM: 6.3 });
    expect(sell.inputPerM).toBeCloseTo(2.1 * (1 + DEFAULT_MARKUP), 6); // 2.415
    expect(sell.outputPerM).toBeCloseTo(6.3 * 1.15, 6);
  });

  it("per-model markup overrides the default", () => {
    const svc = new MarketPricingService();
    svc.setModelMarkup("gpt-5.5", 0.2);
    expect(svc.markupFor("gpt-5.5")).toBe(0.2);
    expect(svc.markupFor("claude-sonnet-4-6")).toBe(DEFAULT_MARKUP);
    const sell = svc.sellPriceFor("gpt-5.5", { inputPerM: 2.1, outputPerM: 6.3 });
    expect(sell.inputPerM).toBeCloseTo(2.1 * 1.2, 6);
  });

  it("markup 0 sells at cost; negative markup is rejected", () => {
    const svc = new MarketPricingService();
    svc.setModelMarkup("m", 0);
    expect(svc.sellPriceFor("m", { inputPerM: 5, outputPerM: 5 })).toMatchObject({ inputPerM: 5, outputPerM: 5 });
    expect(() => svc.setModelMarkup("m", -0.1)).toThrow(/>= 0/);
    expect(() => svc.setDefaultMarkup(-1)).toThrow(/>= 0/);
  });

  it("computes request sell cost from sell rates and tokens", () => {
    const svc = new MarketPricingService();
    // cost in 2.10 out 6.30, markup .15 → sell in 2.415 out 7.245
    // 1000 in, 500 out → (1000/1e6)*2.415 + (500/1e6)*7.245 = 0.002415 + 0.0036225 = 0.0060375
    const cost = svc.sellCostForRequest("gpt-5.5", { inputPerM: 2.1, outputPerM: 6.3 }, 1000, 500);
    expect(cost).toBeCloseTo(0.0060375, 7);
  });

  it("persistence round-trip", () => {
    const svc = new MarketPricingService();
    svc.setDefaultMarkup(0.25);
    svc.setModelMarkup("gpt-5.5", 0.2);
    const svc2 = new MarketPricingService();
    svc2.load(svc.toPersisted());
    expect(svc2.getDefaultMarkup()).toBe(0.25);
    expect(svc2.markupFor("gpt-5.5")).toBe(0.2);
  });
});
