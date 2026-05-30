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
import { routedContextForCheapest } from "./policy/marketplaceRouting.js";
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
  const walletService = new WalletService();

  // Restore persisted wallet balances from the opaque marketplace slice.
  const walletSlice = deps.persistedState?.marketplace?.wallet as
    | PersistedWallet
    | undefined;
  walletService.load(walletSlice ?? null);

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

  // Persist wallet state through the engine's persist trigger + register the
  // contributor so the wallet slice lands in the gateway state file.
  walletService.setPersistCallback(() => app.persistState());
  app.marketplaceSeam.addPersistenceContributor({
    name: "wallet",
    toPersisted: () => walletService.toPersisted()
  });

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
      captureRouted: (req, model) => {
        const ctxRouted = routedContextForCheapest(sellerService, marketPricingService, model);
        if (ctxRouted) req.routed = ctxRouted;
      },
      webhookService: app.webhookService
    })
  );

  // ── two-sided-settlement (#6) ─────────────────────────────────────────────
  const sellerEarningsLedger = new SellerEarningsLedger();
  sellerEarningsLedger.load(deps.persistedState?.marketplace?.sellerEarnings as PersistedSellerEarnings | undefined ?? null);
  sellerEarningsLedger.setPersistCallback(() => app.persistState());
  app.marketplaceSeam.addPersistenceContributor({
    name: "sellerEarnings",
    toPersisted: () => sellerEarningsLedger.toPersisted()
  });
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
