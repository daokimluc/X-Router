import type { ProviderCapabilityFlag } from "../providers/base/ProviderCapabilities.js";

export type CapabilityMatchResult = {
  ok: boolean;
  missing: ProviderCapabilityFlag[];
};

export class CapabilityMatcher {
  match(
    available: ProviderCapabilityFlag[],
    required: ProviderCapabilityFlag[]
  ): CapabilityMatchResult {
    const availableSet = new Set(available);
    const missing = required.filter((capability) => !availableSet.has(capability));

    return {
      ok: missing.length === 0,
      missing
    };
  }
}

