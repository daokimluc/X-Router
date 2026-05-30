/**
 * Business webhook admin routes — provision-webhook (#7).
 *
 *   GET /admin/v1/business-webhook   → config with the secret masked
 *   PUT /admin/v1/business-webhook   → update enabled/url/secret/events
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppConfig } from "../../config.js";
import { createAdminAuthMiddleware } from "../../middleware/adminAuth.js";
import type { WebhookEvent } from "../../services/WebhookService.js";

const BUSINESS_EVENTS: WebhookEvent[] = [
  "usage.recorded",
  "grant.exhausted",
  "wallet.low",
  "quota.blocked",
  "supply.unhealthy"
];

export function registerBusinessWebhookAdminRoutes(app: FastifyInstance, config: AppConfig): void {
  const adminAuth = createAdminAuthMiddleware(config);

  app.get("/admin/v1/business-webhook", { preHandler: adminAuth }, async () => {
    const cfg = app.webhookService.getBusinessConfig();
    return {
      enabled: cfg.enabled,
      url: cfg.url,
      events: cfg.events,
      secretSet: cfg.secret.length > 0,
      secret: cfg.secret ? "••••••••" : ""
    };
  });

  app.put("/admin/v1/business-webhook", { preHandler: adminAuth }, async (request, reply) => {
    const parsed = z.object({
      enabled: z.boolean().optional(),
      url: z.string().url().or(z.literal("")).optional(),
      secret: z.string().optional(),
      events: z.array(z.enum(BUSINESS_EVENTS as [WebhookEvent, ...WebhookEvent[]])).optional()
    }).safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: { message: "invalid business webhook config", code: "validation_error" } };
    }
    const updated = app.webhookService.updateBusinessConfig(parsed.data);
    app.adminAuditService.record({
      action: "business_webhook.update",
      actorKeyHash: request.adminAuth?.apiKeyHash,
      targetType: "webhook",
      targetId: "business"
    });
    return { enabled: updated.enabled, url: updated.url, events: updated.events, secretSet: updated.secret.length > 0 };
  });
}
