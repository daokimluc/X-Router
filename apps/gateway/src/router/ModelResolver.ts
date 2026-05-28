import type { ProviderCapabilityFlag } from "../providers/base/ProviderCapabilities.js";
import {
  ProviderConfigError,
  UnsupportedCapabilityError
} from "../providers/base/ProviderErrors.js";
import type { ModelMapping } from "./ModelRegistry.js";
import { ModelRegistry } from "./ModelRegistry.js";
import { RoutingProfileRegistry } from "./RoutingProfileRegistry.js";
import { CapabilityMatcher } from "./CapabilityMatcher.js";
import { expandVariants, formatUpstreamModel } from "./modelVariants.js";

export type ResolvedModelCandidate = {
  publicModel: string;
  providerInstanceId: string;
  providerType: string;
  upstreamModel: string;
  capabilities: ProviderCapabilityFlag[];
};

export type ReasoningEffort = "high" | "medium" | "low";

export type ResolvedModelRoute = {
  requestedModel: string;
  routeType: "fixed_model" | "routing_profile";
  fallback: boolean;
  candidates: ResolvedModelCandidate[];
  /** Reasoning effort extracted from model name suffix (e.g. "claude-3-5-sonnet-high") */
  reasoningEffort?: ReasoningEffort;
};

export class UnknownModelError extends Error {
  readonly statusCode = 404;
  readonly code = "model_not_found";

  constructor(model: string) {
    super(`Model ${model} was not found`);
    this.name = "UnknownModelError";
  }
}

export class ModelResolver {
  constructor(
    private readonly modelRegistry: ModelRegistry,
    private readonly routingProfileRegistry: RoutingProfileRegistry,
    private readonly capabilityMatcher = new CapabilityMatcher(),
    /** Optional priority lookup. Returns undefined for unknown instances; treated as 0. */
    private readonly getInstancePriority?: (providerInstanceId: string) => number | undefined,
    /** Optional group lookup (Phase 20c). Returns undefined → instance has no group. */
    private readonly getInstanceGroup?: (providerInstanceId: string) => string | undefined,
    /** Phase 30 — Optional per-channel modelMapping lookup. Returns alias→upstream map or undefined. */
    private readonly getInstanceModelMapping?: (
      providerInstanceId: string
    ) => Record<string, string> | undefined
  ) {}

  /**
   * Phase 31 — try exact match first, then expanded variants (dash↔dot, date
   * suffix strip, AWS Bedrock prefix, Vertex `@`).
   */
  private lookupMappings(name: string): ModelMapping[] {
    const exact = this.modelRegistry.getAll(name);
    if (exact.length > 0) return exact;
    for (const variant of expandVariants(name)) {
      if (variant === name) continue;
      const match = this.modelRegistry.getAll(variant);
      if (match.length > 0) return match;
    }
    return [];
  }

  resolve(
    requestedModel: string,
    requiredCapabilities: ProviderCapabilityFlag[] = ["chat"],
    context: { keyGroupName?: string; crossGroupRetry?: boolean } = {}
  ): ResolvedModelRoute {
    // Extract reasoning effort suffix: model-high, model-medium, model-low
    const { baseModel, reasoningEffort } = extractReasoningEffort(requestedModel);

    // Phase 31 — multi-channel routing: collect ALL mappings serving this name.
    const fixedMappings = this.lookupMappings(baseModel);

    if (fixedMappings.length > 0) {
      const allCandidates = fixedMappings.map((m) =>
        this.toCandidate(this.assertCapabilities(m, requiredCapabilities))
      );
      // Fixed model routes bypass group filtering (user explicitly requested this model)
      const sorted = this.applyPrioritySort(allCandidates);
      return {
        requestedModel: baseModel,
        routeType: "fixed_model",
        fallback: sorted.length > 1,
        candidates: sorted,
        reasoningEffort
      };
    }

    const profile = this.routingProfileRegistry.get(baseModel);

    if (!profile || !profile.enabled) {
      throw new UnknownModelError(baseModel);
    }

    const required = mergeCapabilities(profile.requiredCapabilities, requiredCapabilities);
    // Phase 31 — each profile candidate may resolve to multiple mappings (one per channel).
    const allCandidates: ResolvedModelCandidate[] = [];
    for (const candidateModel of profile.candidates) {
      const mappings = this.lookupMappings(candidateModel);
      if (mappings.length === 0) {
        throw new ProviderConfigError(
          `Routing profile ${profile.id} references unknown model ${candidateModel}`
        );
      }
      for (const m of mappings) {
        if (!m.enabled) continue;
        allCandidates.push(this.toCandidate(this.assertCapabilities(m, required)));
      }
    }

    const filtered = this.applyGroupFilter(allCandidates, context);
    const sorted = this.applyPrioritySort(filtered);

    return {
      requestedModel: baseModel,
      routeType: "routing_profile",
      fallback: profile.fallback,
      candidates: sorted,
      reasoningEffort
    };
  }

