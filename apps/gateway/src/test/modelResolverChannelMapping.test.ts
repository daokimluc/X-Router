import { describe, expect, it } from "vitest";
import { ModelRegistry, type ModelMapping } from "../router/ModelRegistry.js";
import { ModelResolver } from "../router/ModelResolver.js";
import { RoutingProfileRegistry, type RoutingProfile } from "../router/RoutingProfileRegistry.js";

const mappings: ModelMapping[] = [
  // gpt-4o served by 2 instances with different upstream model names
  { id: "azure-gpt4o", publicModel: "gpt-4o", providerInstanceId: "azure-1", providerType: "azure_openai", upstreamModel: "gpt-4o", capabilities: ["chat"], enabled: true },
  { id: "openai-gpt4o", publicModel: "gpt-4o-2", providerInstanceId: "openai-1", providerType: "openai", upstreamModel: "gpt-4o", capabilities: ["chat"], enabled: true },
];

const profile: RoutingProfile = {
  id: "gpt-4o",
  displayName: "GPT-4o",
  enabled: true,
  fallback: true,
  requiredCapabilities: ["chat"],
  candidates: ["gpt-4o", "gpt-4o-2"],
};

describe("ModelResolver per-channel modelMapping (Phase 30)", () => {
  it("uses global ModelMapping.upstreamModel when no per-channel mapping is set", () => {
    const resolver = new ModelResolver(
      new ModelRegistry(mappings),
      new RoutingProfileRegistry([profile]),
      undefined,
      undefined,
      undefined,
      () => undefined // no per-channel mapping
    );
    const route = resolver.resolve("gpt-4o");
    expect(route.candidates[0].upstreamModel).toBe("gpt-4o");
  });

  it("overrides upstreamModel with per-channel modelMapping when present", () => {
    const resolver = new ModelResolver(
      new ModelRegistry(mappings),
      new RoutingProfileRegistry([profile]),
      undefined,
      undefined,
      undefined,
      (id) => {
        if (id === "azure-1") {
          return { "gpt-4o": "my-azure-deployment-2024-11-20" };
        }
        return undefined;
      }
    );
    const route = resolver.resolve("gpt-4o");
    // azure-1 candidate should use the mapped value
    const azureCand = route.candidates.find((c) => c.providerInstanceId === "azure-1");
    expect(azureCand?.upstreamModel).toBe("my-azure-deployment-2024-11-20");
  });

  it("falls through to global mapping when channel mapping has no entry for this model", () => {
    const resolver = new ModelResolver(
      new ModelRegistry(mappings),
      new RoutingProfileRegistry([profile]),
      undefined,
      undefined,
      undefined,
      () => ({ "different-model": "different-upstream" })
    );
    const route = resolver.resolve("gpt-4o");
    expect(route.candidates[0].upstreamModel).toBe("gpt-4o");
  });

  it("works for fixed_model route (single candidate)", () => {
    const resolver = new ModelResolver(
      new ModelRegistry([
        { id: "x", publicModel: "x", providerInstanceId: "inst-x", providerType: "openai", upstreamModel: "x-default", capabilities: ["chat"], enabled: true },
      ]),
      new RoutingProfileRegistry([]),
      undefined,
      undefined,
      undefined,
      (id) => (id === "inst-x" ? { "x": "x-channel-override" } : undefined)
    );
    const route = resolver.resolve("x");
    expect(route.routeType).toBe("fixed_model");
    expect(route.candidates[0].upstreamModel).toBe("x-channel-override");
  });
});
