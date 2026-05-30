/**
 * Seller admin routes — seller-supply (#4).
 *
 *   GET    /admin/v1/sellers?status=pending
 *   POST   /admin/v1/sellers                        (register)
 *   POST   /admin/v1/sellers/:id/approve|reject|suspend
 *   GET    /admin/v1/listings?baseModel=...
 *   POST   /admin/v1/listings                       (create; registers mappings)
 *   PATCH  /admin/v1/listings/:id                   (enable/disable)
 *   DELETE /admin/v1/listings/:id
 *   GET    /admin/v1/canonical-models
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppConfig } from "../../config.js";
import { createAdminAuthMiddleware } from "../../middleware/adminAuth.js";
import type { SellerService } from "../services/SellerService.js";
import { registerListingMappings, removeListingMappings } from "../policy/sellerRegistry.js";

export function registerSellerAdminRoutes(
  app: FastifyInstance,
  config: AppConfig,
  sellerService: SellerService
): void {
  const adminAuth = createAdminAuthMiddleware(config);

  app.get("/admin/v1/sellers", { preHandler: adminAuth }, async (request) => {
    const q = z.object({ status: z.enum(["pending", "approved", "suspended"]).optional() }).parse(request.query);
    return { sellers: sellerService.listSellers(q.status) };
  });

  app.post("/admin/v1/sellers", { preHandler: adminAuth }, async (request, reply) => {
    const parsed = z.object({
      displayName: z.string().min(1),
      payoutRef: z.string().optional(),
      commissionPct: z.number().min(0).max(1).optional()
    }).safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: { message: "invalid seller", code: "validation_error" } };
    }
    return { seller: sellerService.register(parsed.data) };
  });

  for (const action of ["approve", "reject", "suspend"] as const) {
    app.post(`/admin/v1/sellers/:id/${action}`, { preHandler: adminAuth }, async (request, reply) => {
      const params = z.object({ id: z.string().min(1) }).parse(request.params);
      if (action === "reject") {
        const ok = sellerService.reject(params.id);
        if (!ok) { reply.code(404); return { error: { message: "seller not found or not rejectable", code: "not_found" } }; }
        return { rejected: params.id };
      }
      const seller = action === "approve" ? sellerService.approve(params.id) : sellerService.suspend(params.id);
      if (!seller) { reply.code(404); return { error: { message: `seller ${params.id} not found`, code: "not_found" } }; }
      app.adminAuditService.record({ action: `seller.${action}`, actorKeyHash: request.adminAuth?.apiKeyHash, targetType: "seller", targetId: params.id });
      return { seller };
    });
  }

  app.get("/admin/v1/canonical-models", { preHandler: adminAuth }, async () => {
    return { models: sellerService.listCanonicalBaseModels() };
  });

  app.get("/admin/v1/listings", { preHandler: adminAuth }, async (request) => {
    const q = z.object({ baseModel: z.string().optional() }).parse(request.query);
    return { listings: sellerService.listListings(q.baseModel) };
  });

  app.post("/admin/v1/listings", { preHandler: adminAuth }, async (request, reply) => {
    const parsed = z.object({
      sellerId: z.string().min(1),
      baseModel: z.string().min(1),
      costPrice: z.object({ inputPerM: z.number().min(0), outputPerM: z.number().min(0), cachedInputPerM: z.number().min(0).optional() }),
      providerInstanceId: z.string().min(1),
      providerAccountId: z.string().min(1)
    }).safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: { message: "invalid listing", code: "validation_error" } };
    }
    let listing;
    try {
      listing = sellerService.createListing(parsed.data);
    } catch (err) {
      reply.code(400);
      return { error: { message: err instanceof Error ? err.message : "listing rejected", code: "listing_rejected" } };
    }
    registerListingMappings(app.modelRegistry, app.providerRuntimeRegistry, listing);
    app.adminAuditService.record({ action: "listing.create", actorKeyHash: request.adminAuth?.apiKeyHash, targetType: "listing", targetId: listing.id });
    return { listing };
  });

  app.patch("/admin/v1/listings/:id", { preHandler: adminAuth }, async (request, reply) => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const body = z.object({ enabled: z.boolean() }).parse(request.body);
    const listing = sellerService.setListingEnabled(params.id, body.enabled);
    if (!listing) { reply.code(404); return { error: { message: `listing ${params.id} not found`, code: "not_found" } }; }
    if (body.enabled) {
      registerListingMappings(app.modelRegistry, app.providerRuntimeRegistry, listing);
    } else {
      removeListingMappings(app.modelRegistry, listing.id);
    }
    return { listing };
  });

  app.delete("/admin/v1/listings/:id", { preHandler: adminAuth }, async (request, reply) => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const ok = sellerService.deleteListing(params.id);
    if (!ok) { reply.code(404); return { error: { message: `listing ${params.id} not found`, code: "not_found" } }; }
    removeListingMappings(app.modelRegistry, params.id);
    return { deleted: params.id };
  });
}
