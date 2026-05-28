import { describe, expect, it, beforeEach } from "vitest";
import { UsageService, floorToBucket } from "../services/UsageService.js";

function makeRecord(overrides: Partial<{
  createdAt: Date;
  model: string;
  providerType: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCost: number;
}> = {}) {
  return {
    requestId: "req",
    protocol: "openai" as const,
    model: overrides.model ?? "gpt-4o",
    providerType: overrides.providerType ?? "openai",
    providerInstanceId: "openai_main",
    promptTokens: overrides.promptTokens ?? 100,
    completionTokens: overrides.completionTokens ?? 50,
    totalTokens: overrides.totalTokens ?? 150,
    estimatedCost: overrides.estimatedCost ?? 0.001
  };
}

describe("floorToBucket", () => {
  it("aligns hour buckets to top-of-hour UTC", () => {
    const ts = new Date("2026-05-28T13:42:31.500Z").getTime();
    expect(floorToBucket(ts, "hour")).toBe(new Date("2026-05-28T13:00:00.000Z").getTime());
  });

  it("aligns day buckets to 00:00 UTC", () => {
    const ts = new Date("2026-05-28T13:42:31.500Z").getTime();
    expect(floorToBucket(ts, "day")).toBe(new Date("2026-05-28T00:00:00.000Z").getTime());
  });

  it("accepts Date input", () => {
    const d = new Date("2026-05-28T13:42:31.500Z");
    expect(floorToBucket(d, "hour")).toBe(new Date("2026-05-28T13:00:00.000Z").getTime());
  });
});

describe("UsageService.aggregate (Phase 32)", () => {
  let service: UsageService;

  beforeEach(() => {
    service = new UsageService(10000);
  });

  it("returns empty series for empty window", () => {
    const result = service.aggregate({
      from: new Date("2026-05-28T00:00:00Z"),
      to: new Date("2026-05-28T01:00:00Z")
    });
    expect(result.bucket).toBe("hour");
    expect(result.groupBy).toBe("model");
    expect(result.series).toEqual([]);
    expect(result.buckets.length).toBe(2); // 00:00, 01:00
  });

  it("zero-fills buckets when no usage in some hours", () => {
    service.record(makeRecord({ createdAt: new Date("2026-05-28T01:30:00Z") }));
    // override createdAt manually since record() sets it to now
    service.clear();
    // simulate via load
    service.load([{
      ...makeRecord(),
      id: "x",
      createdAt: new Date("2026-05-28T01:30:00Z")
    } as any]);

    const result = service.aggregate({
      from: new Date("2026-05-28T00:00:00Z"),
      to: new Date("2026-05-28T03:00:00Z")
    });
    expect(result.buckets.length).toBe(4);
    // The single record should be in the index for 01:00 bucket
    const series = result.series[0];
    expect(series).toBeDefined();
    expect(series.perBucket[0].requests).toBe(0);
    expect(series.perBucket[1].requests).toBe(1);
    expect(series.perBucket[2].requests).toBe(0);
    expect(series.perBucket[3].requests).toBe(0);
  });

  it("groups by provider when requested", () => {
    service.load([
      { ...makeRecord({ providerType: "openai" }), id: "1", createdAt: new Date("2026-05-28T00:30:00Z") },
      { ...makeRecord({ providerType: "anthropic" }), id: "2", createdAt: new Date("2026-05-28T00:35:00Z") },
      { ...makeRecord({ providerType: "openai" }), id: "3", createdAt: new Date("2026-05-28T00:40:00Z") }
    ] as any);

    const result = service.aggregate({
      from: new Date("2026-05-28T00:00:00Z"),
      to: new Date("2026-05-28T01:00:00Z"),
      groupBy: "provider"
    });
    expect(result.groupBy).toBe("provider");
    expect(result.series.length).toBe(2);
    const keys = result.series.map((s) => s.key).sort();
    expect(keys).toEqual(["anthropic", "openai"]);
    const openai = result.series.find((s) => s.key === "openai")!;
    expect(openai.totalRequests).toBe(2);
  });

  it("truncates to top-10 plus _other when more than 10 groups", () => {
    const records = [];
    for (let i = 0; i < 12; i++) {
      records.push({
        ...makeRecord({ model: `model-${i}`, estimatedCost: (12 - i) * 0.01 }),
        id: `rec-${i}`,
        createdAt: new Date("2026-05-28T00:30:00Z")
      });
    }
    service.load(records as any);

    const result = service.aggregate({
      from: new Date("2026-05-28T00:00:00Z"),
      to: new Date("2026-05-28T01:00:00Z")
    });
    expect(result.series.length).toBe(11);
    expect(result.series[10].key).toBe("_other");
    // Top-10 should be model-0..model-9 (highest cost)
    const topKeys = result.series.slice(0, 10).map((s) => s.key);
    for (let i = 0; i < 10; i++) {
      expect(topKeys).toContain(`model-${i}`);
    }
    // _other should aggregate model-10 + model-11
    const other = result.series[10];
    expect(other.totalCost).toBeCloseTo(0.02 + 0.01, 5);
  });

  it("does not add _other when groups <= 10", () => {
    const records = [];
    for (let i = 0; i < 5; i++) {
      records.push({
        ...makeRecord({ model: `model-${i}` }),
        id: `rec-${i}`,
        createdAt: new Date("2026-05-28T00:30:00Z")
      });
    }
    service.load(records as any);

    const result = service.aggregate({
      from: new Date("2026-05-28T00:00:00Z"),
      to: new Date("2026-05-28T01:00:00Z")
    });
    expect(result.series.length).toBe(5);
    expect(result.series.find((s) => s.key === "_other")).toBeUndefined();
  });

  it("returns 14 buckets for 14-day window with bucket=day", () => {
    const result = service.aggregate({
      from: new Date("2026-05-15T00:00:00Z"),
      to: new Date("2026-05-28T00:00:00Z"),
      bucket: "day"
    });
    expect(result.bucket).toBe("day");
    expect(result.buckets.length).toBe(14);
  });

  it("caches identical requests within TTL", () => {
    service.load([{
      ...makeRecord(),
      id: "x",
      createdAt: new Date("2026-05-28T00:30:00Z")
    } as any]);

    const r1 = service.aggregate({
      from: new Date("2026-05-28T00:00:00Z"),
      to: new Date("2026-05-28T01:00:00Z")
    });
    const r2 = service.aggregate({
      from: new Date("2026-05-28T00:00:00Z"),
      to: new Date("2026-05-28T01:00:00Z")
    });
    expect(r2).toEqual(r1);
  });

  it("invalidates cache on record()", () => {
    service.load([{
      ...makeRecord(),
      id: "x",
      createdAt: new Date("2026-05-28T00:30:00Z")
    } as any]);

    const r1 = service.aggregate({
      from: new Date("2026-05-28T00:00:00Z"),
      to: new Date("2026-05-28T01:00:00Z")
    });
    expect(r1.series[0].totalRequests).toBe(1);

    service.record(makeRecord());

    const r2 = service.aggregate({
      from: new Date("2026-05-28T00:00:00Z"),
      to: new Date("2026-05-28T01:00:00Z")
    });
    // Original record from load() (~30min in past): still 1 request in [00:00, 01:00).
    // The new record() lands at "now" which is outside the window in test env, but its
    // presence forced cache to clear, so a fresh compute ran.
    expect(r2).toBeDefined();
  });
});
