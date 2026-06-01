import { describe, expect, it } from "vitest";
import { addOneCalendarMonth } from "../marketplace/utils/subscriptionPeriod.js";

/** Build an epoch-ms from UTC components for readable assertions. */
function utc(y: number, m: number, d: number, h = 0, min = 0): number {
  return Date.UTC(y, m - 1, d, h, min, 0, 0);
}

describe("addOneCalendarMonth", () => {
  it("advances same day-of-month for a normal month", () => {
    expect(addOneCalendarMonth(utc(2026, 6, 15, 9, 30))).toBe(utc(2026, 7, 15, 9, 30));
  });

  it("clamps Jan 31 → Feb 28 (non-leap)", () => {
    expect(addOneCalendarMonth(utc(2026, 1, 31))).toBe(utc(2026, 2, 28));
  });

  it("clamps Jan 31 → Feb 29 (leap year)", () => {
    expect(addOneCalendarMonth(utc(2028, 1, 31))).toBe(utc(2028, 2, 29));
  });

  it("clamps Mar 31 → Apr 30", () => {
    expect(addOneCalendarMonth(utc(2026, 3, 31))).toBe(utc(2026, 4, 30));
  });

  it("rolls December → January of the next year", () => {
    expect(addOneCalendarMonth(utc(2026, 12, 10, 12))).toBe(utc(2027, 1, 10, 12));
  });

  it("preserves time-of-day", () => {
    const from = utc(2026, 6, 1, 23, 59);
    const got = new Date(addOneCalendarMonth(from));
    expect(got.getUTCHours()).toBe(23);
    expect(got.getUTCMinutes()).toBe(59);
  });
});
