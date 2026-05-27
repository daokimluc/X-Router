/**
 * Public read-only routes (Phase 21).
 *
 * No auth required. Exposes information that's safe for end users:
 * - Model pricing list
 * - Public model list (subset of /v1/models without per-key restrictions)
 */

import type { FastifyInstance } from "fastify";

export async function registerPublicRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/pricing", async () => {
    return {
      data: app.modelPricingService.list(),
    };
  });

  app.get("/v1/public/models", async () => {
    return {
      object: "list",
      data: app.modelRegistry.listPublicModels().map((mapping) => ({
        id: mapping.publicModel,
        object: "model",
        owned_by: "internal-ai-gateway",
      })),
    };
  });
}
