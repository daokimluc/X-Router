import { describe, expect, it } from "vitest";
import {
  expandVariants,
  formatUpstreamModel,
  PROVIDER_FORMATS
} from "../router/modelVariants.js";
import { ModelRegistry } from "../router/ModelRegistry.js";
import { ModelResolver } from "../router/ModelResolver.js";
import { RoutingProfileRegistry } from "../router/RoutingProfileRegistry.js";

describe("expandVariants", () => {
  it("returns the original name as a variant", () => {
    expect(expandVariants("gpt-4o")).toContain("gpt-4o");
  });

  it("strips Anthropic date suffix", () => {
    const variants = expandVariants("claude-opus-4-7-20250101");
    expect(variants).toContain("claude-opus-4-7-20250101");
    expect(variants).toContain("claude-opus-4-7");
  });

  it("converts dash version to dot", () => {
    const variants = expandVariants("claude-opus-4-7");
    expect(variants).toContain("claude-opus-4.7");
  });

  it("converts dot version to dash", () => {
    const variants = expandVariants("claude-opus-4.7");
    expect(variants).toContain("claude-opus-4-7");
  });

  it("strips AWS Bedrock prefix and version suffix", () => {
    const variants = expandVariants(
      "anthropic.claude-opus-4-7-20250101-v1:0"
    );
    expect(variants).toContain("claude-opus-4-7-20250101");
    expect(variants).toContain("claude-opus-4-7");
  });

  it("converts Vertex @ separator to dash", () => {
    const variants = expandVariants("claude-opus-4@7");
    expect(variants).toContain("claude-opus-4-7");
  });

  it("dedupes when no transformation applies", () => {
    const variants = expandVariants("gpt-4o");
    // No date, no dot/dash version pair → just original (and one regex no-op)
    expect(variants.length).toBeGreaterThanOrEqual(1);
    expect(variants[0]).toBe("gpt-4o");
  });
});

describe("formatUpstreamModel", () => {
  it("kiro converts dash version to dot", () => {
    expect(formatUpstreamModel("claude-opus-4-7", "kiro")).toBe(
      "claude-opus-4.7"
    );
  });

  it("aws_bedrock prefixes anthropic. and v1:0 suffix", () => {
    expect(formatUpstreamModel("claude-opus-4-7", "aws_bedrock")).toBe(
      "anthropic.claude-opus-4-7-v1:0"
    );
  });

  it("aws_bedrock leaves already-prefixed names alone", () => {
    expect(
      formatUpstreamModel("anthropic.claude-opus-4-7-v1:0", "aws_bedrock")
    ).toBe("anthropic.claude-opus-4-7-v1:0");
  });

  it("vertex_ai converts last dash to @", () => {
    expect(formatUpstreamModel("claude-opus-4-7", "vertex_ai")).toBe(
      "claude-opus-4-7"
        .replace(/-(\d+)$/, "@$1")
    );
  });

  it("openai passthrough", () => {
    expect(formatUpstreamModel("gpt-4o", "openai")).toBe("gpt-4o");
  });

  it("unknown provider passthrough", () => {
    expect(formatUpstreamModel("foo-bar", "unknown_provider")).toBe("foo-bar");
  });

  it("PROVIDER_FORMATS table covers expected types", () => {
    expect(PROVIDER_FORMATS).toHaveProperty("kiro");
    expect(PROVIDER_FORMATS).toHaveProperty("aws_bedrock");
    expect(PROVIDER_FORMATS).toHaveProperty("vertex_ai");
    expect(PROVIDER_FORMATS).toHaveProperty("anthropic");
    expect(PROVIDER_FORMATS).toHaveProperty("openai");
  });
});

