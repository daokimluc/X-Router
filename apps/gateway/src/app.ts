import fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import type { AppConfig } from "./config.js";
import { registerErrorHandler } from "./middleware/errorHandler.js";
import { registerLogger } from "./middleware/logger.js";
import { registerRequestId } from "./middleware/requestId.js";
import { registerHealthzRoute } from "./routes/healthz.js";
import { registerAnthropicRoutes } from "./routes/anthropic.js";
import { registerAdminRoutes } from "./routes/admin.js";
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
import { ModelPricingService } from "./services/ModelPricingService.js";
import { TokenSaverService } from "./services/TokenSaverService.js";
import { RequestQueueService } from "./services/RequestQueueService.js";
import { TeamService } from "./services/TeamService.js";
import { AccountQuotaService } from "./services/AccountQuotaService.js";
import { AutoRefreshService } from "./services/AutoRefreshService.js";
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
  type PersistedGatewayState
} from "./services/PersistenceService.js";
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
  persistenceService?: PersistenceService;
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
    circuitBreaker: CircuitBreaker;
    concurrencyLimiter: ConcurrencyLimiter;
    adminAuditService: AdminAuditService;
    metricsService: MetricsService;
    configRevisionService: ConfigRevisionService;
    apiKeyService: ApiKeyService;
    adminKeyService: AdminKeyService;
    requestLogService: RequestLogService;
    usageService: UsageService;
    rateLimitService: RateLimitService;
    persistenceService: PersistenceService;
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

  const persistenceService =
    dependencies.persistenceService ?? new PersistenceService(config.dataFile);
  const persistenceEnabled =
    config.nodeEnv !== "test" || Boolean(dependencies.persistenceService);
  const persistedState = persistenceEnabled ? await persistenceService.load() : null;

  // persistence-sqlite — durable store for transactional money state (wallet +
  // seller earnings). In test (no real persistence) use an in-memory DB; in
  // production derive the file next to the JSON state file.
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

  const providerRegistry =
    dependencies.providerRegistry ??
    createDefaultProviderRegistry({
      onCredentialRefreshed: (accountId, payload) =>
        app.credentialWritebackService.persist(accountId, payload),
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
  const secretService =
    dependencies.secretService ??
    new SecretService(new LocalEncryptionService("development-local-secret-key"));
  const circuitBreaker = dependencies.circuitBreaker ?? new CircuitBreaker();
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
  const encryptionService = new LocalEncryptionService("development-local-secret-key");

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

  // Load persisted usage and request logs
  if (persistedState?.usage) {
    usageService.load(persistedState.usage as Parameters<typeof usageService.load>[0]);
  }
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
  app.decorate("circuitBreaker", circuitBreaker);
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
  app.decorate("rateLimitService", rateLimitService);
  app.decorate("persistenceService", persistenceService);
  app.decorate("tokenSaverService", tokenSaverService);
  app.decorate("requestQueueService", requestQueueService);
  app.decorate("teamService", teamService);
  app.decorate("webhookService", webhookService);
  app.decorate("proxyPoolService", proxyPoolService);
  app.decorate("modelPricingService", modelPricingService);
  app.decorate("mediaRouter", mediaRouter);
  app.decorate("accountQuotaService", new AccountQuotaService());
  app.decorate("credentialWritebackService", new CredentialWritebackService(secretService));
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
      void app.persistenceService.save(createPersistedState(app));
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
      void app.persistenceService.save(createPersistedState(app));
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
    if (
      persistenceEnabled &&
      (
        (request.url.startsWith("/admin/") && ["POST", "PATCH", "PUT", "DELETE"].includes(request.method)) ||
        (request.url.startsWith("/v1/") && request.method === "POST")
      ) &&
      reply.statusCode < 400
    ) {
      await app.persistenceService.save(createPersistedState(app));
    }

    return payload;
  });

  await registerRequestId(app);
  await registerLogger(app);
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
  await registerPublicRoutes(app);
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

  await registerErrorHandler(app);

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

function createPersistedState(app: FastifyInstance): PersistedGatewayState {
  return {
    providerInstances: app.providerRuntimeRegistry.listProviderInstances(),
    accounts: app.providerRuntimeRegistry.listAccounts(),
    modelMappings: app.modelRegistry.listModelMappings(),
    routingProfiles: app.routingProfileRegistry.listRoutingProfiles(),
    apiKeys: app.apiKeyService.listWithKeys(),
    secrets: app.secretService.listSecrets(),
    config: {
      current: app.configRevisionService.getCurrent(),
      revisions: app.configRevisionService.listRevisions()
    },
    tokenSaver: app.tokenSaverService.getSettings(),
    teams: app.teamService.list(),
    usage: app.usageService.listAll(),
    requestLogs: app.requestLogService.listAll(),
    proxyPools: app.proxyPoolService.listAll(),
    rateLimitCounters: app.rateLimitService.exportState(),
    modelPricing: app.modelPricingService.export(),
    spendLedger: app.spendLedgerService.toPersisted(),
    marketplace: app.marketplaceSeam.collectPersisted()
  };
}
