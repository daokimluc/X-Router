import { describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { MockProviderAdapter } from "../providers/adapters/mock/MockProviderAdapter.js";
import { mockProviderDefinition } from "../providers/adapters/mock/mockProviderDefinition.js";
import { ProviderConfigError } from "../providers/base/ProviderErrors.js";
import { ProviderAdapterRegistry } from "../providers/registry/ProviderAdapterRegistry.js";
import { createDefaultProviderRegistry } from "../providers/registry/defaultRegistry.js";
import { testConfig } from "./helpers.js";

describe("ProviderAdapterRegistry", () => {
  it("registers and lists provider types", () => {
    const registry = new ProviderAdapterRegistry();
    const adapter = new MockProviderAdapter();

    registry.register(mockProviderDefinition, adapter);

    expect(registry.getAdapter("mock")).toBe(adapter);
    expect(registry.listProviderTypes()).toEqual([mockProviderDefinition]);
  });

  it("rejects duplicate provider registrations", () => {
    const registry = new ProviderAdapterRegistry();

    registry.register(mockProviderDefinition, new MockProviderAdapter());

    expect(() =>
      registry.register(mockProviderDefinition, new MockProviderAdapter())
    ).toThrow(ProviderConfigError);
  });

  it("rejects mismatched definition and adapter types", () => {
    const registry = new ProviderAdapterRegistry();

    expect(() =>
      registry.register(
        {
          ...mockProviderDefinition,
          type: "other"
        },
        new MockProviderAdapter()
      )
    ).toThrow(ProviderConfigError);
  });

  it("throws for unknown provider adapters", () => {
    const registry = new ProviderAdapterRegistry();

    expect(() => registry.getAdapter("missing")).toThrow(ProviderConfigError);
  });
});

describe("default provider registry", () => {
  it("includes the mock provider adapter", () => {
    const registry = createDefaultProviderRegistry();

    expect(registry.getAdapter("mock")).toBeInstanceOf(MockProviderAdapter);
    expect(registry.getAdapter("kiro").type).toBe("kiro");
    expect(registry.getAdapter("windsurf").type).toBe("windsurf");
    expect(registry.listProviderTypes()).toHaveLength(3);
  });

  it("is attached to the Fastify app for later phases", async () => {
    const app = await buildApp(testConfig());

    expect(app.providerRegistry.getAdapter("mock")).toBeInstanceOf(
      MockProviderAdapter
    );

    await app.close();
  });
});
