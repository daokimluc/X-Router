import type { FastifyInstance } from "fastify";
import type { PersistedGatewayState } from "./PersistenceService.js";

/**
 * The single canonical builder for the persisted gateway state. Every persist
 * path (the onSend hook, the `persistState` decorator, account-create rollback
 * flows) MUST serialize through this so no path can drop a state slice or strip
 * raw API-key material.
 *
 * Lives in its own module (not app.ts) so route modules can import it without a
 * circular dependency on app.ts.
 *
 * Note: `usage` is durable in SQLite (`usage_log`) and `requestLogs` are
 * in-memory only — neither is re-persisted into the JSON state, which keeps the
 * request hot path from rewriting a 1-3 MB blob on every `/v1` POST.
 */
export function createPersistedState(app: FastifyInstance): PersistedGatewayState {
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
    proxyPools: app.proxyPoolService.listAll(),
    rateLimitCounters: app.rateLimitService.exportState(),
    modelPricing: app.modelPricingService.export(),
    spendLedger: app.spendLedgerService.toPersisted(),
    marketplace: app.marketplaceSeam.collectPersisted()
  };
}
