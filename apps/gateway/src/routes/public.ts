/**
 * Public read-only routes (Phase 21).
 *
 * No auth required. Exposes information that's safe for end users:
 * - Model pricing list
 * - Public model list (subset of /v1/models without per-key restrictions)
 */

import type { FastifyInstance } from "fastify";
import type { AppConfig } from "../config.js";
import { DEFAULT_ADMIN_KEY } from "../services/AdminKeyService.js";

export async function registerPublicRoutes(app: FastifyInstance, config: AppConfig): Promise<void> {
  app.get("/v1/pricing", async () => {
    return {
      data: app.modelPricingService.list(),
    };
  });

  // Login page support: tells the (unauthenticated) login screen whether the
  // admin key is still the out-of-the-box default, so it can surface the
  // "Default password: admin" hint on first run only. Once the password has
  // been changed, no value is exposed.
  //
  // Also exposes `marketplaceEnabled` so the dashboard shows the Marketplace
  // operator section only when the marketplace flag is on (admin-marketplace-ui).
  // Safe to expose unauthenticated — it's a boolean feature flag, not a secret.
  app.get("/v1/public/auth-info", async () => {
    const isDefaultPassword = app.adminKeyService.isDefault();
    return {
      isDefaultPassword,
      defaultPassword: isDefaultPassword ? DEFAULT_ADMIN_KEY : null,
      marketplaceEnabled: config.marketplaceEnabled,
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
