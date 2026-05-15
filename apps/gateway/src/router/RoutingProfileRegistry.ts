import type { ProviderCapabilityFlag } from "../providers/base/ProviderCapabilities.js";
import { ProviderConfigError } from "../providers/base/ProviderErrors.js";

export type RoutingProfile = {
  id: string;
  displayName: string;
  candidates: string[];
  fallback: boolean;
  enabled: boolean;
  requiredCapabilities: ProviderCapabilityFlag[];
};

export class RoutingProfileRegistry {
  private readonly profiles = new Map<string, RoutingProfile>();

  constructor(initialProfiles: RoutingProfile[] = []) {
    for (const profile of initialProfiles) {
      this.register(profile);
    }
  }

  register(profile: RoutingProfile): void {
    if (this.profiles.has(profile.id)) {
      throw new ProviderConfigError(
        `Routing profile already registered for ${profile.id}`
      );
    }

    this.profiles.set(profile.id, structuredClone(profile));
  }

  get(profileId: string): RoutingProfile | undefined {
    const profile = this.profiles.get(profileId);
    return profile ? structuredClone(profile) : undefined;
  }

  listPublicProfiles(): RoutingProfile[] {
    return Array.from(this.profiles.values())
      .filter((profile) => profile.enabled)
      .map((profile) => structuredClone(profile));
  }

  listRoutingProfiles(): RoutingProfile[] {
    return Array.from(this.profiles.values()).map((profile) =>
      structuredClone(profile)
    );
  }

  update(
    id: string,
    patch: Partial<Omit<RoutingProfile, "id">>
  ): RoutingProfile {
    const current = this.profiles.get(id);

    if (!current) {
      throw new ProviderConfigError(`Routing profile ${id} not found`);
    }

    const updated: RoutingProfile = {
      ...current,
      ...patch,
      id: current.id
    };

    this.profiles.set(id, structuredClone(updated));
    return structuredClone(updated);
  }
}

export function createDefaultRoutingProfileRegistry(): RoutingProfileRegistry {
  return new RoutingProfileRegistry([
    {
      id: "auto",
      displayName: "Auto",
      candidates: ["kiro-sonnet", "windsurf-sonnet"],
      fallback: true,
      enabled: true,
      requiredCapabilities: ["chat"]
    },
    {
      id: "coding",
      displayName: "Coding",
      candidates: ["kiro-sonnet", "windsurf-sonnet"],
      fallback: true,
      enabled: true,
      requiredCapabilities: ["chat"]
    },
    {
      id: "fast",
      displayName: "Fast",
      candidates: ["windsurf-sonnet", "kiro-sonnet"],
      fallback: true,
      enabled: true,
      requiredCapabilities: ["chat"]
    },
    {
      id: "balanced",
      displayName: "Balanced",
      candidates: ["kiro-sonnet", "windsurf-sonnet"],
      fallback: true,
      enabled: true,
      requiredCapabilities: ["chat"]
    },
    {
      id: "strong",
      displayName: "Strong",
      candidates: ["kiro-sonnet", "windsurf-sonnet"],
      fallback: true,
      enabled: true,
      requiredCapabilities: ["chat"]
    }
  ]);
}
