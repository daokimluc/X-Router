import { describe, expect, it } from "vitest";
import { UnsupportedCapabilityError } from "../providers/base/ProviderErrors.js";
import { CapabilityMatcher } from "../router/CapabilityMatcher.js";
import {
  createDefaultModelRegistry,
  ModelRegistry
} from "../router/ModelRegistry.js";
import { ModelResolver, UnknownModelError } from "../router/ModelResolver.js";
import {
  createDefaultRoutingProfileRegistry,
  RoutingProfileRegistry
} from "../router/RoutingProfileRegistry.js";

describe("CapabilityMatcher", () => {
  it("detects missing capabilities", () => {
    const matcher = new CapabilityMatcher();

    expect(matcher.match(["chat"], ["chat", "tool_calling"])).toEqual({
      ok: false,
      missing: ["tool_calling"]
    });
  });
});

describe("ModelResolver", () => {
  it("resolves fixed public models", () => {
    const resolver = new ModelResolver(
      createDefaultModelRegistry(),
      createDefaultRoutingProfileRegistry()
    );

    expect(resolver.resolve("kiro-sonnet")).toEqual({
      requestedModel: "kiro-sonnet",
      routeType: "fixed_model",
      fallback: false,
      candidates: [
        {
          publicModel: "kiro-sonnet",
          providerInstanceId: "provider_kiro_main",
          providerType: "kiro",
          upstreamModel: "claude-sonnet-4.5",
          capabilities: ["chat", "streaming"]
        }
      ]
    });
  });

  it("resolves routing profiles to ordered candidates", () => {
    const resolver = new ModelResolver(
      createDefaultModelRegistry(),
      createDefaultRoutingProfileRegistry()
    );

    expect(resolver.resolve("coding")).toMatchObject({
      requestedModel: "coding",
      routeType: "routing_profile",
      fallback: true,
      candidates: [
        {
          publicModel: "kiro-sonnet",
          providerType: "kiro"
        },
        {
          publicModel: "windsurf-sonnet",
          providerType: "windsurf"
        }
      ]
    });
  });

  it("returns 404-style errors for unknown models", () => {
    const resolver = new ModelResolver(
      createDefaultModelRegistry(),
      createDefaultRoutingProfileRegistry()
    );

    expect(() => resolver.resolve("missing-model")).toThrow(UnknownModelError);
  });

  it("rejects unsupported required capabilities", () => {
    const resolver = new ModelResolver(
      createDefaultModelRegistry(),
      createDefaultRoutingProfileRegistry()
    );

    expect(() => resolver.resolve("kiro-sonnet", ["tool_calling"])).toThrow(
      UnsupportedCapabilityError
    );
  });

  it("rejects routing profiles that reference unknown models", () => {
    const modelRegistry = new ModelRegistry([]);
    const routingProfileRegistry = new RoutingProfileRegistry([
      {
        id: "broken",
        displayName: "Broken",
        candidates: ["missing"],
        fallback: true,
        enabled: true,
        requiredCapabilities: ["chat"]
      }
    ]);
    const resolver = new ModelResolver(modelRegistry, routingProfileRegistry);

    expect(() => resolver.resolve("broken")).toThrow(
      "Routing profile broken references unknown model missing"
    );
  });
});
