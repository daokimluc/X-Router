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

/**
 * Phase 31 — multi-channel routing.
 *
 * A single `publicModel` may be served by multiple ModelMappings (one per
 * channel/provider). The registry stores them as an array per public name and
 * returns all matches; the resolver decides ordering (priority + group).
 */
export class ModelRegistry {
  /** publicModel → list of mappings (Phase 31: multiple channels can serve the same model). */
  private readonly mappings = new Map<string, ModelMapping[]>();
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

    const existing = this.mappings.get(mapping.publicModel) ?? [];
    // Prevent duplicate by id only (allow same publicModel from different channels)
    if (existing.some((m) => m.id === mapping.id)) {
      throw new ProviderConfigError(
        `Model mapping with id "${mapping.id}" already registered`
      );
    }
    existing.push(structuredClone(mapping));
    this.mappings.set(mapping.publicModel, existing);
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

  /**
   * Backward-compat: returns the FIRST mapping for a publicModel.
   * For multi-channel routing, use {@link getAll}.
   */
  get(publicModel: string): ModelMapping | undefined {
    const all = this.getAll(publicModel);
    return all[0];
  }

  /**
   * Phase 31 — return ALL mappings (across channels) that serve a given publicModel.
   * Resolves aliases and patterns. Returned array is empty if nothing matches.
   */
  getAll(publicModel: string): ModelMapping[] {
    // 1. Exact match — possibly multiple
    const exact = this.mappings.get(publicModel);
    if (exact && exact.length > 0) {
      return exact.map((m) => structuredClone(m));
    }

    // 2. Alias resolution
    const aliasTarget = this.aliases.get(publicModel);
    if (aliasTarget) {
      const aliased = this.mappings.get(aliasTarget);
      if (aliased && aliased.length > 0) {
        return aliased.map((m) => structuredClone(m));
      }
    }

    // 3. Pattern (wildcard) match — first matching pattern wins
    for (const { pattern, mapping } of this.patternMappings) {
      if (pattern.test(publicModel)) {
        return [{ ...structuredClone(mapping), publicModel }];
      }
    }

    return [];
  }

  listPublicModels(): ModelMapping[] {
    const out: ModelMapping[] = [];
    for (const list of this.mappings.values()) {
      for (const mapping of list) {
        if (mapping.enabled) out.push(structuredClone(mapping));
      }
    }
    return out;
  }

  listModelMappings(): ModelMapping[] {
    const exact: ModelMapping[] = [];
    for (const list of this.mappings.values()) {
      for (const mapping of list) exact.push(structuredClone(mapping));
    }
    const patterns = this.patternMappings.map(({ mapping }) =>
      structuredClone(mapping)
    );
    return [...exact, ...patterns];
  }

  updateById(
    id: string,
    patch: Partial<Omit<ModelMapping, "id" | "publicModel">>
  ): ModelMapping {
    for (const list of this.mappings.values()) {
      const idx = list.findIndex((m) => m.id === id);
      if (idx >= 0) {
        const current = list[idx];
        const updated: ModelMapping = {
          ...current,
          ...patch,
          id: current.id,
          publicModel: current.publicModel
        };
        list[idx] = structuredClone(updated);
        return structuredClone(updated);
      }
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
    for (const [publicModel, list] of this.mappings.entries()) {
      const idx = list.findIndex((m) => m.id === id);
      if (idx >= 0) {
        const removed = list.splice(idx, 1)[0];
        if (list.length === 0) this.mappings.delete(publicModel);
        return structuredClone(removed);
      }
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
