/**
 * Plan admin routes — marketplace-plans (#3).
 *
 *   GET    /admin/v1/plans               → { plans }
 *   POST   /admin/v1/plans               → create
 *   PATCH  /admin/v1/plans/:id           → update
 *   DELETE /admin/v1/plans/:id           → delete
 *   PATCH  /admin/v1/keys/:id/plan       → assign planId / overageEnabled / paygDailyLimitUsd
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppConfig } from "../../config.js";
import { createAdminAuthMiddleware } from "../../middleware/adminAuth.js";
import type { PlanService } from "../services/PlanService.js";

const bucketsSchema = z.object({
  hourUsd: z.number().min(0),
  dayUsd: z.number().min(0),
  monthUsd: z.number().min(0)
});

const planBodySchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().min(1),
  priceUsd: z.number().min(0),
  modelGroups: z.array(z.string().min(1)).min(1),
  buckets: bucketsSchema,
  overageEnabled: z.boolean(),
  paygDailyLimitUsd: z.number().min(0).optional()
});

export function registerPlanAdminRoutes(
  app: FastifyInstance,
  config: AppConfig,
  planService: PlanService
): void {
  const adminAuth = createAdminAuthMiddleware(config);

  app.get("/admin/v1/plans", { preHandler: adminAuth }, async () => {
    return { plans: planService.list() };
  });

  app.post("/admin/v1/plans", { preHandler: adminAuth }, async (request, reply) => {
    const parsed = planBodySchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: { message: "invalid plan", code: "validation_error", issues: parsed.error.issues } };
    }
    const plan = planService.create(parsed.data);
    app.adminAuditService.record({
      action: "plan.create",
      actorKeyHash: request.adminAuth?.apiKeyHash,
      targetType: "plan",
      targetId: plan.id
    });
    return { plan };
  });

  app.patch("/admin/v1/plans/:id", { preHandler: adminAuth }, async (request, reply) => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const parsed = planBodySchema.partial().safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: { message: "invalid plan patch", code: "validation_error" } };
    }
    const plan = planService.update(params.id, parsed.data);
    if (!plan) {
      reply.code(404);
      return { error: { message: `plan ${params.id} not found`, code: "not_found" } };
    }
    app.adminAuditService.record({
      action: "plan.update",
      actorKeyHash: request.adminAuth?.apiKeyHash,
      targetType: "plan",
      targetId: params.id
    });
    return { plan };
  });

  app.delete("/admin/v1/plans/:id", { preHandler: adminAuth }, async (request, reply) => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const ok = planService.delete(params.id);
    if (!ok) {
      reply.code(404);
      return { error: { message: `plan ${params.id} not found`, code: "not_found" } };
    }
    app.adminAuditService.record({
      action: "plan.delete",
      actorKeyHash: request.adminAuth?.apiKeyHash,
      targetType: "plan",
      targetId: params.id
    });
    return { deleted: params.id };
  });

  app.patch("/admin/v1/keys/:id/plan", { preHandler: adminAuth }, async (request, reply) => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const body = z
      .object({
        planId: z.string().nullable().optional(),
        overageEnabled: z.boolean().nullable().optional(),
        paygDailyLimitUsd: z.number().min(0).nullable().optional()
      })
      .parse(request.body);

    if (body.planId && !planService.get(body.planId)) {
      reply.code(400);
      return { error: { message: `plan ${body.planId} does not exist`, code: "validation_error" } };
    }

    const updated = app.apiKeyService.update(params.id, {
      planId: body.planId === undefined ? undefined : body.planId,
      overageEnabled: body.overageEnabled === undefined ? undefined : body.overageEnabled,
      paygDailyLimitUsd: body.paygDailyLimitUsd === undefined ? undefined : body.paygDailyLimitUsd
    });
    if (!updated) {
      reply.code(404);
      return { error: { message: `API key ${params.id} not found`, code: "not_found" } };
    }
    app.adminAuditService.record({
      action: "api_key.assign_plan",
      actorKeyHash: request.adminAuth?.apiKeyHash,
      targetType: "api_key",
      targetId: params.id
    });
    return { id: params.id, planId: updated.planId ?? null, overageEnabled: updated.overageEnabled ?? null, paygDailyLimitUsd: updated.paygDailyLimitUsd ?? null };
  });
}
