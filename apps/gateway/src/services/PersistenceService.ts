import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import type { ProviderAccount, ProviderAccountSecret } from "../providers/base/ProviderAccount.js";
import type { ProviderInstance } from "../providers/base/ProviderInstance.js";
import type { ProxyPool } from "../proxy/types.js";
import type { ModelMapping } from "../router/ModelRegistry.js";
import type { RoutingProfile } from "../router/RoutingProfileRegistry.js";
import type { ConfigRevision } from "./ConfigRevisionService.js";
import type { InternalApiKeyRecord } from "./ApiKeyService.js";
import type { ModelPricing } from "./ModelPricingService.js";

const dateish = z.union([z.string(), z.date()]);

const persistedStateSchema = z.object({
  providerInstances: z.array(z.any()).default([]),
  accounts: z.array(z.any()).default([]),
  modelMappings: z.array(z.any()).default([]),
  routingProfiles: z.array(z.any()).default([]),
  apiKeys: z.array(z.any()).default([]),
  secrets: z.array(z.any()).default([]),
  config: z
    .object({
      current: z.record(z.unknown()).default({}),
      revisions: z.array(z.any()).default([])
    })
    .default({ current: {}, revisions: [] }),
  tokenSaver: z.any().optional(),
  teams: z.array(z.any()).optional(),
  usage: z.array(z.any()).optional(),
  requestLogs: z.array(z.any()).optional(),
  proxyPools: z.array(z.any()).default([]),
  rateLimitCounters: z.array(z.any()).optional(),
  modelPricing: z.array(z.any()).optional()
});

export type PersistedGatewayState = {
  providerInstances: ProviderInstance[];
  accounts: ProviderAccount[];
  modelMappings: ModelMapping[];
  routingProfiles: RoutingProfile[];
  apiKeys: InternalApiKeyRecord[];
  secrets: ProviderAccountSecret[];
  config: {
    current: Record<string, unknown>;
    revisions: ConfigRevision[];
  };
  tokenSaver?: {
    compressToolOutput?: boolean;
    compressLlmOutput?: boolean;
    llmCompressionMode?: "lite" | "full" | "ultra";
  };
  teams?: Array<{
    id: string;
    name: string;
    enabled: boolean;
    description?: string;
    allowedModels?: string[];
    allowedProviders?: string[];
    rpmLimit?: number;
    dailyLimit?: number;
    monthlyLimit?: number;
    createdAt: Date;
    updatedAt: Date;
  }>;
  usage?: Array<Record<string, unknown>>;
  requestLogs?: Array<Record<string, unknown>>;
  proxyPools?: ProxyPool[];
  rateLimitCounters?: Array<{
    apiKeyHash: string;
    minuteWindowStart: number;
    minuteRequests: number;
    dailyWindowStart: string;
    dailyRequests: number;
    dailyTokens: number;
  }>;
  modelPricing?: ModelPricing[];
};

export class PersistenceService {
  constructor(private readonly filePath: string) {}

  async load(): Promise<PersistedGatewayState | null> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = persistedStateSchema.parse(JSON.parse(raw));

      return {
        providerInstances: parsed.providerInstances.map(reviveDates),
        accounts: parsed.accounts.map(reviveDates),
        modelMappings: parsed.modelMappings,
        routingProfiles: parsed.routingProfiles,
        apiKeys: parsed.apiKeys.map(reviveDates),
        secrets: parsed.secrets.map(reviveDates),
        config: {
          current: parsed.config.current,
          revisions: parsed.config.revisions.map(reviveDates)
        },
        tokenSaver: parsed.tokenSaver,
        teams: parsed.teams?.map(reviveDates),
        usage: parsed.usage,
        requestLogs: parsed.requestLogs,
        proxyPools: parsed.proxyPools.map(reviveDates),
        rateLimitCounters: parsed.rateLimitCounters,
        modelPricing: parsed.modelPricing?.map(reviveDates)
      } as PersistedGatewayState;
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return null;
      }

      throw error;
    }
  }

  async save(state: PersistedGatewayState): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  }
}

function reviveDates<T>(value: T): T {
  const clone = structuredClone(value) as Record<string, unknown>;

  for (const key of [
    "createdAt",
    "updatedAt",
    "expiresAt",
    "publishedAt",
    "lastUsedAt",
    "lastSuccessAt",
    "lastFailureAt",
    "cooldownUntil",
    "lastTestedAt"
  ]) {
    const current = clone[key];
    const parsed = dateish.safeParse(current);

    if (parsed.success && typeof parsed.data === "string") {
      clone[key] = new Date(parsed.data);
    }
  }

  if (clone.runtime && typeof clone.runtime === "object") {
    clone.runtime = reviveDates(clone.runtime);
  }

  return clone as T;
}
