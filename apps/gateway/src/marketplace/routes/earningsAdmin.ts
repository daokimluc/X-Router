/**
 * Earnings admin routes — two-sided-settlement (#6) + marketplace-lifecycle (#3).
 *
 *   GET  /admin/v1/earnings/seller/:id            → snapshot
 *   POST /admin/v1/earnings/seller/:id/mark-paid   → reduce unpaid (body { amountUsd })
 *   POST /admin/v1/earnings/seller/:id/reverse     → clawback unpaid (body { usd, reason })
 *   POST /admin/v1/earnings/seller/:id/adjust      → signed correction (body { deltaUsd, reason })
 *   POST /admin/v1/settlements/:logId/reverse      → full settlement reversal (body { reason })
 *   GET  /admin/v1/earnings/platform               → running platform margin
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppConfig } from "../../config.js";
import { createAdminAuthMiddleware } from "../../middleware/adminAuth.js";
import type { SellerEarningsLedger } from "../services/SellerEarningsLedger.js";
import type { SettlementLedger } from "../services/SettlementLedger.js";

export function registerEarningsAdminRoutes(
  app: FastifyInstance,
  config: AppConfig,
  ledger: SellerEarningsLedger,
  settlementLedger: SettlementLedger
): void {
  const adminAuth = createAdminAuthMiddleware(config);

  app.get("/admin/v1/earnings/seller/:id", { preHandler: adminAuth }, async (request) => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    return ledger.snapshot(params.id);
  });

  app.post("/admin/v1/earnings/seller/:id/mark-paid", { preHandler: adminAuth }, async (request, reply) => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const body = z.object({ amountUsd: z.number().positive(), payoutRef: z.string().optional() }).safeParse(request.body);
    if (!body.success) {
      reply.code(400);
      return { error: { message: "amountUsd must be a positive number", code: "validation_error" } };
    }
    const snapshot = ledger.markPaid(params.id, body.data.amountUsd, body.data.payoutRef);
    app.adminAuditService.record({
      action: "earnings.mark_paid",
      actorKeyHash: request.adminAuth?.apiKeyHash,
      targetType: "seller",
      targetId: params.id
    });
    return snapshot;
  });

  // Payout reversal (marketplace-lifecycle #3) — restore unpaid after a failed
  // or erroneous payout. Audited in earnings_reversals.
  app.post("/admin/v1/earnings/seller/:id/reverse", { preHandler: adminAuth }, async (request, reply) => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const body = z.object({ usd: z.number().positive(), reason: z.string().optional() }).safeParse(request.body);
    if (!body.success) { reply.code(400); return { error: { message: "usd must be positive", code: "validation_error" } }; }
    const snapshot = ledger.reversePayout(params.id, body.data.usd, body.data.reason);
    app.adminAuditService.record({ action: "earnings.reverse_payout", actorKeyHash: request.adminAuth?.apiKeyHash, targetType: "seller", targetId: params.id });
    return snapshot;
  });

  // Signed correction (marketplace-lifecycle #3) — adjust accrued credit up/down.
  app.post("/admin/v1/earnings/seller/:id/adjust", { preHandler: adminAuth }, async (request, reply) => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const body = z.object({ deltaUsd: z.number(), reason: z.string().optional() }).safeParse(request.body);
    if (!body.success || body.data.deltaUsd === 0) { reply.code(400); return { error: { message: "deltaUsd must be non-zero", code: "validation_error" } }; }
    const snapshot = ledger.adjust(params.id, body.data.deltaUsd, body.data.reason);
    app.adminAuditService.record({ action: "earnings.adjust", actorKeyHash: request.adminAuth?.apiKeyHash, targetType: "seller", targetId: params.id });
    return snapshot;
  });

  // Full settlement reversal (marketplace-lifecycle #3) — refund the buyer +
  // unwind seller credit + margin for one recorded settlement. Idempotent.
  app.post("/admin/v1/settlements/:logId/reverse", { preHandler: adminAuth }, async (request, reply) => {
    const params = z.object({ logId: z.string().min(1) }).parse(request.params);
    const body = z.object({ reason: z.string().optional() }).safeParse(request.body);
    const reversed = settlementLedger.reverseSettlement(params.logId, body.success ? body.data.reason : undefined);
    if (!reversed) { reply.code(409); return { error: { message: "settlement not found or already reversed", code: "not_reversible" } }; }
    app.adminAuditService.record({ action: "settlement.reverse", actorKeyHash: request.adminAuth?.apiKeyHash, targetType: "settlement", targetId: params.logId });
    return { reversed: params.logId };
  });

  app.get("/admin/v1/earnings/platform", { preHandler: adminAuth }, async () => {
    return { platformMarginUsd: ledger.getPlatformMargin() };
  });

  // Books-health reconciliation (money-correctness #2 read; admin-marketplace-ui).
  // Platform solvency: Σcollected ≥ ΣsellerCredit and recorded margin matches.
  app.get("/admin/v1/marketplace/reconcile/platform", { preHandler: adminAuth }, async () => {
    return settlementLedger.reconcilePlatform();
  });

  // Per-seller: unpaid == Σcredits − Σpayouts + Σpayout_reversals − Σreversals.
  app.get("/admin/v1/marketplace/reconcile/seller/:id", { preHandler: adminAuth }, async (request) => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    return settlementLedger.reconcileSeller(params.id);
  });
}
