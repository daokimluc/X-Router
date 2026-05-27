import { describe, expect, it } from "vitest";
import { ModelRegistry, type ModelMapping } from "../router/ModelRegistry.js";
import { ModelResolver } from "../router/ModelResolver.js";
import { RoutingProfileRegistry, type RoutingProfile } from "../router/RoutingProfileRegistry.js";
import { interpretStatusCode } from "../utils/channelOverride.js";
import type { ProviderInstance } from "../providers/base/ProviderInstance.js";

const mappings: ModelMapping[] = [
  { id: "m-a", publicModel: "m-a", providerInstanceId: "inst-premium-a", providerType: "test", upstreamModel: "u", capabilities: ["chat"], enabled: true },
  { id: "m-b", publicModel: "m-b", providerInstanceId: "inst-premium-b", providerType: "test", upstreamModel: "u", capabilities: ["chat"], enabled: true },
  { id: "m-c", publicModel: "m-c", providerInstanceId: "inst-free-c", providerType: "test", upstreamModel: "u", capabilities: ["chat"], enabled: true },
  { id: "m-d", publicModel: "m-d", providerInstanceId: "inst-no-group", providerType: "test", upstreamModel: "u", capabilities: ["chat"], enabled: true },
];

const profile: RoutingProfile = {
  id: "test-profile",
  displayName: "Test",
  enabled: true,
  fallback: false,
  requiredCapabilities: ["chat"],
  candidates: ["m-a", "m-b", "m-c", "m-d"],
};

const groupLookup = (id: string): string | undefined => ({
  "inst-premium-a": "premium",
  "inst-premium-b": "premium",
  "inst-free-c": "free",
}[id]);

function makeResolver() {
  return new ModelResolver(
    new ModelRegistry(mappings),
    new RoutingProfileRegistry([profile]),
    undefined,
    undefined,
    groupLookup
  );
}

describe("ModelResolver group routing (Phase 20c)", () => {
  it("filters candidates to those matching key's group", () => {
    const resolver = makeResolver();
    const route = resolver.resolve("test-profile", ["chat"], { keyGroupName: "premium" });
    expect(route.candidates.map((c) => c.providerInstanceId)).toEqual([
      "inst-premium-a",
      "inst-premium-b",
    ]);
  });

  it("returns empty when no candidate matches and crossGroupRetry is false", () => {
    const resolver = makeResolver();
    const route = resolver.resolve("test-profile", ["chat"], { keyGroupName: "enterprise" });
    expect(route.candidates).toEqual([]);
  });

  it("falls back to all candidates when no in-group match and crossGroupRetry is true", () => {
    const resolver = makeResolver();
    const route = resolver.resolve("test-profile", ["chat"], {
      keyGroupName: "enterprise",
      crossGroupRetry: true,
    });
    expect(route.candidates).toHaveLength(4);
  });

  it("returns all candidates when key has no group", () => {
    const resolver = makeResolver();
    const route = resolver.resolve("test-profile", ["chat"], {});
    expect(route.candidates).toHaveLength(4);
  });

  it("does not affect fixed_model routes", () => {
    const resolver = makeResolver();
    const route = resolver.resolve("m-a", ["chat"], { keyGroupName: "free" });
    // Fixed model: group filter doesn't apply
    expect(route.routeType).toBe("fixed_model");
    expect(route.candidates).toHaveLength(1);
  });
});

function makeInstance(mapping: Partial<ProviderInstance> = {}): ProviderInstance {
  return {
    id: "x",
    type: "x",
    name: "x",
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
    ...mapping,
  };
}

describe("interpretStatusCode (Phase 20c)", () => {
  it("returns passthrough when no mapping configured", () => {
    expect(interpretStatusCode(makeInstance(), 401)).toBe("passthrough");
    expect(interpretStatusCode(makeInstance({ statusCodeMapping: {} }), 500)).toBe("passthrough");
  });

  it("returns exact match action", () => {
    const inst = makeInstance({ statusCodeMapping: { "401": "disable", "503": "retry" } });
    expect(interpretStatusCode(inst, 401)).toBe("disable");
    expect(interpretStatusCode(inst, 503)).toBe("retry");
  });

  it("returns family match when no exact match", () => {
    const inst = makeInstance({ statusCodeMapping: { "5xx": "retry" } });
    expect(interpretStatusCode(inst, 500)).toBe("retry");
    expect(interpretStatusCode(inst, 503)).toBe("retry");
    expect(interpretStatusCode(inst, 599)).toBe("retry");
  });

  it("prefers exact match over family match", () => {
    const inst = makeInstance({ statusCodeMapping: { "401": "passthrough", "4xx": "disable" } });
    expect(interpretStatusCode(inst, 401)).toBe("passthrough");
    expect(interpretStatusCode(inst, 403)).toBe("disable");
  });

  it("returns passthrough when neither exact nor family match", () => {
    const inst = makeInstance({ statusCodeMapping: { "5xx": "retry" } });
    expect(interpretStatusCode(inst, 401)).toBe("passthrough");
  });
});
