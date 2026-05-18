import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ModelCache } from "../providers/services/ModelCache.js";
import type { ProviderModel } from "../providers/base/types.js";

describe("ModelCache", () => {
  let cache: ModelCache;

  beforeEach(() => {
    cache = new ModelCache();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const mockModels: ProviderModel[] = [
    { id: "gpt-4", upstreamModel: "gpt-4" },
    { id: "gpt-3.5-turbo", upstreamModel: "gpt-3.5-turbo" },
  ];

  describe("get", () => {
    it("returns null for non-existent entry", () => {
      expect(cache.get("unknown-account")).toBeNull();
    });

    it("returns models for valid cached entry within TTL", () => {
      cache.set("account-1", mockModels);
      expect(cache.get("account-1")).toEqual(mockModels);
    });

    it("returns null for expired entry", () => {
      cache.set("account-1", mockModels);

      // Advance time past TTL (5 minutes)
      vi.advanceTimersByTime(300001);

      expect(cache.get("account-1")).toBeNull();
    });

    it("returns models just before TTL expires", () => {
      cache.set("account-1", mockModels);

      // Advance time to just before TTL
      vi.advanceTimersByTime(299999);

      expect(cache.get("account-1")).toEqual(mockModels);
    });
  });

  describe("set", () => {
    it("stores models with default TTL", () => {
      cache.set("account-1", mockModels);
      expect(cache.get("account-1")).toEqual(mockModels);
    });

    it("stores models with custom TTL", () => {
      cache.set("account-1", mockModels, 60000); // 1 minute TTL

      vi.advanceTimersByTime(59999);
      expect(cache.get("account-1")).toEqual(mockModels);

      vi.advanceTimersByTime(2);
      expect(cache.get("account-1")).toBeNull();
    });

    it("overwrites existing entry", () => {
      const newModels: ProviderModel[] = [
        { id: "claude-3", upstreamModel: "claude-3" },
      ];

      cache.set("account-1", mockModels);
      cache.set("account-1", newModels);

      expect(cache.get("account-1")).toEqual(newModels);
    });
  });

  describe("invalidate", () => {
    it("removes cached entry", () => {
      cache.set("account-1", mockModels);
      cache.invalidate("account-1");
      expect(cache.get("account-1")).toBeNull();
    });

    it("does not throw for non-existent entry", () => {
      expect(() => cache.invalidate("unknown")).not.toThrow();
    });
  });
});
