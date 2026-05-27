import { describe, expect, it } from "vitest";
import {
  applyChannelOverrides,
  isValidStatusCodeMappingKey,
  validateHeaderOverride,
  RESERVED_HEADER_KEYS,
} from "../utils/channelOverride.js";
import type { ProviderInstance } from "../providers/base/ProviderInstance.js";

function makeInstance(overrides: Partial<ProviderInstance> = {}): ProviderInstance {
  return {
    id: "test-instance",
    type: "test",
    name: "Test",
    enabled: true,
    config: {},
    defaultTimeoutMs: 30000,
    maxRetries: 1,
    cooldownMs: 5000,
    accountSelectionStrategy: "round_robin",
    maxConcurrentRequests: 10,
    maxConcurrentRequestsPerAccount: 5,
    circuitBreaker: { enabled: false, failureThreshold: 5, cooldownMs: 30000, halfOpenMaxRequests: 1 },
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("applyChannelOverrides", () => {
  it("returns inputs unchanged when no override fields are set", () => {
    const instance = makeInstance();
    const body = { model: "gpt-4", max_tokens: 100 };
    const headers = { Authorization: "Bearer x" };
    const result = applyChannelOverrides(body, headers, instance);
    expect(result.body).toEqual(body);
    expect(result.headers).toEqual(headers);
  });

  it("shallow-merges paramOverride into body, override wins", () => {
    const instance = makeInstance({ paramOverride: { max_tokens: 4096, temperature: 0.5 } });
    const body = { model: "gpt-4", max_tokens: 100 };
    const result = applyChannelOverrides(body, {}, instance);
    expect(result.body).toEqual({ model: "gpt-4", max_tokens: 4096, temperature: 0.5 });
  });

  it("ignores empty paramOverride object", () => {
    const instance = makeInstance({ paramOverride: {} });
    const body = { model: "gpt-4" };
    const result = applyChannelOverrides(body, {}, instance);
    expect(result.body).toBe(body);
  });

  it("injects headerOverride entries", () => {
    const instance = makeInstance({ headerOverride: { "x-custom": "v1" } });
    const result = applyChannelOverrides({}, { Authorization: "Bearer x" }, instance);
    expect(result.headers).toEqual({ Authorization: "Bearer x", "x-custom": "v1" });
  });

  it("ignores reserved headers (case-insensitive)", () => {
    const instance = makeInstance({
      headerOverride: {
        "Authorization": "evil",
        "Content-Type": "text/plain",
        "X-Allowed": "ok",
      },
    });
    const result = applyChannelOverrides({}, { Authorization: "Bearer real" }, instance);
    expect(result.headers.Authorization).toBe("Bearer real");
    expect(result.headers["Content-Type"]).toBeUndefined();
    expect(result.headers["X-Allowed"]).toBe("ok");
  });

  it("does not mutate input objects", () => {
    const instance = makeInstance({ paramOverride: { max_tokens: 4096 } });
    const body = { model: "gpt-4", max_tokens: 100 };
    const headers = { x: "y" };
    applyChannelOverrides(body, headers, instance);
    expect(body).toEqual({ model: "gpt-4", max_tokens: 100 });
    expect(headers).toEqual({ x: "y" });
  });
});

describe("isValidStatusCodeMappingKey", () => {
  it.each([["100"], ["200"], ["404"], ["500"], ["599"], ["1xx"], ["2xx"], ["5xx"]])(
    "accepts %s",
    (key) => expect(isValidStatusCodeMappingKey(key)).toBe(true)
  );

  it.each([["099"], ["600"], ["abc"], [""], ["10"], ["10x"], ["xx5"], ["6xx"], ["0xx"]])(
    "rejects %s",
    (key) => expect(isValidStatusCodeMappingKey(key)).toBe(false)
  );
});

describe("validateHeaderOverride", () => {
  it("returns valid when no reserved keys present", () => {
    const result = validateHeaderOverride({ "x-custom": "v" });
    expect(result.valid).toBe(true);
    expect(result.reservedConflicts).toEqual([]);
  });

  it("flags reserved keys (case-insensitive)", () => {
    const result = validateHeaderOverride({
      "Authorization": "x",
      "content-type": "x",
      "X-OK": "x",
    });
    expect(result.valid).toBe(false);
    expect(result.reservedConflicts.sort()).toEqual(["Authorization", "content-type"]);
  });

  it("matches every reserved key", () => {
    for (const reserved of RESERVED_HEADER_KEYS) {
      const result = validateHeaderOverride({ [reserved]: "x" });
      expect(result.valid).toBe(false);
    }
  });
});
