import { describe, expect, it } from "vitest";
import { microToUsd, usdToMicro } from "../marketplace/utils/money.js";

describe("money helpers", () => {
  it("round-trips awkward USD values without drift", () => {
    for (const usd of [0, 0.1, 0.0004, 19.9996, 20, 0.000001, 123.456789]) {
      expect(microToUsd(usdToMicro(usd))).toBeCloseTo(usd, 6);
    }
  });

  it("usdToMicro produces exact integers", () => {
    expect(usdToMicro(20)).toBe(20_000_000);
    expect(usdToMicro(0.0004)).toBe(400);
    expect(usdToMicro(19.9996)).toBe(19_999_600);
    expect(usdToMicro(0)).toBe(0);
    expect(Number.isInteger(usdToMicro(0.123456))).toBe(true);
  });

  it("no float drift after 1000 sequential sub-cent debits", () => {
    // Start at $1.00, debit $0.0004 a thousand times → $0.60 exactly.
    let micro = usdToMicro(1.0);
    const debit = usdToMicro(0.0004);
    for (let i = 0; i < 1000; i++) {
      micro -= debit;
    }
    expect(micro).toBe(600_000); // $0.60 to the micro-USD
    expect(microToUsd(micro)).toBeCloseTo(0.6, 6);
  });
});
