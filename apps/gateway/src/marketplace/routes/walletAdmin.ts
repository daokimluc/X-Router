/**
 * Wallet admin routes (usd-wallet #1, marketplace layer).
 *
 * Replaces the engine's old token-based balance/top-up endpoints with USD
 * versions. Registered only when the marketplace is enabled.
 *
 *   GET  /admin/v1/api-keys/:id/wallet   → { id, walletUsd, provisioned }
 *   POST /admin/v1/api-keys/:id/topup    → { id, walletUsd, addedUsd }   (body: { amountUsd })
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
      const body = request.body as { amountUsd?: number };

      if (typeof body.amountUsd !== "number" || body.amountUsd <= 0) {
        reply.code(400);
        return {
          error: { message: "amountUsd must be a positive number", code: "validation_error" }
        };
      }

      const record = app.apiKeyService.findById(params.id);
      if (!record) {
        reply.code(404);
        return {
          error: { message: `API key "${params.id}" not found`, code: "not_found" }
        };
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
}
