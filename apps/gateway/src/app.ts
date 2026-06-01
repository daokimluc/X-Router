import fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { AppConfig } from "./config.js";
import { registerErrorHandler } from "./middleware/errorHandler.js";
import { registerLogger } from "./middleware/logger.js";
import { registerRequestId } from "./middleware/requestId.js";
import { registerHealthzRoute } from "./routes/healthz.js";
import { registerAnthropicRoutes } from "./routes/anthropic.js";
import { registerAdminRoutes } from "./routes/admin/index.js";
import { registerModelsRoute } from "./routes/models.js";
import { registerMetricsRoute } from "./routes/metrics.js";
import { registerOAuthRoutes } from "./routes/oauth.js";
import { registerOpenAIRoutes } from "./routes/openai.js";
import { registerReadyzRoute } from "./routes/readyz.js";
import { registerProviderAccountRoutes } from "./routes/providerAccounts.js";
import { registerProviderAccountManagementRoutes } from "./routes/admin/providerAccounts.js";
import { registerProxyPoolRoutes } from "./routes/admin/proxyPools.js";
import { registerMediaProviderRoutes } from "./routes/admin/mediaProviders.js";
import { registerEmbeddingsRoutes } from "./routes/embeddings.js";
import { registerPublicRoutes } from "./routes/public.js";
import { registerImagesRoutes } from "./routes/images.js";
import { registerAudioRoutes } from "./routes/audio.js";
import { registerWebRoutes } from "./routes/web.js";
import { registerDashboardPlugin } from "./plugins/dashboard.js";
import { redactObject } from "./utils/redaction.js";
import { createDefaultProviderRegistry } from "./providers/registry/defaultRegistry.js";
import type { ProviderAdapterRegistry } from "./providers/registry/ProviderAdapterRegistry.js";
import {
  createDefaultModelRegistry,
  ModelRegistry
} from "./router/ModelRegistry.js";
import {
  createDefaultRoutingProfileRegistry,
  RoutingProfileRegistry
} from "./router/RoutingProfileRegistry.js";
import { ModelResolver } from "./router/ModelResolver.js";
import {
  createDefaultProviderRuntimeRegistry,
  ProviderRuntimeRegistry
} from "./provider-runtime/ProviderRuntimeRegistry.js";
import { AccountPool } from "./account-pool/AccountPool.js";
import { createAccountSelectionStrategy } from "./account-pool/strategyFactory.js";
import { SecretService } from "./services/SecretService.js";
import { LocalEncryptionService } from "./services/LocalEncryptionService.js";
import { CircuitBreaker } from "./services/CircuitBreaker.js";
import { ConcurrencyLimiter } from "./services/ConcurrencyLimiter.js";
import { AdminAuditService } from "./services/AdminAuditService.js";
import { MetricsService } from "./services/MetricsService.js";
import { ConfigRevisionService } from "./services/ConfigRevisionService.js";
import { ApiKeyService } from "./services/ApiKeyService.js";
import { AdminKeyService } from "./services/AdminKeyService.js";
import { RequestLogService } from "./services/RequestLogService.js";
import { UsageService } from "./services/UsageService.js";
import { UsageLogStore } from "./services/UsageLogStore.js";
import { ModelPricingService } from "./services/ModelPricingService.js";
import { TokenSaverService } from "./services/TokenSaverService.js";
import { RequestQueueService } from "./services/RequestQueueService.js";
import { TeamService } from "./services/TeamService.js";
import { AccountQuotaService } from "./services/AccountQuotaService.js";
import { AutoRefreshService } from "./services/AutoRefreshService.js";
import { RefreshLockService } from "./services/RefreshLockService.js";
import { createPersistedState } from "./services/createPersistedState.js";
import { CredentialWritebackService } from "./services/CredentialWritebackService.js";
import { LatencyTrackerService } from "./services/LatencyTrackerService.js";
import { SpendLedgerService } from "./services/SpendLedgerService.js";
import { ResponseCacheService } from "./services/ResponseCacheService.js";
import { RateLimitService } from "./services/RateLimitService.js";
import { WebhookService } from "./services/WebhookService.js";
import { MarketplaceSeam } from "./services/MarketplaceSeam.js";
import { Database } from "./services/Database.js";
import {
  PersistenceService,
  parsePersistedState,
  type PersistedGatewayState,
  type StateStore
} from "./services/PersistenceService.js";
import { ConfigStore } from "./services/ConfigStore.js";
import { AddAccountLockService } from "./services/AddAccountLockService.js";
import { IdempotencyStore } from "./services/IdempotencyStore.js";
import { OAuthSessionStore } from "./services/OAuthSessionStore.js";
import { ProxyPoolService } from "./proxy/ProxyPoolService.js";
import { MediaRouter } from "./media/MediaRouter.js";
import { MediaKindRegistry } from "./media/MediaKindRegistry.js";
import { autoSyncMediaConfig } from "./media/autoSyncMediaConfig.js";

