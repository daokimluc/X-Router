/**
 * Provision route group — provision-webhook (#7).
 *
 * The website-facing command surface. Each endpoint validates input and
 * delegates to exactly one marketplace/engine service — no new billing logic.
 * Authenticated by the dedicated provision key (NOT admin/client keys).
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AppConfig } from "../../config.js";
import { createProvisionAuthMiddleware } from "../../middleware/provisionAuth.js";
import { RateLimitService } from "../../services/RateLimitService.js";
import { registerListingMappings } from "../policy/sellerRegistry.js";
import { expandModelGroups, modelsForPlanGroups } from "../utils/modelGroup.js";

/**
 * group -> member models from the canonical base-model list, classified by the
 * shared modelGroupOf (so it never drifts from enforcement). When `activeOnly`,
 * keep only canonical models that have at least one ENABLED listing. The `free`
 * group is always seeded from the curated FREE_MODELS set (not derivable from
 * canonical), so a Free plan never shows zero models.
 */
function canonicalGroupMembers(app: FastifyInstance, activeOnly: boolean): Record<string, string[]> {
  let models = app.sellerService.listCanonicalBaseModels();
  if (activeOnly) {
    models = models.filter((m) => app.sellerService.listingCostFor(m).length > 0);
  }
  return expandModelGroups(models);
}

