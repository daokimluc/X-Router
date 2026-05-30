/**
 * Marketplace layer entry point (proprietary, open-core boundary).
 *
 * This is the SINGLE seam between the core engine and the commercial
 * marketplace layer. The engine calls `registerMarketplace(app, deps)` exactly
 * once, and only when `config.marketplaceEnabled` is true (see app.ts). When the
 * flag is off the engine never imports this module at all.
 *
 * INVARIANT: nothing under apps/gateway/src/ outside this `marketplace/` folder
 * may import from here. Dependency direction is one-way: marketplace → engine.
 * Enforced by test/marketplaceBoundary.test.ts.
 */
import type { FastifyInstance } from "fastify";
import type { AppConfig } from "../config.js";
import type { Database } from "../services/Database.js";
import type { PersistedGatewayState } from "../services/PersistenceService.js";
import { WalletService, type PersistedWallet } from "./services/WalletService.js";
import { PlanService, type PersistedPlans } from "./services/PlanService.js";
import { SellerService, type PersistedSellers } from "./services/SellerService.js";
import { MarketPricingService, type PersistedMarketPricing } from "./services/MarketPricingService.js";
import { SellerEarningsLedger, type PersistedSellerEarnings } from "./services/SellerEarningsLedger.js";
import { type PaygDecision } from "./services/PaygDecision.js";
import { RealPaygDecision } from "./services/RealPaygDecision.js";
import { createMarketplacePolicyCheck } from "./policy/marketplacePolicyCheck.js";
import { createSettlementHook } from "./policy/settlementHook.js";
import { createCandidateRanker, routedContextFor } from "./policy/marketplaceRouting.js";
import { syncAllListings } from "./policy/sellerRegistry.js";
import { registerWalletAdminRoutes } from "./routes/walletAdmin.js";
import { registerPlanAdminRoutes } from "./routes/planAdmin.js";
import { registerSellerAdminRoutes } from "./routes/sellerAdmin.js";
import { registerMarkupAdminRoutes } from "./routes/markupAdmin.js";
import { registerEarningsAdminRoutes } from "./routes/earningsAdmin.js";
import { registerProvisionRoutes } from "./routes/provision.js";
import { registerBusinessWebhookAdminRoutes } from "./routes/businessWebhookAdmin.js";

export type MarketplaceDeps = {
  config: AppConfig;
  /** Persisted gateway state loaded at boot, or null in test/no-persist mode. */
  persistedState: PersistedGatewayState | null;
  /** SQLite store for transactional money state (wallet + seller earnings). */
  database: Database;
};

declare module "fastify" {
  interface FastifyInstance {
    walletService: WalletService;
    planService: PlanService;
    sellerService: SellerService;
    marketPricingService: MarketPricingService;
    sellerEarningsLedger: SellerEarningsLedger;
    paygDecision: PaygDecision;
  }
}

/**
 * Wire the marketplace layer onto the running app. Called once from app.ts when
 * the marketplace flag is on. Each of the 7 changes adds its setup here.
 */
