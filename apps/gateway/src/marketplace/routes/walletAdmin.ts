/**
 * Wallet admin routes (usd-wallet #1, marketplace layer).
 *
 * Replaces the engine's old token-based balance/top-up endpoints with USD
 * versions. Registered only when the marketplace is enabled.
 *
 *   GET  /admin/v1/api-keys/:id/wallet         → { id, walletUsd, provisioned }
 *   POST /admin/v1/api-keys/:id/topup          → { id, walletUsd, addedUsd }   (body: { amountUsd })
 *   POST /admin/v1/api-keys/:id/wallet/refund  → { id, walletUsd, refundedUsd } (body: { usd, reason })
 *   POST /admin/v1/api-keys/:id/wallet/debit   → { id, walletUsd, debitedUsd, ok } (body: { usd, reason })
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppConfig } from "../../config.js";
import { createAdminAuthMiddleware } from "../../middleware/adminAuth.js";
import type { WalletService } from "../services/WalletService.js";

export function registerWalletAdminRoutes(
  app: FastifyInstance,
  config: AppConfig,
  walletService: WalletService
): void {
  const adminAuth = createAdminAuthMiddleware(config);

  app.get(
    "/admin/v1/api-keys/:id/wallet",
    { preHandler: adminAuth },
    async (request) => {
      const params = z.object({ id: z.string().min(1) }).parse(request.params);
      return {
        id: params.id,
        walletUsd: walletService.getUsd(params.id),
        provisioned: walletService.isProvisioned(params.id)
      };
    }
  );

  app.post(
    "/admin/v1/api-keys/:id/topup",
    { preHandler: adminAuth },
    async (request, reply) => {
      const params = z.object({ id: z.string().min(1) }).parse(request.params);
      const body = request.body as { amountUsd?: number; idempotencyKey?: string };

      if (typeof body.amountUsd !== "number" || body.amountUsd <= 0) {
        reply.code(400);
        return {
          error: { message: "amountUsd must be a positive number", code: "validation_error" }
        };
      }
      if (body.amountUsd > config.maxTopupUsd) {
        reply.code(400);
        return { error: { message: `amountUsd exceeds the maximum of $${config.maxTopupUsd}`, code: "amount_too_large" } };
      }

      const record = app.apiKeyService.findById(params.id);
      if (!record) {
        reply.code(404);
        return {
          error: { message: `API key "${params.id}" not found`, code: "not_found" }
        };
      }

      // Idempotent when a key is given (retry-safe); else the legacy additive top-up.
      if (body.idempotencyKey) {
        const r = walletService.topupUsdIdempotent(params.id, body.amountUsd, body.idempotencyKey);
        app.apiKeyService.setWalletMicroUsd(params.id, Math.round(r.walletUsd * 1_000_000));
        app.adminAuditService.record({ action: "api_key.topup", actorKeyHash: request.adminAuth?.apiKeyHash, targetType: "api_key", targetId: params.id });
        return { id: params.id, walletUsd: r.walletUsd, addedUsd: r.idempotent ? 0 : body.amountUsd, ...(r.idempotent ? { idempotent: true } : {}) };
      }

      const walletUsd = walletService.topupUsd(params.id, body.amountUsd);
      // Keep the persisted key snapshot coherent with the live wallet.
      app.apiKeyService.setWalletMicroUsd(params.id, Math.round(walletUsd * 1_000_000));

      app.adminAuditService.record({
        action: "api_key.topup",
        actorKeyHash: request.adminAuth?.apiKeyHash,
        targetType: "api_key",
        targetId: params.id
      });

      return { id: params.id, walletUsd, addedUsd: body.amountUsd };
    }
  );

  // Refund / credit-back (marketplace-lifecycle #3) — invokes the audited
  // money-correctness primitive. Distinct from topup (buyer paying in).
  app.post(
    "/admin/v1/api-keys/:id/wallet/refund",
    { preHandler: adminAuth },
    async (request, reply) => {
      const params = z.object({ id: z.string().min(1) }).parse(request.params);
      const body = z.object({ usd: z.number().positive(), reason: z.string().optional(), idempotencyKey: z.string().optional() }).safeParse(request.body);
      if (!body.success) { reply.code(400); return { error: { message: "usd must be positive", code: "validation_error" } }; }
      const record = app.apiKeyService.findById(params.id);
      if (!record) { reply.code(404); return { error: { message: `API key "${params.id}" not found`, code: "not_found" } }; }
      const walletUsd = walletService.refundUsd(params.id, body.data.usd, body.data.reason, body.data.idempotencyKey);
      app.apiKeyService.setWalletMicroUsd(params.id, Math.round(walletUsd * 1_000_000));
      app.adminAuditService.record({ action: "api_key.wallet.refund", actorKeyHash: request.adminAuth?.apiKeyHash, targetType: "api_key", targetId: params.id });
      return { id: params.id, walletUsd, refundedUsd: body.data.usd };
    }
  );

  // Debit / correction (marketplace-lifecycle #3) — remove funds (floored at 0).
  app.post(
    "/admin/v1/api-keys/:id/wallet/debit",
    { preHandler: adminAuth },
    async (request, reply) => {
      const params = z.object({ id: z.string().min(1) }).parse(request.params);
      const body = z.object({ usd: z.number().positive(), reason: z.string().optional() }).safeParse(request.body);
      if (!body.success) { reply.code(400); return { error: { message: "usd must be positive", code: "validation_error" } }; }
      const record = app.apiKeyService.findById(params.id);
      if (!record) { reply.code(404); return { error: { message: `API key "${params.id}" not found`, code: "not_found" } }; }
      const result = walletService.debitUsd(params.id, body.data.usd);
      app.apiKeyService.setWalletMicroUsd(params.id, Math.round(result.newBalanceUsd * 1_000_000));
      app.adminAuditService.record({ action: "api_key.wallet.debit", actorKeyHash: request.adminAuth?.apiKeyHash, targetType: "api_key", targetId: params.id });
      return { id: params.id, walletUsd: result.newBalanceUsd, debitedUsd: result.ok ? body.data.usd : 0, ok: result.ok };
    }
  );
}
