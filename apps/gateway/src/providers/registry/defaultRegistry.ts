import { MockProviderAdapter } from "../adapters/mock/MockProviderAdapter.js";
import { mockProviderDefinition } from "../adapters/mock/mockProviderDefinition.js";
import { KiroProviderAdapter } from "../adapters/kiro/KiroProviderAdapter.js";
import { kiroProviderDefinition } from "../adapters/kiro/kiroProviderDefinition.js";
import { WindsurfProviderAdapter } from "../adapters/windsurf/WindsurfProviderAdapter.js";
import { windsurfProviderDefinition } from "../adapters/windsurf/windsurfProviderDefinition.js";
import { GenericOpenAIAdapter } from "../adapters/generic-openai/GenericOpenAIAdapter.js";
import { AnthropicMessagesAdapter } from "../adapters/anthropic/AnthropicMessagesAdapter.js";
import { AzureOpenAIAdapter } from "../adapters/azure-openai/AzureOpenAIAdapter.js";
import { VertexAIAdapter } from "../adapters/vertex-ai/VertexAIAdapter.js";
import { OAuthPKCEAdapter } from "../adapters/oauth-pkce/OAuthPKCEAdapter.js";
import { NoAuthAdapter } from "../adapters/no-auth/NoAuthAdapter.js";
import { providerCatalog } from "../catalog/index.js";
import { ProviderAdapterRegistry } from "./ProviderAdapterRegistry.js";
import type { AIProviderAdapter } from "../base/AIProviderAdapter.js";

/**
 * Set of provider types that are already registered via dedicated adapters.
 * These are skipped during catalog auto-registration to maintain backward compatibility.
 */
const LEGACY_PROVIDER_TYPES = new Set(["mock", "kiro", "windsurf"]);

/**
 * Map of adapterName (from ProviderTypeDefinition) to shared adapter instances.
 * Each generic adapter instance is reused across all provider definitions that reference it.
 */
function createAdapterMap(): Map<string, AIProviderAdapter> {
  return new Map<string, AIProviderAdapter>([
    ["GenericOpenAIAdapter", new GenericOpenAIAdapter()],
    ["AnthropicMessagesAdapter", new AnthropicMessagesAdapter()],
    ["AzureOpenAIAdapter", new AzureOpenAIAdapter()],
    ["VertexAIAdapter", new VertexAIAdapter()],
    ["OAuthPKCEAdapter", new OAuthPKCEAdapter()],
    ["NoAuthAdapter", new NoAuthAdapter()],
  ]);
}

export function createDefaultProviderRegistry(): ProviderAdapterRegistry {
  const registry = new ProviderAdapterRegistry();

  // Register legacy adapters (backward compatible — these remain unchanged)
  registry.register(mockProviderDefinition, new MockProviderAdapter());
  registry.register(kiroProviderDefinition, new KiroProviderAdapter());
  registry.register(windsurfProviderDefinition, new WindsurfProviderAdapter());

  // Auto-register all catalog definitions with their corresponding adapters
  const adapterMap = createAdapterMap();

  for (const definition of providerCatalog) {
    // Skip definitions whose type matches an already-registered legacy adapter
    if (LEGACY_PROVIDER_TYPES.has(definition.type)) {
      continue;
    }

    const adapter = adapterMap.get(definition.adapterName);
    if (!adapter) {
      // Skip definitions with unknown adapter names (defensive)
      continue;
    }

    registry.registerCatalogEntry(definition, adapter);
  }

  return registry;
}
