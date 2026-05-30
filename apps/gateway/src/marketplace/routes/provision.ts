/**
 * Provision route group — provision-webhook (#7).
 *
 * The website-facing command surface. Each endpoint validates input and
 * delegates to exactly one marketplace/engine service — no new billing logic.
 * Authenticated by the dedicated provision key (NOT admin/client keys).
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppConfig } from "../../config.js";
import { createProvisionAuthMiddleware } from "../../middleware/provisionAuth.js";
import { registerListingMappings } from "../policy/sellerRegistry.js";

export function registerProvisionRoutes(app: FastifyInstance, config: AppConfig): void {
  const provisionAuth = createProvisionAuthMiddleware(config);
  const opts = { preHandler: provisionAuth };

  function audit(action: string, request: { provisionAuth?: { apiKeyHash: string } }, targetId: string, targetType: string) {
    app.adminAuditService.record({ action, actorKeyHash: request.provisionAuth?.apiKeyHash, targetType, targetId });
  }

  // ── Seller lifecycle ──────────────────────────────────────────────────────
  app.post("/provision/seller", opts, async (request, reply) => {
    const p = z.object({ displayName: z.string().min(1), payoutRef: z.string().optional(), commissionPct: z.number().min(0).max(1).optional() }).safeParse(request.body);
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
  app.post("/provision/grant", opts, async (request, reply) => {
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
  app.post("/provision/wallet/topup", opts, async (request, reply) => {
    const p = z.object({ keyId: z.string().min(1), usd: z.number().positive() }).safeParse(request.body);
    if (!p.success) { reply.code(400); return { error: { message: "invalid topup", code: "validation_error" } }; }
    const walletUsd = app.walletService.topupUsd(p.data.keyId, p.data.usd);
    app.apiKeyService.setWalletMicroUsd(p.data.keyId, Math.round(walletUsd * 1_000_000));
    audit("provision.wallet.topup", request, p.data.keyId, "api_key");
    return { keyId: p.data.keyId, walletUsd };
  });

  // ── Key creation ──────────────────────────────────────────────────────────
  app.post("/provision/key", opts, async (request, reply) => {
    const p = z.object({ label: z.string().optional(), planId: z.string().optional() }).safeParse(request.body);
    if (!p.success) { reply.code(400); return { error: { message: "invalid key request", code: "validation_error" } }; }
    if (p.data.planId && !app.planService.get(p.data.planId)) { reply.code(400); return { error: { message: `plan ${p.data.planId} not found`, code: "validation_error" } }; }
    const created = app.apiKeyService.create({ owner: p.data.label, planId: p.data.planId });
    audit("provision.key.create", request, created.id, "api_key");
    // Plaintext key returned ONCE.
    return { id: created.id, key: created.key, planId: created.planId ?? null };
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
  app.post("/provision/earnings/:sellerId/mark-paid", opts, async (request, reply) => {
    const { sellerId } = z.object({ sellerId: z.string().min(1) }).parse(request.params);
    const p = z.object({ usd: z.number().positive(), payoutRef: z.string().optional() }).safeParse(request.body);
    if (!p.success) { reply.code(400); return { error: { message: "usd must be positive", code: "validation_error" } }; }
    const snapshot = app.sellerEarningsLedger.markPaid(sellerId, p.data.usd);
    audit("provision.earnings.mark_paid", request, sellerId, "seller");
    return snapshot;
  });
}
