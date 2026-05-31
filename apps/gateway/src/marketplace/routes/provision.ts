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

  // ── Plan grant (idempotent) ───────────────────────────────────────────────
  app.post("/provision/grant", privOpts, async (request, reply) => {
    const p = z.object({
      keyId: z.string().min(1),
      planId: z.string().min(1),
      overageEnabled: z.boolean().optional(),
      paygDailyLimitUsd: z.number().min(0).optional()
    }).safeParse(request.body);
    if (!p.success) { reply.code(400); return { error: { message: "invalid grant", code: "validation_error" } }; }
    if (!app.planService.get(p.data.planId)) { reply.code(400); return { error: { message: `plan ${p.data.planId} not found`, code: "validation_error" } }; }

    const existing = app.apiKeyService.findById(p.data.keyId);
    if (!existing) { reply.code(404); return { error: { message: `key ${p.data.keyId} not found`, code: "not_found" } }; }
    // Idempotent: same plan already bound with no other changes → return as-is.
    if (existing.planId === p.data.planId && p.data.overageEnabled === undefined && p.data.paygDailyLimitUsd === undefined) {
      return { id: p.data.keyId, planId: existing.planId, overageEnabled: existing.overageEnabled ?? null, paygDailyLimitUsd: existing.paygDailyLimitUsd ?? null, idempotent: true };
    }
    const updated = app.apiKeyService.update(p.data.keyId, {
      planId: p.data.planId,
      overageEnabled: p.data.overageEnabled === undefined ? undefined : p.data.overageEnabled,
      paygDailyLimitUsd: p.data.paygDailyLimitUsd === undefined ? undefined : p.data.paygDailyLimitUsd
    });
    audit("provision.grant", request, p.data.keyId, "api_key");
    return { id: p.data.keyId, planId: updated?.planId ?? null, overageEnabled: updated?.overageEnabled ?? null, paygDailyLimitUsd: updated?.paygDailyLimitUsd ?? null };
  });

  // ── Wallet top-up ─────────────────────────────────────────────────────────
  app.post("/provision/wallet/topup", privOpts, async (request, reply) => {
    const p = z.object({ keyId: z.string().min(1), usd: z.number().positive().optional(), amountUsd: z.number().positive().optional() }).safeParse(request.body);
    if (!p.success || (p.data.usd === undefined && p.data.amountUsd === undefined)) { reply.code(400); return { error: { message: "usd must be positive", code: "validation_error" } }; }
    const amount = (p.data.usd ?? p.data.amountUsd) as number;
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
        provisioned: app.walletService.isProvisioned(k.id)
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
    return {
      keyId,
      walletUsd: app.walletService.getUsd(keyId),
      provisioned: app.walletService.isProvisioned(keyId)
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
    return { plans: app.planService.list() };
  });

  app.get("/provision/sellers", opts, async (request) => {
    const q = z.object({ status: z.enum(["pending", "approved", "suspended"]).optional(), externalRef: z.string().optional() }).parse(request.query);
    return { sellers: app.sellerService.listSellers(q) };
  });

  app.get("/provision/listings", opts, async (request) => {
    const q = z.object({ baseModel: z.string().optional() }).parse(request.query);
    return { listings: app.sellerService.listListings(q.baseModel) };
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
  const BUSINESS_EVENTS = ["usage.recorded", "grant.exhausted", "wallet.low", "quota.blocked", "supply.unhealthy"] as const;

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
