import { mkdir, readFile, rename, copyFile, open } from "node:fs/promises";
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

/** Current persisted-state schema version. Bumped on breaking shape changes. */
export const CURRENT_SCHEMA_VERSION = 1;

/**
 * Concrete schemas for the critical slices. These carry account/key/secret
 * material — a malformed entry here must fail loudly (with a field path) rather
 * than load silently-wrong. Non-critical slices stay permissive (z.any()).
 */
const accountSchema = z
  .object({
    id: z.string().min(1),
    providerInstanceId: z.string().min(1),
    providerType: z.string().min(1),
    status: z.string().min(1)
  })
  .passthrough();

const secretSchema = z
  .object({
    id: z.string().min(1),
    accountId: z.string().min(1),
    credentialType: z.enum([
      "api_key",
      "bearer_token",
      "oauth",
      "refresh_token",
      "session_cookie",
      "custom_json"
    ]),
    encryptedPayload: z.string().min(1)
  })
  .passthrough();

const apiKeySchema = z
  .object({
    id: z.string().min(1),
    keyHash: z.string().min(1),
    enabled: z.boolean()
  })
  .passthrough();

const modelMappingSchema = z
  .object({
    publicModel: z.string().min(1)
  })
  .passthrough();

const persistedStateSchema = z.object({
  schemaVersion: z.number().int().nonnegative().optional(),
  providerInstances: z.array(z.any()).default([]),
  accounts: z.array(accountSchema).default([]),
  modelMappings: z.array(modelMappingSchema).default([]),
  routingProfiles: z.array(z.any()).default([]),
  apiKeys: z.array(apiKeySchema).default([]),
  secrets: z.array(secretSchema).default([]),
  config: z
    .object({
      current: z.record(z.unknown()).default({}),
      revisions: z.array(z.any()).default([])
    })
    .default({ current: {}, revisions: [] }),
  tokenSaver: z.any().optional(),
  teams: z.array(z.any()).optional(),
  // usage/requestLogs are NO LONGER written (usage is durable in SQLite
  // usage_log; request logs are in-memory only). Kept optional in the schema so
  // older files that still carry them load without error and are dropped.
  usage: z.array(z.any()).optional(),
  requestLogs: z.array(z.any()).optional(),
  proxyPools: z.array(z.any()).default([]),
  rateLimitCounters: z.array(z.any()).optional(),
  modelPricing: z.array(z.any()).optional(),
  spendLedger: z.any().optional(),
  /**
   * Open-core marketplace state slice. A free-form record keyed by contributor
   * name (e.g. "wallet"), populated by the marketplace layer via the seam. The
   * engine persists and restores it opaquely without importing marketplace types.
   */
  marketplace: z.record(z.unknown()).optional()
});

export type PersistedGatewayState = {
  /** Schema version marker. Absent on disk → treated as v0, migrated forward. */
  schemaVersion?: number;
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
  /**
   * @deprecated No longer written. usage is durable in SQLite (usage_log) and
   * request logs are in-memory only. Kept optional so older files still load and
   * can hydrate once on a forward migration before being dropped.
   */
  usage?: Array<Record<string, unknown>>;
  /** @deprecated No longer written (in-memory only). See `usage`. */
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
  /** Phase 32 — spending-caps ledger */
  spendLedger?: {
    entries: Record<string, {
      dayKey: string;
      monthKey: string;
      day: number;
      month: number;
      lastBlocked: string | null;
    }>;
  };
  /** Open-core marketplace state slice (opaque to the engine). */
  marketplace?: Record<string, unknown>;
};

/** Thrown when a critical slice fails structural validation on load. */
export class StateValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StateValidationError";
  }
}

/**
 * The persistence contract shared by the JSON {@link PersistenceService} and the
 * SQLite {@link ConfigStore}. app.ts holds one of these as `persistenceService`
 * and the state-owning services hydrate from `load()` + persist via
 * `saveDebounced()` — so swapping the substrate changes no call sites.
 */
export interface StateStore {
  load(): Promise<PersistedGatewayState | null>;
  save(state: PersistedGatewayState): Promise<void>;
  saveDebounced(state: PersistedGatewayState): void;
  flush(): Promise<void>;
  drain(): Promise<void>;
}

/** Parse + validate a raw JSON state document into the revived in-memory shape. */
export function parsePersistedState(json: unknown): PersistedGatewayState {
  const parsed = persistedStateSchema.parse(json);
  return reviveParsedState(parsed);
}

function reviveParsedState(parsed: z.infer<typeof persistedStateSchema>): PersistedGatewayState {
  const version = parsed.schemaVersion ?? 0;
  return {
    schemaVersion: version,
    providerInstances: parsed.providerInstances.map(reviveDates),
    accounts: (parsed.accounts as ProviderAccount[]).map(reviveDates).map(migrateAccountSellerId),
    modelMappings: parsed.modelMappings,
    routingProfiles: parsed.routingProfiles,
    apiKeys: (parsed.apiKeys as InternalApiKeyRecord[]).map(reviveDates),
    secrets: (parsed.secrets as ProviderAccountSecret[]).map(reviveDates),
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
    modelPricing: parsed.modelPricing?.map(reviveDates),
    spendLedger: parsed.spendLedger,
    marketplace: parsed.marketplace
  } as PersistedGatewayState;
}