export type AppDependencies = {
  providerRegistry?: ProviderAdapterRegistry;
  modelRegistry?: ModelRegistry;
  routingProfileRegistry?: RoutingProfileRegistry;
  providerRuntimeRegistry?: ProviderRuntimeRegistry;
  secretService?: SecretService;
  encryptionService?: LocalEncryptionService;
  circuitBreaker?: CircuitBreaker;
  concurrencyLimiter?: ConcurrencyLimiter;
  adminAuditService?: AdminAuditService;
  metricsService?: MetricsService;
  configRevisionService?: ConfigRevisionService;
  apiKeyService?: ApiKeyService;
  adminKeyService?: AdminKeyService;
  requestLogService?: RequestLogService;
  usageService?: UsageService;
  rateLimitService?: RateLimitService;
  persistenceService?: StateStore;
  database?: Database;
};

declare module "fastify" {
  interface FastifyInstance {
    providerRegistry: ProviderAdapterRegistry;
    modelRegistry: ModelRegistry;
    routingProfileRegistry: RoutingProfileRegistry;
    modelResolver: ModelResolver;
    providerRuntimeRegistry: ProviderRuntimeRegistry;
    secretService: SecretService;
    encryptionService: LocalEncryptionService;
    circuitBreaker: CircuitBreaker;
    refreshLockService: RefreshLockService;
    concurrencyLimiter: ConcurrencyLimiter;
    adminAuditService: AdminAuditService;
    metricsService: MetricsService;
    configRevisionService: ConfigRevisionService;
    apiKeyService: ApiKeyService;
    adminKeyService: AdminKeyService;
    requestLogService: RequestLogService;
    usageService: UsageService;
    usageLogStore: UsageLogStore;
    rateLimitService: RateLimitService;
    persistenceService: StateStore;
    database: Database;
    tokenSaverService: TokenSaverService;
    requestQueueService: RequestQueueService;
    teamService: TeamService;
    webhookService: WebhookService;
    proxyPoolService: ProxyPoolService;
    modelPricingService: ModelPricingService;
    mediaRouter: MediaRouter;
    accountQuotaService: AccountQuotaService;
    credentialWritebackService: CredentialWritebackService;
    latencyTracker: LatencyTrackerService;
    spendLedgerService: SpendLedgerService;
    responseCacheService: ResponseCacheService;
  }
}

