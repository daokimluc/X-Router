import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import {
  ResponseCacheService,
  buildCacheKey,
  resolveCacheMode
} from "../services/ResponseCacheService.js";

describe("buildCacheKey (Phase 32)", () => {
  it("produces same hash for identical inputs", () => {
    const a = buildCacheKey({
      model: "gpt-4o",
      protocol: "openai",
      messages: [{ role: "user", content: "hi" }],
      temperature: 0
    });
    const b = buildCacheKey({
      model: "gpt-4o",
      protocol: "openai",
      messages: [{ role: "user", content: "hi" }],
      temperature: 0
    });
    expect(a).toBe(b);
  });

  it("differs when temperature differs", () => {
    const a = buildCacheKey({
      model: "gpt-4o",
      protocol: "openai",
      messages: [{ role: "user", content: "hi" }],
      temperature: 0
    });
    const b = buildCacheKey({
      model: "gpt-4o",
      protocol: "openai",
      messages: [{ role: "user", content: "hi" }],
      temperature: 0.1
    });
    expect(a).not.toBe(b);
  });

  it("apiKeyHash isolates cache per key", () => {
    const a = buildCacheKey({
      model: "gpt-4o",
      protocol: "openai",
      messages: [{ role: "user", content: "hi" }],
      apiKeyHash: "key-a"
    });
    const b = buildCacheKey({
      model: "gpt-4o",
      protocol: "openai",
      messages: [{ role: "user", content: "hi" }],
      apiKeyHash: "key-b"
    });
    expect(a).not.toBe(b);
  });

  it("openai vs anthropic protocol produces different keys", () => {
    const a = buildCacheKey({
      model: "claude-opus-4",
      protocol: "openai",
      messages: [{ role: "user", content: "hi" }]
    });
    const b = buildCacheKey({
      model: "claude-opus-4",
      protocol: "anthropic",
      messages: [{ role: "user", content: "hi" }]
    });
    expect(a).not.toBe(b);
  });
});

describe("ResponseCacheService (Phase 32)", () => {
  let svc: ResponseCacheService;

  beforeEach(() => {
    svc = new ResponseCacheService(100, 100_000);
  });

  afterEach(() => {
    svc.stop();
    vi.useRealTimers();
  });

  it("read returns null on miss", () => {
    expect(svc.read("nonexistent")).toBeNull();
  });

  it("write then read returns payload", () => {
    svc.write("k1", { hello: "world" }, "gpt-4o");
    expect(svc.read("k1")).toEqual({ hello: "world" });
  });

  it("LRU eviction by entry count", () => {
    const small = new ResponseCacheService(3, 100_000_000);
    small.write("a", { v: 1 }, "m");
    small.write("b", { v: 2 }, "m");
    small.write("c", { v: 3 }, "m");
    small.write("d", { v: 4 }, "m"); // should evict 'a'
    expect(small.read("a")).toBeNull();
    expect(small.read("d")).toEqual({ v: 4 });
    small.stop();
  });

  it("LRU touch on read prevents eviction", () => {
    const small = new ResponseCacheService(3, 100_000_000);
    small.write("a", { v: 1 }, "m");
    small.write("b", { v: 2 }, "m");
    small.write("c", { v: 3 }, "m");
    // Touch 'a'
    small.read("a");
    small.write("d", { v: 4 }, "m"); // 'b' is now LRU and gets evicted
    expect(small.read("a")).toEqual({ v: 1 });
    expect(small.read("b")).toBeNull();
    small.stop();
  });

  it("eviction by byte cap", () => {
    const small = new ResponseCacheService(1000, 200);
    const blob = "x".repeat(80);
    small.write("a", blob, "m"); // ~84 bytes
    small.write("b", blob, "m"); // ~84 bytes
    small.write("c", blob, "m"); // would push to ~252 bytes; evict 'a'
    expect(small.read("a")).toBeNull();
    small.stop();
  });

  it("TTL expiry on read", () => {
    const ttlSec = 1;
    svc.write("k", { v: 1 }, "m", ttlSec);
    expect(svc.read("k")).toEqual({ v: 1 });
    // Force expiry
    vi.useFakeTimers();
    vi.advanceTimersByTime(2000);
    expect(svc.read("k")).toBeNull();
    vi.useRealTimers();
  });

  it("delete with prefix only clears matching", () => {
    svc.write("abc123", { v: 1 }, "m");
    svc.write("abc456", { v: 2 }, "m");
    svc.write("xyz789", { v: 3 }, "m");
    const cleared = svc.delete("abc");
    expect(cleared).toBe(2);
    expect(svc.read("xyz789")).toEqual({ v: 3 });
  });

  it("delete with no prefix clears all", () => {
    svc.write("a", { v: 1 }, "m");
    svc.write("b", { v: 2 }, "m");
    const cleared = svc.delete();
    expect(cleared).toBe(2);
    expect(svc.size()).toBe(0);
  });

  it("stats accumulate hits and misses", () => {
    svc.write("k", { v: 1 }, "m");
    svc.read("k"); // hit
    svc.read("k"); // hit
    svc.read("nope"); // miss
    const s = svc.stats();
    expect(s.hits).toBe(2);
    expect(s.misses).toBe(1);
    expect(s.hitRatio).toBe(0.667);
  });

  it("stats topHot is bounded to 20", () => {
    for (let i = 0; i < 25; i++) {
      svc.write(`k${i}`, { v: i }, "m");
      svc.read(`k${i}`); // 1 hit each
    }
    const s = svc.stats();
    expect(s.topHot).toHaveLength(20);
  });
});

describe("resolveCacheMode (Phase 32)", () => {
  it("default is skip", () => {
    expect(resolveCacheMode({})).toBe("skip");
  });

  it("explicit body mode wins", () => {
    expect(resolveCacheMode({ bodyMode: "use" })).toBe("use");
    expect(resolveCacheMode({ bodyMode: "refresh" })).toBe("refresh");
  });

  it("header mode used when body absent", () => {
    expect(resolveCacheMode({ headerMode: "use" })).toBe("use");
  });

  it("force_skip overrides client use", () => {
    expect(resolveCacheMode({ bodyMode: "use", apiKeyMode: "force_skip" })).toBe("skip");
  });

  it("force_use coerces client skip to use", () => {
    expect(resolveCacheMode({ bodyMode: "skip", apiKeyMode: "force_use" })).toBe("use");
  });

  it("stream always skip", () => {
    expect(resolveCacheMode({ bodyMode: "use", isStream: true })).toBe("skip");
  });

  it("temperature > 0 with top_p downgrades to skip", () => {
    expect(resolveCacheMode({ bodyMode: "use", temperature: 0.7, top_p: 0.9 })).toBe("skip");
  });

  it("temperature > 0 alone (no top_p/top_k) keeps mode", () => {
    expect(resolveCacheMode({ bodyMode: "use", temperature: 0.7 })).toBe("use");
  });

  it("temperature 0 keeps use", () => {
    expect(resolveCacheMode({ bodyMode: "use", temperature: 0, top_p: 0.5 })).toBe("use");
  });
});