export class PersistenceService implements StateStore {
  private readonly tmpPath: string;
  private readonly bakPath: string;

  // Single-flight + trailing-debounce save queue. All saves funnel through
  // saveDebounced(); concurrent/rapid callers coalesce, and writes never
  // overlap or land out of order (one in-flight write at a time, latest state
  // wins). save() remains for the rare path that needs an awaited write.
  private pendingState: PersistedGatewayState | null = null;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private writing: Promise<void> = Promise.resolve();
  private readonly debounceMs: number;

  constructor(private readonly filePath: string, options: { debounceMs?: number } = {}) {
    this.tmpPath = `${filePath}.tmp`;
    this.bakPath = `${filePath}.bak`;
    this.debounceMs = options.debounceMs ?? 250;
  }

  async load(): Promise<PersistedGatewayState | null> {
    const primary = await this.tryLoadFile(this.filePath);
    if (primary.ok) {
      return primary.state;
    }
    if (primary.missing) {
      // Primary absent — try the backup (a crash between bak-copy and rename
      // could leave only the bak), else treat as a fresh install.
      const backup = await this.tryLoadFile(this.bakPath);
      return backup.ok ? backup.state : null;
    }

    // Primary present but unparseable/invalid → fall back to the backup.
    const backup = await this.tryLoadFile(this.bakPath);
    if (backup.ok) {
      // eslint-disable-next-line no-console
      console.warn(
        `[persistence] primary state file unreadable (${primary.error}); loaded backup ${this.bakPath}`
      );
      return backup.state;
    }

    // Neither primary nor backup is usable. Re-throw the primary error so boot
    // fails loudly with the offending detail rather than silently losing state.
    throw primary.errorObject ?? new Error("failed to load state");
  }

  private async tryLoadFile(
    path: string
  ): Promise<
    | { ok: true; state: PersistedGatewayState }
    | { ok: false; missing: true }
    | { ok: false; missing: false; error: string; errorObject: unknown }
  > {
    let raw: string;
    try {
      raw = await readFile(path, "utf8");
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return { ok: false, missing: true };
      }
      return { ok: false, missing: false, error: String(error), errorObject: error };
    }

    try {
      const json = JSON.parse(raw) as unknown;
      const parsed = persistedStateSchema.parse(json);
      return { ok: true, state: this.reviveState(parsed) };
    } catch (error) {
      const detail =
        error instanceof z.ZodError
          ? `invalid state shape: ${error.issues
              .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
              .join("; ")}`
          : `unparseable JSON: ${String(error)}`;
      return {
        ok: false,
        missing: false,
        error: detail,
        errorObject: new StateValidationError(`${path} — ${detail}`)
      };
    }
  }

  private reviveState(parsed: z.infer<typeof persistedStateSchema>): PersistedGatewayState {
    return reviveParsedState(parsed);
  }

  /**
   * Atomically persist state: write to `<file>.tmp` + fsync, copy the current
   * `<file>` to `<file>.bak`, then `rename` the tmp over `<file>` (atomic on the
   * same volume). An interrupted write leaves the previous `<file>` intact (the
   * rename never happened); a corrupt primary is recoverable from `.bak`.
   */
  async save(state: PersistedGatewayState): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });

    const serialized = `${JSON.stringify(
      { ...state, schemaVersion: CURRENT_SCHEMA_VERSION },
      null,
      2
    )}\n`;

    // Write + fsync the temp file so the bytes are durable before the rename.
    const handle = await open(this.tmpPath, "w");
    try {
      await handle.writeFile(serialized, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }

    // Snapshot the last-good primary to .bak before replacing it.
    try {
      await copyFile(this.filePath, this.bakPath);
    } catch (error) {
      // First-ever write has no primary yet — that's fine.
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
        throw error;
      }
    }

    await rename(this.tmpPath, this.filePath);
  }

  /**
   * Queue a coalesced, single-flight save. Multiple calls within the debounce
   * window collapse to one write of the LATEST state; writes are serialized so
   * they can neither overlap nor land out of order. Does not block the caller.
   */
  saveDebounced(state: PersistedGatewayState): void {
    this.pendingState = state;
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, this.debounceMs);
  }

  /** Run the queued save (if any), chained after any in-flight write. */
  async flush(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    const state = this.pendingState;
    if (!state) return this.writing;
    this.pendingState = null;
    this.writing = this.writing
      .catch(() => undefined)
      .then(() => this.save(state));
    return this.writing;
  }

  /** Flush any pending save and wait for all writes to settle (shutdown). */
  async drain(): Promise<void> {
    await this.flush();
    // Surface a failed final write rather than silently dropping it — the
    // operator should know the last state mutation may not have persisted.
    await this.writing.catch((err) => {
      // eslint-disable-next-line no-console
      console.error(`[persistence] final save on drain failed: ${String(err)}`);
    });
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

/**
 * seller-supply (#4) — an account with no sellerId (legacy `owner` only, or
 * neither) is migrated to the reserved "house" seller so single-tenant
 * deployments become "all house supply" with unchanged behavior.
 */
function migrateAccountSellerId(account: ProviderAccount): ProviderAccount {
  if (!account.sellerId) {
    account.sellerId = "house";
  }
  return account;
}

