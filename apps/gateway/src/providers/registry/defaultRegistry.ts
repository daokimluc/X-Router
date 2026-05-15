import { MockProviderAdapter } from "../adapters/mock/MockProviderAdapter.js";
import { mockProviderDefinition } from "../adapters/mock/mockProviderDefinition.js";
import { KiroProviderAdapter } from "../adapters/kiro/KiroProviderAdapter.js";
import { kiroProviderDefinition } from "../adapters/kiro/kiroProviderDefinition.js";
import { WindsurfProviderAdapter } from "../adapters/windsurf/WindsurfProviderAdapter.js";
import { windsurfProviderDefinition } from "../adapters/windsurf/windsurfProviderDefinition.js";
import { ProviderAdapterRegistry } from "./ProviderAdapterRegistry.js";

export function createDefaultProviderRegistry(): ProviderAdapterRegistry {
  const registry = new ProviderAdapterRegistry();
  registry.register(mockProviderDefinition, new MockProviderAdapter());
  registry.register(kiroProviderDefinition, new KiroProviderAdapter());
  registry.register(windsurfProviderDefinition, new WindsurfProviderAdapter());
  return registry;
}
