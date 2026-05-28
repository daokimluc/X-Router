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
    // Phase 31 — multiple channels can serve the same publicModel; dedupe.
    const seen = new Set<string>();
    const data: Array<{ id: string; object: string; owned_by: string }> = [];
    for (const mapping of app.modelRegistry.listPublicModels()) {
      if (seen.has(mapping.publicModel)) continue;
      seen.add(mapping.publicModel);
      data.push({
        id: mapping.publicModel,
        object: "model",
        owned_by: "internal-ai-gateway",
      });
    }
    return { object: "list", data };
  });
}
