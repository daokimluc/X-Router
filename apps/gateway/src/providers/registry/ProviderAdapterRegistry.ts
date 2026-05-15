import type { AIProviderAdapter } from "../base/AIProviderAdapter.js";
import { ProviderConfigError } from "../base/ProviderErrors.js";
import type { ProviderTypeDefinition } from "./ProviderTypeDefinition.js";

export class ProviderAdapterRegistry {
  private readonly entries = new Map<
    string,
    {
      definition: ProviderTypeDefinition;
      adapter: AIProviderAdapter;
    }
  >();

  register(definition: ProviderTypeDefinition, adapter: AIProviderAdapter): void {
    if (definition.type !== adapter.type) {
      throw new ProviderConfigError(
        `Provider definition type ${definition.type} does not match adapter type ${adapter.type}`
      );
    }

    if (this.entries.has(definition.type)) {
      throw new ProviderConfigError(
        `Provider adapter already registered for type ${definition.type}`
      );
    }

    this.entries.set(definition.type, {
      definition: structuredClone(definition),
      adapter
    });
  }

  getAdapter(providerType: string): AIProviderAdapter {
    const entry = this.entries.get(providerType);

    if (!entry) {
      throw new ProviderConfigError(
        `Provider adapter not registered for type ${providerType}`
      );
    }

    return entry.adapter;
  }

  listProviderTypes(): ProviderTypeDefinition[] {
    return Array.from(this.entries.values()).map((entry) =>
      structuredClone(entry.definition)
    );
  }
}