export async function buildApp(
  config: AppConfig,
  dependencies: AppDependencies = {}
): Promise<FastifyInstance> {
  const app = fastify({
    logger: {
      level: config.logLevel,
      redact: {
        paths: [
          "req.headers.authorization",
          "req.headers.cookie",
          "req.headers.x-api-key",
          "headers.authorization",
          "headers.cookie",
          "headers.x-api-key"
        ],
        censor: "[REDACTED]"
      },
      serializers: {
        req(request) {
          return {
            method: request.method,
            url: request.url,
            headers: redactObject(request.headers)
          };
        }
      }
    },
    bodyLimit: parseBodyLimit(config.requestBodyLimit),
    genReqId: (request) => {
      const incoming = request.headers["x-request-id"];
      return typeof incoming === "string" && /^[A-Za-z0-9._:-]{1,128}$/.test(incoming)
        ? incoming
        : randomUUID();
    }
  });

  const persistenceEnabled =
    config.nodeEnv !== "test" || Boolean(dependencies.persistenceService);

  // persistence-sqlite — durable store for transactional money state (wallet +
  // seller earnings) AND, since non-money-state-to-sqlite, the config/runtime
  // state too. In test (no real persistence) use an in-memory DB; in production
  // derive the file next to the JSON state file.
  const sqliteDb =
    dependencies.database ??
    new Database(
      persistenceEnabled ? deriveSqlitePath(config.dataFile) : ":memory:"
    );
  app.decorate("database", sqliteDb);
  // Close the DB on app shutdown only when buildApp created it. An injected DB
  // (dependencies.database) is owned by the caller — leave its lifecycle alone.
  if (!dependencies.database) {
    app.addHook("onClose", () => sqliteDb.close());
  }

  // non-money-state-to-sqlite — the config StateStore. A test that injects a
  // PersistenceService keeps the JSON substrate; otherwise the SQLite-backed
  // ConfigStore is used. On first boot, a legacy JSON state file is imported
  // once (marker-guarded) so existing deployments migrate transparently.
  const persistenceService =
    dependencies.persistenceService ??
    (await buildConfigStore(sqliteDb, config, persistenceEnabled));
  const persistedState = persistenceEnabled ? await persistenceService.load() : null;

  const providerRegistry =
    dependencies.providerRegistry ??
    createDefaultProviderRegistry({
      onCredentialRefreshed: (accountId, payload) =>
        app.credentialWritebackService.persist(accountId, payload),
      // Serialize an adapter's in-band token refresh per account with the
      // background/on-401 refresh paths (RefreshLockService), re-reading the
      // live credential inside the lock so a rotating refresh token is consumed
      // once even under concurrent requests for the same account.
      refreshCoordinator: (accountId, stale, doRefresh) =>
        app.refreshLockService.serialize(accountId, () => {
          const secret = app.secretService.getSecretForAccount(accountId);
          const current = secret
            ? (app.secretService.decryptSecretPayload(secret) as Record<string, unknown>)
            : stale;
          return doRefresh(current);
        }),
    });
  const modelRegistry =
    dependencies.modelRegistry ??
    (persistedState
      ? new ModelRegistry(persistedState.modelMappings)
      : createDefaultModelRegistry());
  const routingProfileRegistry =
    dependencies.routingProfileRegistry ??
    (persistedState
      ? new RoutingProfileRegistry(persistedState.routingProfiles)
      : createDefaultRoutingProfileRegistry());
  const providerRuntimeRegistry =
    dependencies.providerRuntimeRegistry ??
    (persistedState
      ? createProviderRuntimeRegistryFromState(persistedState)
      : createDefaultProviderRuntimeRegistry());
  const modelResolver = new ModelResolver(
    modelRegistry,
    routingProfileRegistry,
    undefined,
    (id) => providerRuntimeRegistry.getProviderInstance(id)?.priority,
    (id) => providerRuntimeRegistry.getProviderInstance(id)?.groupName,
    (id) => providerRuntimeRegistry.getProviderInstance(id)?.modelMapping
  );
  const encryptionService =
    dependencies.encryptionService ?? new LocalEncryptionService(config.encryptionKey);
  const secretService =
    dependencies.secretService ??
    new SecretService(encryptionService);
  const circuitBreaker = dependencies.circuitBreaker ?? new CircuitBreaker();
  const refreshLockService = new RefreshLockService();
  const concurrencyLimiter =
    dependencies.concurrencyLimiter ?? new ConcurrencyLimiter(100);
  const adminAuditService =
    dependencies.adminAuditService ?? new AdminAuditService();
  const metricsService = dependencies.metricsService ?? new MetricsService();
  const configRevisionService =
    dependencies.configRevisionService ??
    new ConfigRevisionService(
      persistedState?.config.current,
      persistedState?.config.revisions
    );
  const apiKeyService =
    dependencies.apiKeyService ?? new ApiKeyService(config.internalApiKeys);
  const requestLogService =
    dependencies.requestLogService ?? new RequestLogService();
  const usageService = dependencies.usageService ?? new UsageService();
  // Durable append-only usage log on SQLite for long-range reconciliation
  // (/provision/usage). The ring-buffer UsageService stays the live UI source.
  const usageLogStore = new UsageLogStore(sqliteDb);
  usageService.setSink((r) => usageLogStore.append({
    requestId: r.requestId,
    apiKeyHash: r.apiKeyHash,
    model: r.model,
    providerType: r.providerType,
    protocol: r.protocol,
    promptTokens: r.promptTokens,
    completionTokens: r.completionTokens,
    totalTokens: r.totalTokens,
    cachedTokens: r.cachedTokens,
    estimatedCost: r.estimatedCost
  }));
  // One-time backfill: usage_log is the new home for usage history, but the
  // legacy JSON state file still holds pre-upgrade usage rows that the
  // config migration did not carry. If usage_log is empty, import them once
  // (preserving original timestamps + ids; idempotent via INSERT OR IGNORE) so
  // the Usage page is not blank after upgrading. Best-effort; never blocks boot.
  if (persistenceEnabled && usageLogStore.count() === 0) {
    await backfillUsageLogFromLegacyJson(usageLogStore, config.dataFile);
  }
  const rateLimitService =
    dependencies.rateLimitService ??
    new RateLimitService({
      requestsPerMinute: config.internalRateLimitPerMinute,
      dailyRequestQuota: config.internalDailyRequestQuota,
      dailyTokenQuota: config.internalDailyTokenQuota
    });

  if (persistedState?.rateLimitCounters && !dependencies.rateLimitService) {
    rateLimitService.loadState(persistedState.rateLimitCounters);
  }

  // Add-account specific services
  const addAccountLockService = new AddAccountLockService();
  const idempotencyStore = new IdempotencyStore();
  const oauthSessionStore = new OAuthSessionStore();
  const addAccountRateLimiter = new RateLimitService({
    requestsPerMinute: config.addAccountRateLimitPerMinute,
    dailyRequestQuota: 0, // unlimited daily
    dailyTokenQuota: 0
  });

  // Token Saver
  const tokenSaverService = new TokenSaverService();
  if (persistedState?.tokenSaver) {
    tokenSaverService.loadSettings(persistedState.tokenSaver);
  }

  // Request Queue (optional backpressure)
  const requestQueueService = new RequestQueueService({
    enabled: process.env.REQUEST_QUEUE_ENABLED === "true",
    maxSize: parseInt(process.env.REQUEST_QUEUE_MAX_SIZE || "100", 10),
    timeoutMs: parseInt(process.env.REQUEST_QUEUE_TIMEOUT_MS || "10000", 10),
  });

  // Teams
  const teamService = new TeamService();
  if (persistedState?.teams) {
    teamService.load(persistedState.teams);
  }

  // Hydrate the live usage ring from the durable SQLite usage_log (newest-first,
  // capped to the ring size). usage is no longer stored in the JSON state; an
  // older JSON file's `usage` slice is used only as a fallback when the SQLite
  // log is empty (forward migration from pre-SQLite state).
  {
    const ringCap = 1000;
    const durable = usageLogStore.query({ limit: ringCap });
    if (durable.data.length > 0) {
      usageService.load(
        durable.data.map((r) => ({
          id: r.id,
          requestId: r.requestId ?? "",
          protocol: (r.protocol as "openai" | "anthropic") ?? "openai",
          model: r.model ?? "",
          providerType: r.providerType ?? "",
          providerInstanceId: "",
          apiKeyHash: r.apiKeyHash ?? undefined,
          promptTokens: r.promptTokens,
          completionTokens: r.completionTokens,
          totalTokens: r.totalTokens,
          cachedTokens: r.cachedTokens || undefined,
          estimatedCost: r.estimatedCost || undefined,
          createdAt: new Date(r.ts)
        })) as Parameters<typeof usageService.load>[0]
      );
    } else if (persistedState?.usage) {
      usageService.load(persistedState.usage as Parameters<typeof usageService.load>[0]);
    }
  }
  // requestLogs are in-memory only (no longer persisted to JSON). An older file
  // that still carries them is hydrated once for continuity.
  if (persistedState?.requestLogs) {
    requestLogService.load(persistedState.requestLogs as Parameters<typeof requestLogService.load>[0]);
  }

  // Webhook notifications
  const webhookService = new WebhookService();

  // Model Pricing
  const modelPricingService = new ModelPricingService();
  if (persistedState?.modelPricing) {
    modelPricingService.load(persistedState.modelPricing);
  }

  // Proxy Pool Service
  const proxyPoolService = new ProxyPoolService();
  if (persistedState?.proxyPools) {
    proxyPoolService.load(persistedState.proxyPools);
  }

  // Media Router
  const mediaRouter = new MediaRouter(providerRuntimeRegistry, proxyPoolService, undefined, secretService);

  // Auto-sync media config for provider instances that were created outside
  // the dashboard (e.g. via OAuth auto-import) and don't have serviceKinds yet.
  const syncedCount = autoSyncMediaConfig(providerRuntimeRegistry);
  if (syncedCount > 0) {
    app.log.info({ count: syncedCount }, "Auto-synced media config for provider instances");
  }

  app.decorate("providerRegistry", providerRegistry);
  app.decorate("modelRegistry", modelRegistry);
  app.decorate("routingProfileRegistry", routingProfileRegistry);
  app.decorate("modelResolver", modelResolver);
  app.decorate("providerRuntimeRegistry", providerRuntimeRegistry);
  app.decorate("secretService", secretService);
  app.decorate("encryptionService", encryptionService);
  app.decorate("circuitBreaker", circuitBreaker);
  app.decorate("refreshLockService", refreshLockService);
  app.decorate("concurrencyLimiter", concurrencyLimiter);
  app.decorate("adminAuditService", adminAuditService);
  app.decorate("metricsService", metricsService);
  app.decorate("configRevisionService", configRevisionService);
  app.decorate("apiKeyService", apiKeyService);
  app.decorate(
    "adminKeyService",
    dependencies.adminKeyService ?? new AdminKeyService(config.adminApiKeys)
  );
  if (persistedState && !dependencies.apiKeyService) {
    for (const apiKey of persistedState.apiKeys) {
      apiKeyService.addRecord(apiKey);
    }
  }

  if (persistedState && !dependencies.secretService) {
    for (const secret of persistedState.secrets) {
      secretService.addSecret(secret);
    }
  }

  app.decorate("requestLogService", requestLogService);
  app.decorate("usageService", usageService);
  app.decorate("usageLogStore", usageLogStore);
  app.decorate("rateLimitService", rateLimitService);
  app.decorate("persistenceService", persistenceService);
  // Flush any pending debounced save before the process exits so a final
  // mutation isn't lost on shutdown.
  if (persistenceEnabled) {
    app.addHook("onClose", () => persistenceService.drain());
  }
  app.decorate("tokenSaverService", tokenSaverService);
  app.decorate("requestQueueService", requestQueueService);
  app.decorate("teamService", teamService);
  app.decorate("webhookService", webhookService);
  app.decorate("proxyPoolService", proxyPoolService);
  app.decorate("modelPricingService", modelPricingService);
  app.decorate("mediaRouter", mediaRouter);
  app.decorate("accountQuotaService", new AccountQuotaService());
  app.decorate("credentialWritebackService", new CredentialWritebackService(secretService, () => app.persistState()));
  const latencyTracker = new LatencyTrackerService();
  if (config.nodeEnv !== "test") {
    latencyTracker.start();
    app.addHook("onClose", () => latencyTracker.stop());
  }
  app.decorate("latencyTracker", latencyTracker);

  // Phase 32 — spending-caps ledger
  const spendLedgerService = new SpendLedgerService();
  spendLedgerService.load(persistedState?.spendLedger ?? null);
  spendLedgerService.setPersistCallback(() => {
    if (persistenceEnabled) {
      app.persistenceService.saveDebounced(createPersistedState(app));
    }
  });
  app.decorate("spendLedgerService", spendLedgerService);

  // Open-core seam — marketplace extension points (empty unless the marketplace
  // layer registers into them). Decorated unconditionally so engine code
  // (enforceKeyPolicy, persistence) can reference it without importing the
  // marketplace. See services/MarketplaceSeam.ts and marketplace/README.md.
  app.decorate("marketplaceSeam", new MarketplaceSeam());
  // Shared persist trigger so marketplace services can request a save without
  // reaching into createPersistedState directly.
  app.decorate("persistState", () => {
    if (persistenceEnabled) {
      app.persistenceService.saveDebounced(createPersistedState(app));
    }
  });

  // Phase 32 — semantic-response-cache
  const responseCacheService = new ResponseCacheService();
  if (config.nodeEnv !== "test") {
    responseCacheService.start();
    app.addHook("onClose", () => responseCacheService.stop());
  }
  app.decorate("responseCacheService", responseCacheService);

  app.addHook("onSend", async (request, reply, payload) => {
    // Persist on admin/provision mutations only. A routine /v1/* completion no
    // longer rewrites the JSON state: usage is durable in SQLite, request logs
    // are in-memory, and money state (spend ledger / marketplace) self-persists
    // through its own debounced callbacks. The save is coalesced + single-flight
    // so a burst of mutations collapses to one ordered write off the hot path.
    if (
      persistenceEnabled &&
      (
        (request.url.startsWith("/admin/") && ["POST", "PATCH", "PUT", "DELETE"].includes(request.method)) ||
        (request.url.startsWith("/provision/") && ["POST", "PATCH", "PUT", "DELETE"].includes(request.method))
      ) &&
      reply.statusCode < 400
    ) {
      app.persistenceService.saveDebounced(createPersistedState(app));
    }

    return payload;
  });

  // Safety net for spend reservations: release any reservation still held when
  // the response finishes. The /v1 routes settle/release in the failover loop,
  // but several early returns (cache hit, no-provider-in-group 404, direct
  // account routing) bypass that loop and would otherwise leak a wallet hold.
  // settle() removes the reservation, so this release is a no-op on the happy
  // path; it only fires for paths that exited without settling.
  app.addHook("onResponse", async (request) => {
    const reservation = request.spendReservation;
    if (reservation) {
      request.spendReservation = undefined;
      for (const id of reservation.id.split("|")) {
        try {
          spendLedgerService.release(id);
        } catch {
          // best-effort cleanup — never throw out of a response hook
        }
      }
    }
    // marketplace-money-hardening H1: release any marketplace reservation (PAYG
    // wallet hold, plan bucket, token pack) still held when the response finishes.
    // The settlement hook nulls these on the normal path, so this only fires for
    // early returns (cache hit, direct-route 404, no-provider) that bypass it and
    // would otherwise leak a real wallet hold until the next boot sweep. No-op
    // when the marketplace is disabled.
    app.marketplaceSeam.releaseLeakedReservations(request);
  });

  await registerRequestId(app);
  await registerLogger(app);
  // Register the error handler BEFORE the routes. A later `app.register()` (the
  // dashboard's @fastify/static) closes the root context for error-handler
  // inheritance, so a handler set after the routes would not apply to them —
  // thrown errors would fall back to Fastify's default shape. Setting it first
  // guarantees the `{ error: { type, message, code } }` envelope for every route
  // (and routes the ZodError→400 / NotFoundError→404 corrections correctly).
  await registerErrorHandler(app);
  await registerMetricsRoute(app, config);
  await registerHealthzRoute(app);
  await registerReadyzRoute(app, config);
  await registerOAuthRoutes(app, oauthSessionStore);
  await registerModelsRoute(app, config);
  await registerOpenAIRoutes(app, config);
  await registerAnthropicRoutes(app, config);
  await registerAdminRoutes(app, config);
  await registerProviderAccountRoutes(app, config, {
    providerRegistry,
    providerRuntimeRegistry,
    secretService,
    encryptionService,
    addAccountLockService,
    idempotencyStore,
    oauthSessionStore,
    addAccountRateLimiter,
    adminAuditService,
    metricsService,
    persistenceService,
    configRevisionService,
  });

  await registerProviderAccountManagementRoutes(app, config);

  await registerProxyPoolRoutes(app, config, proxyPoolService);
  await registerMediaProviderRoutes(app, config);
  await registerEmbeddingsRoutes(app, config);
  await registerPublicRoutes(app, config);
  await registerImagesRoutes(app, config);
  await registerAudioRoutes(app, config);
  await registerWebRoutes(app, config);

  // Commercial marketplace layer (open-core seam). Only loaded when the flag is
  // on; the engine never imports marketplace code otherwise. This is the single
  // call site — to build a clean core, remove this block and the marketplace/
  // directory. See marketplace/README.md.
  if (config.marketplaceEnabled) {
    const { registerMarketplace } = await import("./marketplace/index.js");
    registerMarketplace(app, { config, persistedState, database: sqliteDb });
  }

  // Register dashboard static serving AFTER all API routes to ensure API priority
  await registerDashboardPlugin(app);

  // Start background auto-refresh service (proactively refreshes tokens before expiry)
  if (config.nodeEnv !== "test") {
    const autoRefresh = new AutoRefreshService();
    autoRefresh.start(app);
    app.addHook("onClose", () => autoRefresh.stop());
  }

  return app;
}

