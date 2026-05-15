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

export type ResolvedModelRoute = {
  requestedModel: string;
  routeType: "fixed_model" | "routing_profile";
  fallback: boolean;
  candidates: ResolvedModelCandidate[];
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
    private readonly capabilityMatcher = new CapabilityMatcher()
  ) {}

  resolve(
    requestedModel: string,
    requiredCapabilities: ProviderCapabilityFlag[] = ["chat"]
  ): ResolvedModelRoute {
    const fixedModel = this.modelRegistry.get(requestedModel);

    if (fixedModel) {
      return {
        requestedModel,
        routeType: "fixed_model",
        fallback: false,
        candidates: [this.toCandidate(this.assertCapabilities(fixedModel, requiredCapabilities))]
      };
    }

    const profile = this.routingProfileRegistry.get(requestedModel);

    if (!profile || !profile.enabled) {
      throw new UnknownModelError(requestedModel);
    }

    const required = mergeCapabilities(profile.requiredCapabilities, requiredCapabilities);
    const candidates = profile.candidates.map((candidateModel) => {
      const mapping = this.modelRegistry.get(candidateModel);

      if (!mapping || !mapping.enabled) {
        throw new ProviderConfigError(
          `Routing profile ${profile.id} references unknown model ${candidateModel}`
        );
      }

      return this.toCandidate(this.assertCapabilities(mapping, required));
    });

    return {
      requestedModel,
      routeType: "routing_profile",
      fallback: profile.fallback,
      candidates
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