  /** Phase 20c — filter candidates by key's groupName, optional cross-group fallback. */
  private applyGroupFilter(
    allCandidates: ResolvedModelCandidate[],
    context: { keyGroupName?: string; crossGroupRetry?: boolean }
  ): ResolvedModelCandidate[] {
    if (!context.keyGroupName || !this.getInstanceGroup) return allCandidates;
    const lookup = this.getInstanceGroup;
    const inGroup = allCandidates.filter(
      (c) => lookup(c.providerInstanceId) === context.keyGroupName
    );
    if (inGroup.length > 0) return inGroup;
    if (context.crossGroupRetry) return allCandidates;
    return [];
  }

  /** Phase 20b — sort candidates by descending priority. Stable on ties. */
  private applyPrioritySort(
    candidates: ResolvedModelCandidate[]
  ): ResolvedModelCandidate[] {
    if (!this.getInstancePriority) return candidates;
    const lookup = this.getInstancePriority;
    const withPriority = candidates.map((c, i) => ({
      c,
      i,
      p: lookup(c.providerInstanceId) ?? 0
    }));
    withPriority.sort((a, b) => b.p - a.p || a.i - b.i);
    return withPriority.map((entry) => entry.c);
  }

  private assertCapabilities(
    mapping: ModelMapping,
    requiredCapabilities: ProviderCapabilityFlag[]
  ): ModelMapping {
    const match = this.capabilityMatcher.match(
      mapping.capabilities,
      requiredCapabilities
    );

    if (!match.ok) {
      throw new UnsupportedCapabilityError(
        `Model ${mapping.publicModel} does not support required capabilities: ${match.missing.join(", ")}`
      );
    }

    return mapping;
  }

  private toCandidate(mapping: ModelMapping): ResolvedModelCandidate {
    // Phase 30 — explicit per-channel modelMapping wins.
    const channelMapping = this.getInstanceModelMapping?.(mapping.providerInstanceId);
    const explicitOverride = channelMapping?.[mapping.publicModel];
    let upstreamModel: string;
    if (explicitOverride !== undefined) {
      upstreamModel = explicitOverride;
    } else {
      // Phase 31 — auto-format the canonical name for this provider's expected shape.
      upstreamModel = formatUpstreamModel(mapping.upstreamModel, mapping.providerType);
    }
    return {
      publicModel: mapping.publicModel,
      providerInstanceId: mapping.providerInstanceId,
      providerType: mapping.providerType,
      upstreamModel,
      capabilities: [...mapping.capabilities]
    };
  }
}

function mergeCapabilities(
  first: ProviderCapabilityFlag[],
  second: ProviderCapabilityFlag[]
): ProviderCapabilityFlag[] {
  return Array.from(new Set([...first, ...second]));
}

const REASONING_SUFFIXES: Record<string, ReasoningEffort> = {
  "-high": "high",
  "-medium": "medium",
  "-low": "low",
};

function extractReasoningEffort(model: string): {
  baseModel: string;
  reasoningEffort?: ReasoningEffort;
} {
  for (const [suffix, effort] of Object.entries(REASONING_SUFFIXES)) {
    if (model.endsWith(suffix)) {
      return {
        baseModel: model.slice(0, -suffix.length),
        reasoningEffort: effort,
      };
    }
  }
  return { baseModel: model };
}