export function registerMarketplace(
  app: FastifyInstance,
  deps: MarketplaceDeps
): void {
  app.log.info("Marketplace layer enabled");

  // ── usd-wallet (#1) ──────────────────────────────────────────────────────
  // SQLite-backed (persistence-sqlite). Money state lives in the durable store,
  // NOT the JSON slice, so there is no load()/persist-contributor here.
  const walletService = new WalletService(deps.database);

  // One-time import from the legacy JSON wallet slice (idempotent via INSERT OR
  // IGNORE — safe to call every boot; a key already in SQLite is left alone).
  walletService.importLegacy(
    deps.persistedState?.marketplace?.wallet as PersistedWallet | undefined
  );

  // Migrate legacy token balances: any key that still carries the legacy token
  // `balance` field (and has no USD wallet) gets a provisioned $0 wallet, and a
  // warning is logged. Idempotent — keys already migrated (walletMicroUsd set,
  // no legacy balance) are untouched. Token counts are NOT converted to USD.
  for (const key of deps.persistedState?.apiKeys ?? []) {
    const legacy = (key as { balance?: number }).balance;
    const hasWallet =
      key.walletMicroUsd !== undefined || walletService.isProvisioned(key.id);
    if (legacy !== undefined && !hasWallet) {
      walletService.open(key.id); // → $0
      // Sync the live key snapshot: provisioned at $0, legacy field cleared.
      app.apiKeyService.setWalletMicroUsd(key.id, 0);
      app.log.warn(
        { key: key.id, legacyTokenBalance: legacy },
        "wallet-migration: legacy token balance dropped; re-topup in USD"
      );
    } else if (key.walletMicroUsd !== undefined && !walletService.isProvisioned(key.id)) {
      // Restore from the per-key persisted field if the slice didn't carry it.
      walletService.topupUsd(key.id, key.walletMicroUsd / 1_000_000);
    }
  }

  // Boot sweep: release any reservation rows orphaned by a crash between
  // reserve and settle/release, returning the held funds.
  walletService.sweepReservations();

  app.decorate("walletService", walletService);

  // ── marketplace-plans (#3) ───────────────────────────────────────────────
  const planService = new PlanService();
  planService.load(deps.persistedState?.marketplace?.plans as PersistedPlans | undefined ?? null);
  planService.setPersistCallback(() => app.persistState());
  app.marketplaceSeam.addPersistenceContributor({
    name: "plans",
    toPersisted: () => planService.toPersisted()
  });
  app.decorate("planService", planService);

  // Real PAYG decision (two-sided-settlement #6): reserves the wallet + the
  // PAYG-daily bucket when overage/boost charge to the wallet.
  const paygDecision: PaygDecision = new RealPaygDecision(walletService, app.spendLedgerService);
  app.decorate("paygDecision", paygDecision);

  // Admin wallet endpoints (USD): GET wallet, POST topup.
  registerWalletAdminRoutes(app, deps.config, walletService);

  // Admin plan endpoints + key plan assignment.
  registerPlanAdminRoutes(app, deps.config, planService);

  // ── seller-supply (#4) ────────────────────────────────────────────────────
  const sellerService = new SellerService();
  sellerService.load(deps.persistedState?.marketplace?.sellers as PersistedSellers | undefined ?? null);
  sellerService.setPersistCallback(() => app.persistState());
  app.marketplaceSeam.addPersistenceContributor({
    name: "sellers",
    toPersisted: () => sellerService.toPersisted()
  });
  app.decorate("sellerService", sellerService);

  // Re-register all enabled listings into the model registry (direct + pooled).
  syncAllListings(app.modelRegistry, app.providerRuntimeRegistry, sellerService);

  // Admin seller + listing endpoints.
  registerSellerAdminRoutes(app, deps.config, sellerService);

  // ── lowest-cost-routing (#5) ──────────────────────────────────────────────
  const marketPricingService = new MarketPricingService();
  marketPricingService.load(deps.persistedState?.marketplace?.marketPricing as PersistedMarketPricing | undefined ?? null);
  marketPricingService.setPersistCallback(() => app.persistState());
  app.marketplaceSeam.addPersistenceContributor({
    name: "marketPricing",
    toPersisted: () => marketPricingService.toPersisted()
  });
  app.decorate("marketPricingService", marketPricingService);
  registerMarkupAdminRoutes(app, deps.config, marketPricingService);

  // Composite key-policy check (registered after seller/pricing exist so it can
  // capture routed cost data): plan-scope + per-group bucket reservation +
  // month-overage/boost PAYG handoff + the plan-less wallet-empty gate.
  app.marketplaceSeam.addKeyPolicyCheck(
    createMarketplacePolicyCheck({
      walletService,
      planService,
      spendLedgerService: app.spendLedgerService,
      modelPricingService: app.modelPricingService,
      paygDecision,
      getBody: (req) => req.body as { messages?: Array<{ content?: unknown }>; max_tokens?: number } | undefined,
      webhookService: app.webhookService
    })
  );

  // lowest-cost-routing-wiring — rank pooled candidates cheapest-seller-first.
  // The engine calls this after model resolution; request.routed is captured at
  // the route from the account actually leased (not a pre-routing guess).
  app.marketplaceSeam.setCandidateRanker(createCandidateRanker(sellerService));
  app.marketplaceSeam.setRoutedCapture((req, model, accountId) => {
    const ctxRouted = routedContextFor(sellerService, marketPricingService, model, accountId);
    if (ctxRouted) req.routed = ctxRouted;
  });

  // ── two-sided-settlement (#6) ─────────────────────────────────────────────
  // SQLite-backed (persistence-sqlite) — durable seller credit + platform
  // margin, no JSON slice / persist contributor.
  const sellerEarningsLedger = new SellerEarningsLedger(deps.database);
  sellerEarningsLedger.importLegacy(
    deps.persistedState?.marketplace?.sellerEarnings as PersistedSellerEarnings | undefined
  );
  app.decorate("sellerEarningsLedger", sellerEarningsLedger);
  registerEarningsAdminRoutes(app, deps.config, sellerEarningsLedger);

  // Settlement hook: charges the buyer (plan bucket or wallet) + credits the
  // seller after each billable request. Runs on the engine's settlement seam.
  app.marketplaceSeam.addSettlementHook(
    createSettlementHook({
      spendLedgerService: app.spendLedgerService,
      walletService,
      sellerService,
      marketPricingService,
      sellerEarningsLedger,
      webhookService: app.webhookService
    })
  );

  // ── provision-webhook (#7) ────────────────────────────────────────────────
  // Restore the business webhook config (separate from the ops Discord/Slack one).
  const bizCfg = deps.persistedState?.marketplace?.businessWebhook as
    | { enabled: boolean; url: string; secret: string; events: import("../services/WebhookService.js").WebhookEvent[] }
    | undefined;
  if (bizCfg) app.webhookService.updateBusinessConfig(bizCfg);
  app.marketplaceSeam.addPersistenceContributor({
    name: "businessWebhook",
    toPersisted: () => app.webhookService.getBusinessConfig()
  });

  // The /provision/* command surface (provision-key auth).
  registerProvisionRoutes(app, deps.config);

  // Admin endpoints to manage the business webhook config.
  registerBusinessWebhookAdminRoutes(app, deps.config);
}
