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
  private readonly patternMappings: Array<{ pattern: RegExp; mapping: ModelMapping }> = [];

  constructor(initialMappings: ModelMapping[] = []) {
    for (const mapping of initialMappings) {
      this.register(mapping);
    }
  }

  register(mapping: ModelMapping): void {
    if (mapping.publicModel.includes("*")) {
      const regex = new RegExp(
        "^" + mapping.publicModel.replace(/\*/g, ".*") + "$"
      );
      this.patternMappings.push({ pattern: regex, mapping: structuredClone(mapping) });
      return;
    }

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
    // 1. Exact match
    const exact = this.mappings.get(publicModel);
    if (exact) return structuredClone(exact);

    // 2. Alias resolution
    const aliasTarget = this.aliases.get(publicModel);
    if (aliasTarget) {
      const aliased = this.mappings.get(aliasTarget);
      if (aliased) return structuredClone(aliased);
    }

    // 3. Pattern (wildcard) match — first match wins
    for (const { pattern, mapping } of this.patternMappings) {
      if (pattern.test(publicModel)) {
        return {
          ...structuredClone(mapping),
          publicModel
        };
      }
    }

    return undefined;
  }

  listPublicModels(): ModelMapping[] {
    return Array.from(this.mappings.values())
      .filter((mapping) => mapping.enabled)
      .map((mapping) => structuredClone(mapping));
  }

  listModelMappings(): ModelMapping[] {
    const exact = Array.from(this.mappings.values()).map((mapping) =>
      structuredClone(mapping)
    );
    const patterns = this.patternMappings.map(({ mapping }) =>
      structuredClone(mapping)
    );
    return [...exact, ...patterns];
  }

  updateById(
    id: string,
    patch: Partial<Omit<ModelMapping, "id" | "publicModel">>
  ): ModelMapping {
    const current = Array.from(this.mappings.values()).find(
      (mapping) => mapping.id === id
    );

    if (current) {
      const updated: ModelMapping = {
        ...current,
        ...patch,
        id: current.id,
        publicModel: current.publicModel
      };
      this.mappings.set(current.publicModel, structuredClone(updated));
      return structuredClone(updated);
    }

    const patternEntry = this.patternMappings.find(
      ({ mapping }) => mapping.id === id
    );
    if (patternEntry) {
      const updated: ModelMapping = {
        ...patternEntry.mapping,
        ...patch,
        id: patternEntry.mapping.id,
        publicModel: patternEntry.mapping.publicModel
      };
      patternEntry.mapping = structuredClone(updated);
      return structuredClone(updated);
    }

    throw new ProviderConfigError(`Model mapping ${id} not found`);
  }

  deleteById(id: string): ModelMapping {
    const current = Array.from(this.mappings.values()).find(
      (mapping) => mapping.id === id
    );

    if (current) {
      this.mappings.delete(current.publicModel);
      return structuredClone(current);
    }

    const patternIdx = this.patternMappings.findIndex(
      ({ mapping }) => mapping.id === id
    );
    if (patternIdx >= 0) {
      const removed = this.patternMappings.splice(patternIdx, 1)[0];
      return structuredClone(removed.mapping);
    }

    throw new ProviderConfigError(`Model mapping ${id} not found`);
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
