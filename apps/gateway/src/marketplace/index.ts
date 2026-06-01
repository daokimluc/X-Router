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
import { SettlementLedger } from "./services/SettlementLedger.js";
import { SupplyHealthMonitor } from "./services/SupplyHealthMonitor.js";
import { PlanSubscriptionService } from "./services/PlanSubscriptionService.js";
import { PlanRenewalMonitor } from "./services/PlanRenewalMonitor.js";
import { TokenGrantService } from "./services/TokenGrantService.js";
import { type PaygDecision } from "./services/PaygDecision.js";
import { RealPaygDecision } from "./services/RealPaygDecision.js";
import { createMarketplacePolicyCheck } from "./policy/marketplacePolicyCheck.js";
import { createSettlementHook } from "./policy/settlementHook.js";
import { createCandidateRanker, routedContextFor, buildCostFor } from "./policy/marketplaceRouting.js";
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
    settlementLedger: SettlementLedger;
    paygDecision: PaygDecision;
    planSubscriptionService: PlanSubscriptionService;
    tokenGrantService: TokenGrantService;
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
  //
  // marketplace-money-hardening H4: we deliberately do NOT reseed a wallet from
  // the denormalized `walletMicroUsd` key snapshot. That snapshot is display-only
  // and drifts (it isn't synced on the PAYG settle/release/refund paths), so
  // trusting it to recreate a balance could restore phantom funds or lose funds.
  // The SQLite `wallets` row is the sole money authority; if it is absent the
  // wallet is simply unprovisioned ($0) until a real top-up.
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

  // ── marketplace-plan-subscription ─────────────────────────────────────────
  // Paid plans are monthly subscriptions: charge on subscribe, auto-renew from
  // the wallet each period, downgrade to Free when underfunded. Drives the engine
  // key's neutral planChargedAt/planPeriodEnd fields. Used by POST /provision/grant
  // (subscribe/cancel), the policy check (lazy renew), and PlanRenewalMonitor.
  const planSubscriptionService = new PlanSubscriptionService({
    apiKeyService: app.apiKeyService,
    walletService,
    planService,
    spendLedgerService: app.spendLedgerService,
    webhookService: app.webhookService
  });
  app.decorate("planSubscriptionService", planSubscriptionService);

  // ── marketplace-token-packs ───────────────────────────────────────────────
  // Prepaid per-(key, baseModel) token balances, consumed ahead of plan + wallet.
  // SQLite-backed (token_grants). Used by POST /provision/token-pack + the policy
  // check (reserve before plan/PAYG) + the settlement hook (tokenpack track).
  const tokenGrantService = new TokenGrantService(deps.database);
  // Boot sweep: release any pack reservation orphaned by a crash between reserve
  // and settle, returning the held tokens to the grant (marketplace-money-hardening-2 M1).
  tokenGrantService.sweepReservations();
  app.decorate("tokenGrantService", tokenGrantService);

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
      marketPricingService,
      paygDecision,
      planSubscriptionService,
      tokenGrantService,
      getBody: (req) => req.body as { messages?: Array<{ content?: unknown }>; max_tokens?: number } | undefined,
      webhookService: app.webhookService
    })
  );

  // lowest-cost-routing-wiring — rank pooled candidates cheapest-seller-first.
  // The engine calls this after model resolution; request.routed is captured at
  // the route from the account actually leased (not a pre-routing guess).
  app.marketplaceSeam.setCandidateRanker(createCandidateRanker(sellerService));
  app.marketplaceSeam.setRoutedCapture((req, model, accountId) => {
    // Always (re)assign — on failover to an uncosted account, ctxRouted is null
    // and request.routed MUST clear, else settlement would credit the previously
    // captured (failed) seller for a request a different account served.
    req.routed = routedContextFor(sellerService, marketPricingService, model, accountId) ?? undefined;
  });
  // Per-account cost lookup so an instance using the `lowest_cost` pool strategy
  // can actually rank by seller cost at acquire time (not just the candidate-layer
  // ranker). buildCostFor returns null for a model with no costed supply → the
  // strategy degrades to its tie-break order.
  app.marketplaceSeam.setCostForBuilder((model) => buildCostFor(sellerService, model));

  // ── two-sided-settlement (#6) ─────────────────────────────────────────────
  // SQLite-backed (persistence-sqlite) — durable seller credit + platform
  // margin, no JSON slice / persist contributor.
  const sellerEarningsLedger = new SellerEarningsLedger(deps.database);
  sellerEarningsLedger.importLegacy(
    deps.persistedState?.marketplace?.sellerEarnings as PersistedSellerEarnings | undefined
  );
  app.decorate("sellerEarningsLedger", sellerEarningsLedger);

  // money-correctness (#2): durable settlement log + conservation invariant +
  // full settlement reversal. SQLite-backed. Built before the earnings routes so
  // the settlement-reverse endpoint can use it.
  const settlementLedger = new SettlementLedger(
    deps.database,
    walletService,
    sellerEarningsLedger,
    app.spendLedgerService
  );
  // money-hardening-2 M4: re-credit reversed token-pack settlements to their grant.
  settlementLedger.setTokenGrantService(tokenGrantService);
  app.decorate("settlementLedger", settlementLedger);

  registerEarningsAdminRoutes(app, deps.config, sellerEarningsLedger, settlementLedger);

  // Settlement hook: charges the buyer (plan bucket or wallet) + credits the
  // seller after each billable request. Runs on the engine's settlement seam.
  app.marketplaceSeam.addSettlementHook(
    createSettlementHook({
      spendLedgerService: app.spendLedgerService,
      walletService,
      sellerService,
      marketPricingService,
      sellerEarningsLedger,
      settlementLedger,
      modelPricingService: app.modelPricingService,
      tokenGrantService,
      webhookService: app.webhookService,
      fallbackCostPer1kUsd: deps.config.fallbackCostPer1kUsd
    })
  );

  // marketplace-money-hardening H1: release any reservation still held when a
  // request finishes via an early-return path (cache hit, direct-route 404,
  // no-provider) that bypassed the settlement hook. The hook nulls these on the
  // normal path, so this only fires for leaks. Mirrors the failure-release logic.
  app.marketplaceSeam.setReservationReleaser((request) => {
    const payg = request.payg;
    if (payg) {
      const [walletRes, dayRes] = payg.id.split("|");
      if (walletRes) walletService.releaseUsd(walletRes);
      if (dayRes) app.spendLedgerService.release(dayRes);
      request.payg = undefined;
    }
    if (request.planReservation) {
      app.spendLedgerService.release(request.planReservation.id);
      request.planReservation = undefined;
    }
    if (request.tokenPack) {
      tokenGrantService.release(request.tokenPack.id);
      request.tokenPack = undefined;
    }
  });

  // ── provision-webhook (#7) ────────────────────────────────────────────────
  // Restore the business webhook config (separate from the ops Discord/Slack one).
  // provision-hardening (#5): the HMAC secret is stored ENCRYPTED at rest. On
  // load, decrypt the persisted ciphertext into the in-memory plaintext the HMAC
  // signer needs; a legacy plaintext secret (pre-#5) is tolerated and re-encrypted
  // on the next persist.
  const bizCfg = deps.persistedState?.marketplace?.businessWebhook as
    | { enabled: boolean; url: string; secret: string; events: import("../services/WebhookService.js").WebhookEvent[] }
    | undefined;
  if (bizCfg) {
    let secret = bizCfg.secret ?? "";
    if (secret && app.encryptionService.isCiphertext(secret)) {
      try { secret = app.encryptionService.decryptString(secret); }
      catch { secret = ""; /* unreadable (key changed) → treat as unset */ }
    }
    app.webhookService.updateBusinessConfig({ ...bizCfg, secret });
  }
  app.marketplaceSeam.addPersistenceContributor({
    name: "businessWebhook",
    toPersisted: () => {
      const cfg = app.webhookService.getBusinessConfig();
      // Persist the secret as ciphertext, never plaintext.
      const secret = cfg.secret ? app.encryptionService.encryptString(cfg.secret) : "";
      return { ...cfg, secret };
    }
  });

  // The /provision/* command surface (provision-key auth).
  registerProvisionRoutes(app, deps.config);

  // Admin endpoints to manage the business webhook config.
  registerBusinessWebhookAdminRoutes(app, deps.config);

  // Proactive supply health (provision-webhook #7 follow-up): periodically scan
  // account runtime state and emit supply.unhealthy on the transition into
  // unhealthy, so a dead non-house seller is caught even without live traffic.
  const supplyHealth = new SupplyHealthMonitor({
    listAccounts: () => app.providerRuntimeRegistry.listAccounts().map((a) => ({
      id: a.id,
      sellerId: (a as { sellerId?: string }).sellerId,
      status: a.status,
      runtime: { consecutiveFailures: a.runtime.consecutiveFailures }
    })),
    webhookService: app.webhookService
  });
  supplyHealth.start();
  app.addHook("onClose", () => supplyHealth.stop());

  // Background subscription renewal (marketplace-plan-subscription): catches idle
  // plan-bound keys whose period elapsed without traffic. Lazy renewal in the
  // policy check remains the source of truth for trafficked keys; both converge on
  // PlanSubscriptionService.renewIfDue, guarded by planPeriodEnd (no double-charge).
  const renewalMonitor = new PlanRenewalMonitor({
    listKeys: () => app.apiKeyService.list().map((k) => ({ id: k.id, planId: k.planId, planPeriodEnd: k.planPeriodEnd })),
    renewIfDue: (keyId) => planSubscriptionService.renewIfDue(keyId)
  });
  renewalMonitor.start();
  app.addHook("onClose", () => renewalMonitor.stop());
}
