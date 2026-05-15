import type { ProviderCapabilityFlag } from "../providers/base/ProviderCapabilities.js";
import { ProviderConfigError } from "../providers/base/ProviderErrors.js";

export type ModelMapping = {
  id: string;
  publicModel: string;
  providerInstanceId: string;
  providerType: string;
  upstreamModel: string;
  enabled: boolean;
  capabilities: ProviderCapabilityFlag[];
};

export class ModelRegistry {
  private readonly mappings = new Map<string, ModelMapping>();
  private readonly aliases = new Map<string, string>(); // alias → publicModel

  constructor(initialMappings: ModelMapping[] = []) {
    for (const mapping of initialMappings) {
      this.register(mapping);
    }
  }

  register(mapping: ModelMapping): void {
    if (this.mappings.has(mapping.publicModel)) {
      throw new ProviderConfigError(
        `Model mapping already registered for ${mapping.publicModel}`
      );
    }

    this.mappings.set(mapping.publicModel, structuredClone(mapping));
  }

  /** Add an alias that resolves to an existing publicModel */
  addAlias(alias: string, publicModel: string): void {
    this.aliases.set(alias, publicModel);
  }

  removeAlias(alias: string): void {
    this.aliases.delete(alias);
  }

  listAliases(): Array<{ alias: string; target: string }> {
    return Array.from(this.aliases.entries()).map(([alias, target]) => ({ alias, target }));
  }

  get(publicModel: string): ModelMapping | undefined {
    // Check direct mapping first, then aliases
    const mapping = this.mappings.get(publicModel) ?? this.mappings.get(this.aliases.get(publicModel) ?? "");
    return mapping ? structuredClone(mapping) : undefined;
  }

  listPublicModels(): ModelMapping[] {
    return Array.from(this.mappings.values())
      .filter((mapping) => mapping.enabled)
      .map((mapping) => structuredClone(mapping));
  }

  listModelMappings(): ModelMapping[] {
    return Array.from(this.mappings.values()).map((mapping) =>
      structuredClone(mapping)
    );
  }

  updateById(
    id: string,
    patch: Partial<Omit<ModelMapping, "id" | "publicModel">>
  ): ModelMapping {
    const current = Array.from(this.mappings.values()).find(
      (mapping) => mapping.id === id
    );

    if (!current) {
      throw new ProviderConfigError(`Model mapping ${id} not found`);
    }

    const updated: ModelMapping = {
      ...current,
      ...patch,
      id: current.id,
      publicModel: current.publicModel
    };

    this.mappings.set(current.publicModel, structuredClone(updated));
    return structuredClone(updated);
  }

  deleteById(id: string): ModelMapping {
    const current = Array.from(this.mappings.values()).find(
      (mapping) => mapping.id === id
    );

    if (!current) {
      throw new ProviderConfigError(`Model mapping ${id} not found`);
    }

    this.mappings.delete(current.publicModel);
    return structuredClone(current);
  }
}

export function createDefaultModelRegistry(): ModelRegistry {
  return new ModelRegistry([
    {
      id: "model_kiro_sonnet",
      publicModel: "kiro-sonnet",
      providerInstanceId: "provider_kiro_main",
      providerType: "kiro",
      upstreamModel: "claude-sonnet-4.5",
      enabled: true,
      capabilities: ["chat", "streaming"]
    },
    {
      id: "model_windsurf_sonnet",
      publicModel: "windsurf-sonnet",
      providerInstanceId: "provider_windsurf_main",
      providerType: "windsurf",
      upstreamModel: "claude-sonnet-4-6-thinking",
      enabled: true,
      capabilities: ["chat", "streaming"]
    }
  ]);
}