describe("ModelResolver — multi-channel routing (Phase 31)", () => {
  function makeResolver(
    mappings: Array<Parameters<ModelRegistry["register"]>[0]>,
    instancePriorities: Record<string, number> = {}
  ) {
    const registry = new ModelRegistry(mappings);
    const profileRegistry = new RoutingProfileRegistry([]);
    return new ModelResolver(
      registry,
      profileRegistry,
      undefined,
      (id) => instancePriorities[id]
    );
  }

  it("returns multiple candidates when multiple channels serve the same publicModel", () => {
    const resolver = makeResolver([
      {
        id: "kiro_opus",
        publicModel: "claude-opus-4-7",
        providerInstanceId: "kiro_main",
        providerType: "kiro",
        upstreamModel: "claude-opus-4-7",
        enabled: true,
        capabilities: ["chat"]
      },
      {
        id: "anth_opus",
        publicModel: "claude-opus-4-7",
        providerInstanceId: "anthropic_main",
        providerType: "anthropic",
        upstreamModel: "claude-opus-4-7",
        enabled: true,
        capabilities: ["chat"]
      }
    ]);
    const route = resolver.resolve("claude-opus-4-7");
    expect(route.routeType).toBe("fixed_model");
    expect(route.candidates).toHaveLength(2);
    expect(route.fallback).toBe(true);
  });

  it("sorts multi-channel candidates by priority desc", () => {
    const resolver = makeResolver(
      [
        {
          id: "low_priority",
          publicModel: "x",
          providerInstanceId: "low",
          providerType: "openai",
          upstreamModel: "x",
          enabled: true,
          capabilities: ["chat"]
        },
        {
          id: "high_priority",
          publicModel: "x",
          providerInstanceId: "high",
          providerType: "openai",
          upstreamModel: "x",
          enabled: true,
          capabilities: ["chat"]
        }
      ],
      { low: 1, high: 100 }
    );
    const route = resolver.resolve("x");
    expect(route.candidates[0].providerInstanceId).toBe("high");
    expect(route.candidates[1].providerInstanceId).toBe("low");
  });

  it("auto-formats upstream for kiro provider", () => {
    const resolver = makeResolver([
      {
        id: "kiro_opus",
        publicModel: "claude-opus-4-7",
        providerInstanceId: "kiro_main",
        providerType: "kiro",
        upstreamModel: "claude-opus-4-7",
        enabled: true,
        capabilities: ["chat"]
      }
    ]);
    const route = resolver.resolve("claude-opus-4-7");
    expect(route.candidates[0].upstreamModel).toBe("claude-opus-4.7");
  });

  it("resolves variant request name to canonical mapping", () => {
    const resolver = makeResolver([
      {
        id: "anth_opus",
        publicModel: "claude-opus-4-7",
        providerInstanceId: "anthropic_main",
        providerType: "anthropic",
        upstreamModel: "claude-opus-4-7",
        enabled: true,
        capabilities: ["chat"]
      }
    ]);
    // Client sends dot variant — should still resolve.
    const route = resolver.resolve("claude-opus-4.7");
    expect(route.candidates).toHaveLength(1);
    expect(route.candidates[0].publicModel).toBe("claude-opus-4-7");
  });

  it("resolves variant request with date suffix to canonical mapping", () => {
    const resolver = makeResolver([
      {
        id: "anth_opus",
        publicModel: "claude-opus-4-7",
        providerInstanceId: "anthropic_main",
        providerType: "anthropic",
        upstreamModel: "claude-opus-4-7",
        enabled: true,
        capabilities: ["chat"]
      }
    ]);
    const route = resolver.resolve("claude-opus-4-7-20250101");
    expect(route.candidates).toHaveLength(1);
  });
});

describe("ModelRegistry — multi-channel storage (Phase 31)", () => {
  it("getAll returns all mappings for a publicModel", () => {
    const registry = new ModelRegistry([
      {
        id: "a",
        publicModel: "shared",
        providerInstanceId: "p1",
        providerType: "openai",
        upstreamModel: "shared",
        enabled: true,
        capabilities: ["chat"]
      },
      {
        id: "b",
        publicModel: "shared",
        providerInstanceId: "p2",
        providerType: "openai",
        upstreamModel: "shared",
        enabled: true,
        capabilities: ["chat"]
      }
    ]);
    const all = registry.getAll("shared");
    expect(all).toHaveLength(2);
    expect(all.map((m) => m.id).sort()).toEqual(["a", "b"]);
  });

  it("get returns the first mapping (backward compat)", () => {
    const registry = new ModelRegistry([
      {
        id: "first",
        publicModel: "x",
        providerInstanceId: "p1",
        providerType: "openai",
        upstreamModel: "x",
        enabled: true,
        capabilities: ["chat"]
      },
      {
        id: "second",
        publicModel: "x",
        providerInstanceId: "p2",
        providerType: "openai",
        upstreamModel: "x",
        enabled: true,
        capabilities: ["chat"]
      }
    ]);
    expect(registry.get("x")?.id).toBe("first");
  });

  it("throws on duplicate id", () => {
    const registry = new ModelRegistry([
      {
        id: "dupe",
        publicModel: "a",
        providerInstanceId: "p1",
        providerType: "openai",
        upstreamModel: "a",
        enabled: true,
        capabilities: ["chat"]
      }
    ]);
    expect(() =>
      registry.register({
        id: "dupe",
        publicModel: "a",
        providerInstanceId: "p2",
        providerType: "openai",
        upstreamModel: "a",
        enabled: true,
        capabilities: ["chat"]
      })
    ).toThrow();
  });

  it("deleteById removes a single channel mapping, leaves siblings", () => {
    const registry = new ModelRegistry([
      {
        id: "ch1",
        publicModel: "shared",
        providerInstanceId: "p1",
        providerType: "openai",
        upstreamModel: "shared",
        enabled: true,
        capabilities: ["chat"]
      },
      {
        id: "ch2",
        publicModel: "shared",
        providerInstanceId: "p2",
        providerType: "openai",
        upstreamModel: "shared",
        enabled: true,
        capabilities: ["chat"]
      }
    ]);
    registry.deleteById("ch1");
    const remaining = registry.getAll("shared");
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe("ch2");
  });
});
