import type { ProviderCapabilityFlag } from "../providers/base/ProviderCapabilities.js";
import {
  ProviderConfigError,
  UnsupportedCapabilityError
} from "../providers/base/ProviderErrors.js";
import type { ModelMapping } from "./ModelRegistry.js";
import { ModelRegistry } from "./ModelRegistry.js";
import { RoutingProfileRegistry } from "./RoutingProfileRegistry.js";
import { CapabilityMatcher } from "./CapabilityMatcher.js";

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
    private readonly getInstanceGroup?: (providerInstanceId: string) => string | undefined
  ) {}

  resolve(
    requestedModel: string,
    requiredCapabilities: ProviderCapabilityFlag[] = ["chat"],
    context: { keyGroupName?: string; crossGroupRetry?: boolean } = {}
  ): ResolvedModelRoute {
    // Extract reasoning effort suffix: model-high, model-medium, model-low
    const { baseModel, reasoningEffort } = extractReasoningEffort(requestedModel);

    const fixedModel = this.modelRegistry.get(baseModel);

    if (fixedModel) {
      return {
        requestedModel: baseModel,
        routeType: "fixed_model",
        fallback: false,
        candidates: [this.toCandidate(this.assertCapabilities(fixedModel, requiredCapabilities))],
        reasoningEffort
      };
    }

    const profile = this.routingProfileRegistry.get(baseModel);

    if (!profile || !profile.enabled) {
      throw new UnknownModelError(baseModel);
    }

    const required = mergeCapabilities(profile.requiredCapabilities, requiredCapabilities);
    const allCandidates = profile.candidates.map((candidateModel) => {
      const mapping = this.modelRegistry.get(candidateModel);

      if (!mapping || !mapping.enabled) {
        throw new ProviderConfigError(
          `Routing profile ${profile.id} references unknown model ${candidateModel}`
        );
      }

      return this.toCandidate(this.assertCapabilities(mapping, required));
    });

    // Phase 20c — filter by group when key has groupName.
    let candidates = allCandidates;
    if (context.keyGroupName && this.getInstanceGroup) {
      const lookup = this.getInstanceGroup;
      const inGroup = allCandidates.filter(
        (c) => lookup(c.providerInstanceId) === context.keyGroupName
      );
      if (inGroup.length > 0) {
        candidates = inGroup;
      } else if (context.crossGroupRetry) {
        // No in-group match: fall back to all candidates
        candidates = allCandidates;
      } else {
        // No in-group match and no cross-group fallback allowed
        candidates = [];
      }
    }

    // Sort candidates by descending priority (Phase 20b). Stable: equal
    // priorities preserve registration order from the routing profile.
    if (this.getInstancePriority) {
      const lookup = this.getInstancePriority;
      const withPriority = candidates.map((c, i) => ({
        c,
        i,
        p: lookup(c.providerInstanceId) ?? 0,
      }));
      withPriority.sort((a, b) => (b.p - a.p) || (a.i - b.i));
      candidates = withPriority.map((entry) => entry.c);
    }

    return {
      requestedModel: baseModel,
      routeType: "routing_profile",
      fallback: profile.fallback,
      candidates,
      reasoningEffort
    };
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
    return {
      publicModel: mapping.publicModel,
      providerInstanceId: mapping.providerInstanceId,
      providerType: mapping.providerType,
      upstreamModel: mapping.upstreamModel,
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