/** Derive the SQLite money-store path from the JSON state file (sibling file). */
function deriveSqlitePath(dataFile: string): string {
  return join(dirname(dataFile), "gateway.sqlite");
}

/**
 * One-time backfill of the legacy JSON `usage` slice into the SQLite usage_log,
 * preserving each record's original timestamp + id. Runs only when usage_log is
 * empty (so it doesn't double-count once real traffic populates the table). The
 * config migration (buildConfigStore) intentionally does NOT carry usage —
 * usage lives in usage_log now — so without this the Usage page would be blank
 * after upgrading from a pre-SQLite JSON state. Best-effort: a missing/corrupt
 * legacy file is ignored (fresh install or no history).
 */
async function backfillUsageLogFromLegacyJson(
  usageLogStore: UsageLogStore,
  dataFile: string
): Promise<void> {
  let raw: string;
  try {
    raw = await readFile(dataFile, "utf8");
  } catch {
    return; // no legacy file → nothing to backfill
  }
  try {
    const legacy = JSON.parse(raw) as { usage?: Array<Record<string, unknown>> };
    const usage = Array.isArray(legacy.usage) ? legacy.usage : [];
    if (usage.length === 0) return;
    const rows = usage.map((u) => ({
      id: typeof u.id === "string" ? u.id : undefined,
      ts: u.createdAt ? new Date(u.createdAt as string).getTime() : Date.now(),
      requestId: typeof u.requestId === "string" ? u.requestId : undefined,
      apiKeyHash: typeof u.apiKeyHash === "string" ? u.apiKeyHash : undefined,
      model: typeof u.model === "string" ? u.model : undefined,
      providerType: typeof u.providerType === "string" ? u.providerType : undefined,
      protocol: typeof u.protocol === "string" ? u.protocol : undefined,
      promptTokens: Number(u.promptTokens) || 0,
      completionTokens: Number(u.completionTokens) || 0,
      totalTokens: Number(u.totalTokens) || 0,
      cachedTokens: Number(u.cachedTokens) || 0,
      estimatedCost: Number(u.estimatedCost) || 0
    }));
    const inserted = usageLogStore.importRows(rows);
    // eslint-disable-next-line no-console
    console.info(`[usage-backfill] imported ${inserted} legacy usage rows into usage_log from ${dataFile}`);
  } catch {
    // corrupt legacy JSON → skip backfill (config import path surfaces the error)
  }
}