export function registerProvisionRoutes(app: FastifyInstance, config: AppConfig): void {
  const provisionAuth = createProvisionAuthMiddleware(config);
  const opts = { preHandler: provisionAuth };

  // provision-hardening (#5): per-provision-key rate limit on the highest-
  // privilege mutating routes (create-key, wallet/topup, grant, mark-paid). 0
  // disables it (trusted single-tenant). Runs AFTER provisionAuth so it keys off
  // the authenticated provision key hash.
  const rpm = config.provisionRateLimitPerMinute;
  const limiter = rpm > 0 ? new RateLimitService({ requestsPerMinute: rpm, dailyRequestQuota: 0, dailyTokenQuota: 0 }) : null;
  async function rateLimit(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (!limiter) return;
    const hash = request.provisionAuth?.apiKeyHash ?? "anon";
    const decision = limiter.checkAndConsume(hash);
    if (!decision.allowed) {
      reply.code(429).header("retry-after", "60");
      await reply.send({ error: { type: "rate_limit_error", message: "Provision rate limit exceeded", code: "provision_rate_limit_exceeded" } });
    }
  }
  // Privileged routes get both auth + the limiter (auth first so the limiter
  // keys off the verified hash).
  const privOpts = { preHandler: [provisionAuth, rateLimit] };

  function audit(action: string, request: { provisionAuth?: { apiKeyHash: string } }, targetId: string, targetType: string) {
    app.adminAuditService.record({ action, actorKeyHash: request.provisionAuth?.apiKeyHash, targetType, targetId });
  }

  // ── Seller lifecycle ──────────────────────────────────────────────────────
  app.post("/provision/seller", opts, async (request, reply) => {
    const p = z.object({ displayName: z.string().min(1), payoutRef: z.string().optional(), commissionPct: z.number().min(0).max(1).optional(), externalRef: z.string().optional() }).safeParse(request.body);
    if (!p.success) { reply.code(400); return { error: { message: "invalid seller", code: "validation_error" } }; }
    const seller = app.sellerService.register(p.data);
    audit("provision.seller.register", request, seller.id, "seller");
    return { seller };
  });

  for (const action of ["approve", "suspend"] as const) {
    app.post(`/provision/seller/:id/${action}`, opts, async (request, reply) => {
      const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
      const seller = action === "approve" ? app.sellerService.approve(id) : app.sellerService.suspend(id);
      if (!seller) { reply.code(404); return { error: { message: `seller ${id} not found`, code: "not_found" } }; }
      audit(`provision.seller.${action}`, request, id, "seller");
      return { seller };
    });
  }

  // ── Listing lifecycle ─────────────────────────────────────────────────────
  app.post("/provision/listing", opts, async (request, reply) => {
    const p = z.object({
      sellerId: z.string().min(1),
      baseModel: z.string().min(1),
      costPrice: z.object({ inputPerM: z.number().min(0), outputPerM: z.number().min(0), cachedInputPerM: z.number().min(0).optional() }),
      providerInstanceId: z.string().min(1),
      providerAccountId: z.string().min(1)
    }).safeParse(request.body);
    if (!p.success) { reply.code(400); return { error: { message: "invalid listing", code: "validation_error" } }; }
    let listing;
    try { listing = app.sellerService.createListing(p.data); }
    catch (err) { reply.code(400); return { error: { message: err instanceof Error ? err.message : "rejected", code: "listing_rejected" } }; }
    registerListingMappings(app.modelRegistry, app.providerRuntimeRegistry, listing);
    audit("provision.listing.create", request, listing.id, "listing");
    return { listing };
  });

  app.patch("/provision/listing/:id", opts, async (request, reply) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const body = z.object({ enabled: z.boolean() }).parse(request.body);
    const listing = app.sellerService.setListingEnabled(id, body.enabled);
    if (!listing) { reply.code(404); return { error: { message: `listing ${id} not found`, code: "not_found" } }; }
    if (body.enabled) registerListingMappings(app.modelRegistry, app.providerRuntimeRegistry, listing);
    return { listing };
  });

  app.delete("/provision/listing/:id", opts, async (request, reply) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const ok = app.sellerService.deleteListing(id);
    if (!ok) { reply.code(404); return { error: { message: `listing ${id} not found`, code: "not_found" } }; }
    return { deleted: id };
  });

  // ── Plan grant / subscribe (marketplace-plan-subscription) ────────────────
  // A paid plan is a monthly subscription: binding it charges the wallet and sets
  // the renewal period. `planId: null` cancels (unbind, stop renewal, no refund).
  app.post("/provision/grant", privOpts, async (request, reply) => {
    const p = z.object({
      keyId: z.string().min(1),
      planId: z.string().min(1).nullable(),
      overageEnabled: z.boolean().optional(),
      paygDailyLimitUsd: z.number().min(0).optional()
    }).safeParse(request.body);
    if (!p.success) { reply.code(400); return { error: { message: "invalid grant", code: "validation_error" } }; }
    if (p.data.planId !== null && !app.planService.get(p.data.planId)) { reply.code(400); return { error: { message: `plan ${p.data.planId} not found`, code: "validation_error" } }; }

    const existing = app.apiKeyService.findById(p.data.keyId);
    if (!existing) { reply.code(404); return { error: { message: `key ${p.data.keyId} not found`, code: "not_found" } }; }

    // Apply the (non-money) overage / PAYG-limit prefs first, independent of the
    // subscription charge so a re-grant can still tweak them.
    if (p.data.overageEnabled !== undefined || p.data.paygDailyLimitUsd !== undefined) {
      app.apiKeyService.update(p.data.keyId, {
        overageEnabled: p.data.overageEnabled === undefined ? undefined : p.data.overageEnabled,
        paygDailyLimitUsd: p.data.paygDailyLimitUsd === undefined ? undefined : p.data.paygDailyLimitUsd
      });
    }

    // Cancel: unbind plan, stop renewal, no refund.
    if (p.data.planId === null) {
      app.planSubscriptionService.cancel(p.data.keyId);
      audit("provision.grant", request, p.data.keyId, "api_key");
      const after = app.apiKeyService.findById(p.data.keyId);
      return { id: p.data.keyId, planId: null, planPeriodEnd: null, planChargedAt: null, walletUsd: app.walletService.getUsd(p.data.keyId), overageEnabled: after?.overageEnabled ?? null, paygDailyLimitUsd: after?.paygDailyLimitUsd ?? null };
    }

    const plan = app.planService.get(p.data.planId)!;
    const result = app.planSubscriptionService.subscribe(p.data.keyId, plan);
    if (!result.ok) {
      reply.code(402);
      return { error: { message: `wallet underfunded: plan costs $${result.priceUsd}, balance $${result.walletUsd}`, code: "insufficient_funds" } };
    }
    app.apiKeyService.setWalletMicroUsd(p.data.keyId, Math.round(result.walletUsd * 1_000_000));
    audit("provision.grant", request, p.data.keyId, "api_key");
    const after = app.apiKeyService.findById(p.data.keyId);
    return {
      id: p.data.keyId,
      planId: result.planId,
      planPeriodEnd: result.planPeriodEnd ?? null,
      planChargedAt: result.planChargedAt ?? null,
      walletUsd: result.walletUsd,
      overageEnabled: after?.overageEnabled ?? null,
      paygDailyLimitUsd: after?.paygDailyLimitUsd ?? null,
      ...(result.idempotent ? { idempotent: true } : {})
    };
  });

  // ── Token packs (marketplace-token-packs) ─────────────────────────────────
  // Prepaid per-(key, baseModel) token balances. Foza calls this AFTER collecting
  // payment; x-router only issues the grant + stores pricePaidUsd for audit (it
  // never charges the buyer's wallet for a pack). Idempotent on idempotencyKey.
  app.post("/provision/token-pack", privOpts, async (request, reply) => {
    const p = z.object({
      keyId: z.string().min(1),
      baseModel: z.string().min(1),
      tokens: z.number().int().positive(),
      pricePaidUsd: z.number().min(0),
      expiresAt: z.number().int().positive(),
      idempotencyKey: z.string().min(1)
    }).safeParse(request.body);
    if (!p.success) { reply.code(400); return { error: { message: "invalid token-pack grant", code: "validation_error" } }; }
    if (p.data.expiresAt <= Date.now()) { reply.code(400); return { error: { message: "expiresAt must be in the future", code: "validation_error" } }; }
    if (p.data.tokens > config.maxPackTokens) { reply.code(400); return { error: { message: `tokens exceeds the maximum of ${config.maxPackTokens}`, code: "amount_too_large" } }; }
    if (p.data.expiresAt > Date.now() + config.maxPackHorizonMs) { reply.code(400); return { error: { message: "expiresAt is beyond the maximum horizon", code: "validation_error" } }; }
    if (!app.apiKeyService.findById(p.data.keyId)) { reply.code(404); return { error: { message: `key ${p.data.keyId} not found`, code: "not_found" } }; }
    const grant = app.tokenGrantService.grant(p.data);
    audit("provision.token_pack.grant", request, p.data.keyId, "api_key");
    return { grant };
  });

  app.get("/provision/token-packs", opts, async (request) => {
    const q = z.object({ keyId: z.string().min(1) }).parse(request.query);
    return { keyId: q.keyId, tokenPacks: app.tokenGrantService.listForKey(q.keyId) };
  });

  // ── Wallet top-up ─────────────────────────────────────────────────────────
  app.post("/provision/wallet/topup", privOpts, async (request, reply) => {
    const p = z.object({ keyId: z.string().min(1), usd: z.number().positive().optional(), amountUsd: z.number().positive().optional() }).safeParse(request.body);
    if (!p.success || (p.data.usd === undefined && p.data.amountUsd === undefined)) { reply.code(400); return { error: { message: "usd must be positive", code: "validation_error" } }; }
    const amount = (p.data.usd ?? p.data.amountUsd) as number;
    if (amount > config.maxTopupUsd) { reply.code(400); return { error: { message: `amount exceeds the maximum of $${config.maxTopupUsd}`, code: "amount_too_large" } }; }
    const walletUsd = app.walletService.topupUsd(p.data.keyId, amount);
    app.apiKeyService.setWalletMicroUsd(p.data.keyId, Math.round(walletUsd * 1_000_000));
    audit("provision.wallet.topup", request, p.data.keyId, "api_key");
    return { keyId: p.data.keyId, walletUsd };
  });

  // ── Key creation ──────────────────────────────────────────────────────────
  app.post("/provision/key", privOpts, async (request, reply) => {
    const p = z.object({ label: z.string().optional(), planId: z.string().optional() }).safeParse(request.body);
    if (!p.success) { reply.code(400); return { error: { message: "invalid key request", code: "validation_error" } }; }
    if (p.data.planId && !app.planService.get(p.data.planId)) { reply.code(400); return { error: { message: `plan ${p.data.planId} not found`, code: "validation_error" } }; }
    const created = app.apiKeyService.create({ owner: p.data.label, planId: p.data.planId });
    audit("provision.key.create", request, created.id, "api_key");
    // Plaintext key returned ONCE.
    return { id: created.id, key: created.key, planId: created.planId ?? null };
  });

  // ── Key lifecycle (marketplace-lifecycle #3) ──────────────────────────────
  // Buyer-self-service wind-down: the website automates these per buyer action.
  for (const action of ["disable", "enable"] as const) {
    app.post(`/provision/key/:id/${action}`, opts, async (request, reply) => {
      const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
      try {
        const record = app.apiKeyService.setEnabled(id, action === "enable");
        audit(`provision.key.${action}`, request, id, "api_key");
        return { id, enabled: record.enabled };
      } catch {
        reply.code(404);
        return { error: { message: `key ${id} not found`, code: "not_found" } };
      }
    });
  }

  app.patch("/provision/key/:id", opts, async (request, reply) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const p = z.object({
      enabled: z.boolean().optional(),
      // ISO timestamp; null clears the expiry.
      expiresAt: z.string().datetime().nullable().optional()
    }).safeParse(request.body);
    if (!p.success || (p.data.enabled === undefined && p.data.expiresAt === undefined)) {
      reply.code(400); return { error: { message: "provide enabled and/or expiresAt", code: "validation_error" } };
    }
    const updated = app.apiKeyService.update(id, {
      enabled: p.data.enabled,
      expiresAt: p.data.expiresAt === undefined ? undefined : (p.data.expiresAt === null ? null : new Date(p.data.expiresAt))
    });
    if (!updated) { reply.code(404); return { error: { message: `key ${id} not found`, code: "not_found" } }; }
    audit("provision.key.update", request, id, "api_key");
    return { id, enabled: updated.enabled, expiresAt: updated.expiresAt ?? null };
  });

  app.delete("/provision/key/:id", opts, async (request, reply) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    // Revoke = soft (disable), retaining the key for settlement-log reference.
    try {
      app.apiKeyService.setEnabled(id, false);
      audit("provision.key.revoke", request, id, "api_key");
      return { id, revoked: true };
    } catch {
      reply.code(404);
      return { error: { message: `key ${id} not found`, code: "not_found" } };
    }
  });

  // Rotate the client secret in place (keeps id/plan/wallet). New plaintext
  // returned ONCE; the old secret stops working immediately.
  app.post("/provision/key/:id/rotate", privOpts, async (request, reply) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const rotated = app.apiKeyService.rotate(id);
    if (!rotated) { reply.code(404); return { error: { message: `key ${id} not found`, code: "not_found" } }; }
    audit("provision.key.rotate", request, id, "api_key");
    return { id: rotated.id, key: rotated.key, planId: rotated.planId ?? null };
  });

  app.get("/provision/keys", opts, async (request) => {
    const q = z.object({ owner: z.string().optional() }).parse(request.query);
    const keys = app.apiKeyService
      .list()
      .filter((k) => !q.owner || k.owner === q.owner)
      .map((k) => ({
        id: k.id,
        owner: k.owner ?? null,
        enabled: k.enabled,
        expiresAt: k.expiresAt ?? null,
        planId: k.planId ?? null,
        // walletUsd inline to avoid an N+1 GET /provision/wallet/:id per key.
        // provisioned:false → walletUsd:0 (never opened a wallet).
        walletUsd: app.walletService.getUsd(k.id),
        provisioned: app.walletService.isProvisioned(k.id),
        planPeriodEnd: k.planPeriodEnd ?? null,
        planChargedAt: k.planChargedAt ?? null,
        tokenPacks: app.tokenGrantService.listForKey(k.id).map((g) => ({
          baseModel: g.baseModel,
          tokensRemaining: g.tokensRemaining,
          expiresAt: g.expiresAt
        }))
      }));
    return { keys };
  });

  // ── Markup ────────────────────────────────────────────────────────────────
  app.put("/provision/markup", opts, async (request, reply) => {
    const p = z.object({ defaultMarkup: z.number().min(0).optional(), perModel: z.record(z.number().min(0)).optional() }).safeParse(request.body);
    if (!p.success) { reply.code(400); return { error: { message: "markup must be >= 0", code: "validation_error" } }; }
    if (p.data.defaultMarkup !== undefined) app.marketPricingService.setDefaultMarkup(p.data.defaultMarkup);
    if (p.data.perModel) for (const [m, v] of Object.entries(p.data.perModel)) app.marketPricingService.setModelMarkup(m, v);
    audit("provision.markup.update", request, "*", "markup");
    return app.marketPricingService.listMarkups();
  });

  // ── Earnings mark-paid ────────────────────────────────────────────────────
  app.post("/provision/earnings/:sellerId/mark-paid", privOpts, async (request, reply) => {
    const { sellerId } = z.object({ sellerId: z.string().min(1) }).parse(request.params);
    const p = z.object({ usd: z.number().positive().optional(), amountUsd: z.number().positive().optional(), payoutRef: z.string().optional() }).safeParse(request.body);
    if (!p.success || (p.data.usd === undefined && p.data.amountUsd === undefined)) { reply.code(400); return { error: { message: "usd must be positive", code: "validation_error" } }; }
    const amount = (p.data.usd ?? p.data.amountUsd) as number;
    // marketplace-money-hardening H2: never pay out more than is owed.
    const unpaid = app.sellerEarningsLedger.snapshot(sellerId).unpaid;
    if (amount > unpaid + 1e-9) { reply.code(400); return { error: { message: `amount $${amount} exceeds unpaid $${unpaid}`, code: "amount_exceeds_unpaid" } }; }
    // provision-hardening (#5): persist payoutRef on the payout record (was dropped).
    const snapshot = app.sellerEarningsLedger.markPaid(sellerId, amount, p.data.payoutRef);
    audit("provision.earnings.mark_paid", request, sellerId, "seller");
    return snapshot;
  });

  // ── Reads (provision-read-api) ────────────────────────────────────────────
  // Thin wrappers so the website renders state on the provision key alone,
  // without holding an admin key. No new logic — same data as the /admin reads.

  app.get("/provision/wallet/:keyId", opts, async (request) => {
    const { keyId } = z.object({ keyId: z.string().min(1) }).parse(request.params);
    const key = app.apiKeyService.findById(keyId);
    return {
      keyId,
      walletUsd: app.walletService.getUsd(keyId),
      provisioned: app.walletService.isProvisioned(keyId),
      planId: key?.planId ?? null,
      planPeriodEnd: key?.planPeriodEnd ?? null,
      planChargedAt: key?.planChargedAt ?? null
    };
  });

  app.get("/provision/earnings/platform", opts, async () => {
    return { platformMarginUsd: app.sellerEarningsLedger.getPlatformMargin() };
  });

  app.get("/provision/earnings/:sellerId", opts, async (request) => {
    const { sellerId } = z.object({ sellerId: z.string().min(1) }).parse(request.params);
    return app.sellerEarningsLedger.snapshot(sellerId);
  });

  app.get("/provision/plans", opts, async () => {
    // marketplace-plan-groups — embed the expanded model list per plan so the
    // website's plan card shows concrete models, not raw group labels. `["*"]`
    // stays as ["*"] (caller renders "all models"). Group source = canonical
    // base models classified by modelGroupOf (the same fn enforcement uses).
    const members = canonicalGroupMembers(app, false);
    const plans = app.planService.list().map((p) => ({
      ...p,
      models: modelsForPlanGroups(p.modelGroups, members)
    }));
    return { plans };
  });

  // marketplace-plan-groups — group -> member models, for the website to render
  // plan chips. Provision-scope (display data, NOT admin). `?activeOnly=true`
  // keeps only canonical models that have at least one ENABLED listing.
  app.get("/provision/model-groups", opts, async (request) => {
    const q = z.object({ activeOnly: z.coerce.boolean().optional() }).parse(request.query ?? {});
    return { groups: canonicalGroupMembers(app, q.activeOnly === true) };
  });

  app.get("/provision/sellers", opts, async (request) => {
    const q = z.object({ status: z.enum(["pending", "approved", "suspended"]).optional(), externalRef: z.string().optional() }).parse(request.query);
    return { sellers: app.sellerService.listSellers(q) };
  });

  app.get("/provision/listings", opts, async (request) => {
    const q = z.object({ baseModel: z.string().optional() }).parse(request.query);
    return { listings: app.sellerService.listListings(q.baseModel) };
  });

  // provision-listing-metrics — per-listing display metrics for the marketplace
  // card, joined from THREE sources keyed by the listing's providerAccountId +
  // (sellerId, baseModel). Provision-scope read; no admin key, no money change.
  // Every metric is null when its source is empty — never a fabricated value.
  // Freshness/grain differ per metric, so the response carries a `meta` contract:
  //   requests/tokens = settlement window (since); success = lifetime per account;
  //   latency/rps = rolling LatencyTracker window.
  app.get("/provision/listings/metrics", opts, async (request) => {
    const q = z.object({
      baseModel: z.string().optional(),
      since: z.string().datetime().optional()
    }).parse(request.query);
    const since = q.since ? new Date(q.since) : undefined;

    // 1. Requests + tokens: one GROUP BY over settlement_log, keyed (seller,model).
    const agg = app.settlementLedger.aggregateByModel({ since });
    const aggKey = (sellerId: string, baseModel: string) => `${sellerId} ${baseModel}`;
    const aggByKey = new Map<string, { requests: number; promptTokens: number; completionTokens: number }>();
    for (const a of agg) {
      aggByKey.set(aggKey(a.sellerId ?? "", a.baseModel ?? ""), {
        requests: a.requests,
        promptTokens: a.promptTokens,
        completionTokens: a.completionTokens
      });
    }

    // 2. Latency/rps: snapshot tuples keyed (providerInstanceId, publicModel,
    // accountId). Group by accountId — an account can serve multiple publicModels.
    const snap = app.latencyTracker.snapshot();
    const windowSeconds = snap.windowSeconds || 300;
    const latByAccount = new Map<string, { okCount: number; busiest?: { count: number; p50: number | null; p95: number | null } }>();
    for (const t of snap.tuples) {
      const entry = latByAccount.get(t.accountId) ?? { okCount: 0 };
      entry.okCount += t.ok.count;
      // p50/p95: pick the busiest (ok) tuple for the account, so a high-traffic
      // model's percentiles aren't diluted by a rarely-used one on the same key.
      if (!entry.busiest || t.ok.count > entry.busiest.count) {
        entry.busiest = { count: t.ok.count, p50: t.ok.p50, p95: t.ok.p95 };
      }
      latByAccount.set(t.accountId, entry);
    }

    const listings = app.sellerService.listListings(q.baseModel);
    const metrics = listings
      .filter((l) => l.enabled)
      .map((l) => {
        const counts = aggByKey.get(aggKey(l.sellerId, l.baseModel));
        const account = app.providerRuntimeRegistry.getAccount(l.providerAccountId);
        const rt = account?.runtime;
        const lat = latByAccount.get(l.providerAccountId);

        // Lifetime success rate per account (clearly labeled lifetime, not windowed).
        // null when the account is gone or has never served a request.
        const successRate =
          rt && rt.totalRequests > 0
            ? Math.round((1 - rt.failedRequests / rt.totalRequests) * 10000) / 10000
            : null;

        return {
          listingId: l.id,
          sellerId: l.sellerId,
          baseModel: l.baseModel,
          providerInstanceId: l.providerInstanceId,
          providerAccountId: l.providerAccountId,
          // settlement window (since):
          requests: counts?.requests ?? 0,
          promptTokens: counts?.promptTokens ?? 0,
          completionTokens: counts?.completionTokens ?? 0,
          totalTokens: counts ? counts.promptTokens + counts.completionTokens : 0,
          // lifetime, per account:
          successRate,
          totalRequestsLifetime: rt?.totalRequests ?? null,
          failedRequestsLifetime: rt?.failedRequests ?? null,
          // rolling latency window:
          latencyP50Ms: lat?.busiest?.p50 ?? null,
          latencyP95Ms: lat?.busiest?.p95 ?? null,
          rps: lat ? Math.round((lat.okCount / windowSeconds) * 1000) / 1000 : null
        };
      });

    return {
      meta: {
        settlementWindowSince: since ? since.toISOString() : null,
        successHorizon: "lifetime" as const,
        latencyWindowSeconds: windowSeconds
      },
      metrics
    };
  });

  app.get("/provision/markup", opts, async () => {
    return app.marketPricingService.listMarkups();
  });

  // Usage reconciliation: pull settled records since a timestamp / for one key,
  // so the website can rebuild its ledger after missed webhooks. Reconciliation-
  // grade (tokens/model/cost/timestamps), NOT a settlement-payload replay.
  app.get("/provision/usage", opts, async (request) => {
    const q = z.object({
      since: z.string().datetime().optional(),
      keyId: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(1000).optional()
    }).parse(request.query);
    const apiKeyHash = q.keyId ? app.apiKeyService.findById(q.keyId)?.keyHash : undefined;
    // keyId given but unknown → no records (avoid leaking all-key usage).
    if (q.keyId && !apiKeyHash) return { data: [], total: 0 };
    // Read the DURABLE usage log (SQLite) so reconciliation survives the live
    // UsageService ring-buffer cap + restarts (provision-hardening follow-up).
    return app.usageLogStore.query({
      ...(apiKeyHash ? { apiKeyHash } : {}),
      ...(q.since ? { since: new Date(q.since) } : {}),
      limit: q.limit ?? 100
    });
  });

  // Per-record SETTLEMENT replay (exact money). Unlike /provision/usage (tokens
  // only), each row carries collected / sellerCredit / platformMargin / billTrack
  // / settlementId / reversed — so the website can rebuild exact buyer bills +
  // seller credit for any window it missed via webhook. Filter by buyer key
  // (scoped by keyId) and/or sellerId and/or since.
  app.get("/provision/settlements", opts, async (request) => {
    const q = z.object({
      since: z.string().datetime().optional(),
      keyId: z.string().optional(),
      sellerId: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(1000).optional()
    }).parse(request.query);
    // keyId given but unknown → no records (don't leak other keys' settlements).
    if (q.keyId && !app.apiKeyService.findById(q.keyId)) return { data: [], total: 0 };
    return app.settlementLedger.query({
      ...(q.keyId ? { buyerKeyId: q.keyId } : {}),
      ...(q.sellerId ? { sellerId: q.sellerId } : {}),
      ...(q.since ? { since: new Date(q.since) } : {}),
      limit: q.limit ?? 100
    });
  });

  // ── Self-service business webhook config (provision-read-api) ─────────────
  const BUSINESS_EVENTS = ["usage.recorded", "grant.exhausted", "wallet.low", "quota.blocked", "supply.unhealthy", "plan.renewed", "plan.downgraded"] as const;

  app.get("/provision/webhook", opts, async () => {
    const cfg = app.webhookService.getBusinessConfig();
    return { enabled: cfg.enabled, url: cfg.url, events: cfg.events, secretSet: cfg.secret.length > 0, secret: cfg.secret ? "••••••••" : "" };
  });

  app.put("/provision/webhook", opts, async (request, reply) => {
    const p = z.object({
      enabled: z.boolean().optional(),
      url: z.string().url().or(z.literal("")).optional(),
      secret: z.string().optional(),
      events: z.array(z.enum(BUSINESS_EVENTS)).optional()
    }).safeParse(request.body);
    if (!p.success) { reply.code(400); return { error: { message: "invalid webhook config", code: "validation_error" } }; }
    const updated = app.webhookService.updateBusinessConfig(p.data);
    audit("provision.webhook.update", request, "business", "webhook");
    return { enabled: updated.enabled, url: updated.url, events: updated.events, secretSet: updated.secret.length > 0 };
  });
}
