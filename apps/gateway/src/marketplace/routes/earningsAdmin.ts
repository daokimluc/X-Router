/**
 * Earnings admin routes — two-sided-settlement (#6).
 *
 *   GET  /admin/v1/earnings/seller/:id           → snapshot
 *   POST /admin/v1/earnings/seller/:id/mark-paid  → reduce unpaid (body { amountUsd })
 *   GET  /admin/v1/earnings/platform              → running platform margin
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppConfig } from "../../config.js";
import { createAdminAuthMiddleware } from "../../middleware/adminAuth.js";
import type { SellerEarningsLedger } from "../services/SellerEarningsLedger.js";

export function registerEarningsAdminRoutes(
  app: FastifyInstance,
  config: AppConfig,
  ledger: SellerEarningsLedger
): void {
  const adminAuth = createAdminAuthMiddleware(config);

  app.get("/admin/v1/earnings/seller/:id", { preHandler: adminAuth }, async (request) => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    return ledger.snapshot(params.id);
  });

  app.post("/admin/v1/earnings/seller/:id/mark-paid", { preHandler: adminAuth }, async (request, reply) => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const body = z.object({ amountUsd: z.number().positive() }).safeParse(request.body);
    if (!body.success) {
      reply.code(400);
      return { error: { message: "amountUsd must be a positive number", code: "validation_error" } };
    }
    const snapshot = ledger.markPaid(params.id, body.data.amountUsd);
    app.adminAuditService.record({
      action: "earnings.mark_paid",
      actorKeyHash: request.adminAuth?.apiKeyHash,
      targetType: "seller",
      targetId: params.id
    });
    return snapshot;
  });

  app.get("/admin/v1/earnings/platform", { preHandler: adminAuth }, async () => {
    return { platformMarginUsd: ledger.getPlatformMargin() };
  });
}
