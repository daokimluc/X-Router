import { describe, expect, it } from "vitest";
import { ModelRegistry, type ModelMapping } from "../router/ModelRegistry.js";
import { ModelResolver } from "../router/ModelResolver.js";
import { RoutingProfileRegistry, type RoutingProfile } from "../router/RoutingProfileRegistry.js";

const mappings: ModelMapping[] = [
  {
    id: "model-a",
    publicModel: "model-a",
    providerInstanceId: "instance-a",
    providerType: "test",
    upstreamModel: "upstream-a",
    capabilities: ["chat"],
    enabled: true,
  },
  {
    id: "model-b",
    publicModel: "model-b",
    providerInstanceId: "instance-b",
    providerType: "test",
    upstreamModel: "upstream-b",
    capabilities: ["chat"],
    enabled: true,
  },
  {
    id: "model-c",
    publicModel: "model-c",
    providerInstanceId: "instance-c",
    providerType: "test",
    upstreamModel: "upstream-c",
    capabilities: ["chat"],
    enabled: true,
  },
];

const profile: RoutingProfile = {
  id: "test-profile",
  displayName: "Test",
  enabled: true,
  fallback: false,
  requiredCapabilities: ["chat"],
  candidates: ["model-a", "model-b", "model-c"],
};

describe("ModelResolver priority sort (Phase 20b)", () => {
  it("sorts candidates by descending priority when getInstancePriority is provided", () => {
    const resolver = new ModelResolver(
      new ModelRegistry(mappings),
      new RoutingProfileRegistry([profile]),
      undefined,
      (id) =>
        ({
          "instance-a": 5,
          "instance-b": 10,
          "instance-c": 1,
        }[id])
    );

    const route = resolver.resolve("test-profile", ["chat"]);
    expect(route.candidates.map((c) => c.providerInstanceId)).toEqual([
      "instance-b",
      "instance-a",
      "instance-c",
    ]);
  });

  it("preserves registration order when priorities are equal", () => {
    const resolver = new ModelResolver(
      new ModelRegistry(mappings),
      new RoutingProfileRegistry([profile]),
      undefined,
      () => 5 // all equal
    );

    const route = resolver.resolve("test-profile", ["chat"]);
    expect(route.candidates.map((c) => c.providerInstanceId)).toEqual([
      "instance-a",
      "instance-b",
      "instance-c",
    ]);
  });

  it("treats undefined priority as 0", () => {
    const resolver = new ModelResolver(
      new ModelRegistry(mappings),
      new RoutingProfileRegistry([profile]),
      undefined,
      (id) => (id === "instance-b" ? 5 : undefined) // only instance-b has priority
    );

    const route = resolver.resolve("test-profile", ["chat"]);
    expect(route.candidates[0].providerInstanceId).toBe("instance-b");
  });

  it("does not change registration order when no lookup is provided", () => {
    const resolver = new ModelResolver(
      new ModelRegistry(mappings),
      new RoutingProfileRegistry([profile])
    );

    const route = resolver.resolve("test-profile", ["chat"]);
    expect(route.candidates.map((c) => c.providerInstanceId)).toEqual([
      "instance-a",
      "instance-b",
      "instance-c",
    ]);
  });

  it("does not affect fixed_model routes (single candidate)", () => {
    const resolver = new ModelResolver(
      new ModelRegistry(mappings),
      new RoutingProfileRegistry([profile]),
      undefined,
      () => 999
    );

    const route = resolver.resolve("model-a", ["chat"]);
    expect(route.routeType).toBe("fixed_model");
    expect(route.candidates).toHaveLength(1);
    expect(route.candidates[0].providerInstanceId).toBe("instance-a");
  });
});
