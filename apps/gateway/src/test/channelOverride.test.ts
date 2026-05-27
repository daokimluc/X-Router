import { describe, expect, it } from "vitest";
import {
  applyChannelOverrides,
  applyChannelInputPolicies,
  estimateRequestTokens,
  isValidStatusCodeMappingKey,
  validateHeaderOverride,
  MaxInputTokensExceededError,
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

  it("override replaces existing header even with different case (no duplicate)", () => {
    const instance = makeInstance({ headerOverride: { "X-Custom": "v2" } });
    const result = applyChannelOverrides(
      {},
      { "x-custom": "v1", "Other-Header": "k" },
      instance
    );
    // Only one X-Custom should remain — the override wins.
    const customKeys = Object.keys(result.headers).filter(
      (k) => k.toLowerCase() === "x-custom"
    );
    expect(customKeys).toHaveLength(1);
    expect(result.headers[customKeys[0]]).toBe("v2");
    expect(result.headers["Other-Header"]).toBe("k");
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

describe("applyChannelInputPolicies (Phase 25)", () => {
  it("is a no-op when neither systemPromptOverride nor maxInputTokens set", () => {
    const body = { messages: [{ role: "user", content: "hi" }] };
    const result = applyChannelInputPolicies(body, makeInstance());
    expect(result).toBe(body);
  });

  it("prepends systemPromptOverride to OpenAI messages", () => {
    const body = { messages: [{ role: "user", content: "hi" }] };
    const result = applyChannelInputPolicies(body, makeInstance({ systemPromptOverride: "Be terse." }));
    expect(result.messages).toEqual([
      { role: "system", content: "Be terse." },
      { role: "user", content: "hi" }
    ]);
  });

  it("replaces existing system message in OpenAI messages", () => {
    const body = { messages: [
      { role: "system", content: "old" },
      { role: "user", content: "hi" }
    ]};
    const result = applyChannelInputPolicies(body, makeInstance({ systemPromptOverride: "new" }));
    expect((result.messages as Array<{ role: string; content: string }>)[0]).toEqual({
      role: "system",
      content: "new"
    });
  });

  it("sets Anthropic top-level system field", () => {
    const body = { model: "claude", max_tokens: 100, messages: [{ role: "user", content: "hi" }], system: "old" };
    const result = applyChannelInputPolicies(body as Record<string, unknown>, makeInstance({ systemPromptOverride: "new" }));
    expect(result.system).toBe("new");
  });

  it("throws MaxInputTokensExceededError when estimate exceeds limit", () => {
    const body = { messages: [{ role: "user", content: "x".repeat(1000) }] };
    expect(() =>
      applyChannelInputPolicies(body, makeInstance({ maxInputTokens: 100 }))
    ).toThrow(MaxInputTokensExceededError);
  });

  it("does not throw when within limit", () => {
    const body = { messages: [{ role: "user", content: "hi" }] };
    expect(() =>
      applyChannelInputPolicies(body, makeInstance({ maxInputTokens: 1000 }))
    ).not.toThrow();
  });
});

describe("estimateRequestTokens (Phase 25)", () => {
  it("rough character/4 estimate from messages", () => {
    // "user" (4) + "abcd" (4) = 8 chars / 4 = 2
    const body = { messages: [{ role: "user", content: "abcd" }] };
    expect(estimateRequestTokens(body)).toBe(2);
  });

  it("includes nested content array entries", () => {
    // "user" (4) + "text" (4) + "abcdefgh" (8) = 16 / 4 = 4
    const body = {
      messages: [
        { role: "user", content: [{ type: "text", text: "abcdefgh" }] }
      ]
    };
    expect(estimateRequestTokens(body)).toBe(4);
  });
});