/**
 * non-money-state-to-sqlite — build the SQLite ConfigStore and, on first boot,
 * import a legacy JSON state file into it once (marker-guarded + idempotent).
 * The JSON file is read once as an import source then ignored; it is left on
 * disk as a rollback artifact (not deleted).
 */
async function buildConfigStore(
  database: Database,
  config: AppConfig,
  persistenceEnabled: boolean
): Promise<ConfigStore> {
  const store = new ConfigStore(database);
  if (!persistenceEnabled) {
    return store;
  }
  if (!store.isImported()) {
    let raw: string;
    try {
      raw = await readFile(config.dataFile, "utf8");
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        // No legacy file = fresh install. Mark imported so we don't re-stat it
        // every boot; the store starts empty, which is correct here.
        store.importFrom(EMPTY_STATE);
        return store;
      }
      throw error; // a present-but-unreadable file is a real fault — fail loudly
    }
    // A PRESENT legacy file that fails to parse/validate must NOT be silently
    // wiped: importing empty + marking done would permanently abandon the
    // deployment's accounts/secrets/keys. Fail boot loudly (matches the JSON
    // PersistenceService.load() behavior) so the operator can fix/rollback.
    const legacy = parsePersistedState(JSON.parse(raw));
    const { imported } = store.importFrom(legacy);
    // eslint-disable-next-line no-console
    console.info(`[config-store] imported ${imported} config rows from legacy JSON ${config.dataFile}`);
  }
  return store;
}

