/**
 * Markup admin routes — lowest-cost-routing (#5).
 *
 *   GET /admin/v1/markup            → { defaultMarkup, perModel }
 *   PUT /admin/v1/markup            → set defaultMarkup and/or per-model overrides
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppConfig } from "../../config.js";
import { createAdminAuthMiddleware } from "../../middleware/adminAuth.js";
import type { MarketPricingService } from "../services/MarketPricingService.js";

export function registerMarkupAdminRoutes(
  app: FastifyInstance,
  config: AppConfig,
  pricing: MarketPricingService
): void {
  const adminAuth = createAdminAuthMiddleware(config);

  app.get("/admin/v1/markup", { preHandler: adminAuth }, async () => {
    return pricing.listMarkups();
  });

  app.put("/admin/v1/markup", { preHandler: adminAuth }, async (request, reply) => {
    const parsed = z
      .object({
        defaultMarkup: z.number().min(0).optional(),
        perModel: z.record(z.number().min(0)).optional()
      })
      .safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: { message: "markup must be >= 0", code: "validation_error" } };
    }
    if (parsed.data.defaultMarkup !== undefined) {
      pricing.setDefaultMarkup(parsed.data.defaultMarkup);
    }
    if (parsed.data.perModel) {
      for (const [model, markup] of Object.entries(parsed.data.perModel)) {
        pricing.setModelMarkup(model, markup);
      }
    }
    app.adminAuditService.record({
      action: "markup.update",
      actorKeyHash: request.adminAuth?.apiKeyHash,
      targetType: "markup",
      targetId: "*"
    });
    return pricing.listMarkups();
  });
}