const EMPTY_STATE: PersistedGatewayState = {
  providerInstances: [],
  accounts: [],
  modelMappings: [],
  routingProfiles: [],
  apiKeys: [],
  secrets: [],
  config: { current: {}, revisions: [] }
} as PersistedGatewayState;

function parseBodyLimit(value: string): number {
  const match = value.trim().toLowerCase().match(/^(\d+)(b|kb|mb)?$/);

  if (!match) {
    throw new Error(`Invalid REQUEST_BODY_LIMIT: ${value}`);
  }

  const amount = Number(match[1]);
  const unit = match[2] ?? "b";

  if (unit === "mb") {
    return amount * 1024 * 1024;
  }

  if (unit === "kb") {
    return amount * 1024;
  }

  return amount;
}

function createProviderRuntimeRegistryFromState(
  state: PersistedGatewayState
): ProviderRuntimeRegistry {
  const accountPools = state.providerInstances.map((providerInstance) => ({
    providerInstanceId: providerInstance.id,
    accountPool: new AccountPool(
      state.accounts.filter(
        (account) => account.providerInstanceId === providerInstance.id
      ),
      createAccountSelectionStrategy(providerInstance.accountSelectionStrategy)
    )
  }));

  return new ProviderRuntimeRegistry(state.providerInstances, accountPools);
}

