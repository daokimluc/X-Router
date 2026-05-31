/**
 * Admin catalog routes — model mappings, model aliases, routing profiles, and
 * model pricing. Extracted verbatim from the monolithic routes/admin.ts as part
 * of admin-routes-decompose (behavior-preserving; same paths/auth/contracts).
 *
 * @module routes/admin/catalog
 */
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { AppConfig } from "../../config.js";
import { createAdminAuthMiddleware } from "../../middleware/adminAuth.js";
import type { ProviderCapabilityFlag } from "../../providers/base/ProviderCapabilities.js";
import { parseIdParam, recordAudit } from "./helpers.js";

const capabilitySchema = z.enum([
  "chat",
  "messages",
  "streaming",
  "tool_calling",
  "json_mode",
  "image_input"
]);

const modelMappingCreateSchema = z.object({
  id: z.string().min(1),
  publicModel: z.string().min(1),
  providerInstanceId: z.string().min(1),
  providerType: z.string().min(1),
  upstreamModel: z.string().min(1),
  enabled: z.boolean().default(true),
  capabilities: z.array(capabilitySchema).default(["chat"])
});

const modelMappingPatchSchema = z.object({
  providerInstanceId: z.string().min(1).optional(),
  providerType: z.string().min(1).optional(),
  upstreamModel: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
  capabilities: z.array(capabilitySchema).optional()
});

const routingProfileCreateSchema = z.object({
  id: z.string().min(1),
  displayName: z.string().min(1),
  candidates: z.array(z.string().min(1)).min(1),
  fallback: z.boolean().default(true),
  enabled: z.boolean().default(true),
  requiredCapabilities: z.array(capabilitySchema).default(["chat"])
});

const routingProfilePatchSchema = z.object({
  displayName: z.string().min(1).optional(),
  candidates: z.array(z.string().min(1)).min(1).optional(),
  fallback: z.boolean().optional(),
  enabled: z.boolean().optional(),
  requiredCapabilities: z.array(capabilitySchema).optional()
});

export async function registerAdminCatalogRoutes(
  app: FastifyInstance,
  config: AppConfig
): Promise<void> {
  const adminAuth = createAdminAuthMiddleware(config);

  // ─── Model Mappings ────────────────────────────────────────
  app.get("/admin/v1/model-mappings", { preHandler: adminAuth }, async () => {
    return { data: app.modelRegistry.listModelMappings() };
  });

  app.post("/admin/v1/model-mappings", { preHandler: adminAuth }, async (request) => {
    const body = modelMappingCreateSchema.parse(request.body);
    const mapping = { ...body, capabilities: body.capabilities as ProviderCapabilityFlag[] };
    app.modelRegistry.register(mapping);
    recordAudit(app, request, "model_mapping.create", "model_mapping", mapping.id);
    app.persistState();
    return mapping;
  });

  app.patch("/admin/v1/model-mappings/:id", { preHandler: adminAuth }, async (request) => {
    const params = { id: parseIdParam(request) };
    const patch = modelMappingPatchSchema.parse(request.body);
    const normalizedPatch = {
      ...patch,
      capabilities: patch.capabilities as ProviderCapabilityFlag[] | undefined
    };
    if (normalizedPatch.capabilities === undefined) {
      delete normalizedPatch.capabilities;
    }
    const updated = app.modelRegistry.updateById(params.id, normalizedPatch);
    recordAudit(app, request, "model_mapping.update", "model_mapping", params.id);
    app.persistState();
    return updated;
  });

  app.delete("/admin/v1/model-mappings/:id", { preHandler: adminAuth }, async (request) => {
    const params = { id: parseIdParam(request) };
    const removed = app.modelRegistry.deleteById(params.id);
    recordAudit(app, request, "model_mapping.delete", "model_mapping", params.id);
    app.persistState();
    return removed;
  });

  // ─── Model Aliases ─────────────────────────────────────────
  app.get("/admin/v1/model-aliases", { preHandler: adminAuth }, async () => {
    return { data: app.modelRegistry.listAliases() };
  });

  app.post("/admin/v1/model-aliases", { preHandler: adminAuth }, async (request) => {
    const body = z
      .object({ alias: z.string().min(1).max(64), target: z.string().min(1).max(64) })
      .parse(request.body);
    app.modelRegistry.addAlias(body.alias, body.target);
    recordAudit(app, request, "model_alias.create", "model_alias", body.alias);
    app.persistState();
    return { alias: body.alias, target: body.target };
  });

  app.delete("/admin/v1/model-aliases/:alias", { preHandler: adminAuth }, async (request) => {
    const params = z.object({ alias: z.string().min(1) }).parse(request.params);
    app.modelRegistry.removeAlias(params.alias);
    recordAudit(app, request, "model_alias.delete", "model_alias", params.alias);
    app.persistState();
    return { deleted: params.alias };
  });

  // ─── Routing Profiles ──────────────────────────────────────
  app.get("/admin/v1/routing-profiles", { preHandler: adminAuth }, async () => {
    return { data: app.routingProfileRegistry.listRoutingProfiles() };
  });

  app.post("/admin/v1/routing-profiles", { preHandler: adminAuth }, async (request) => {
    const body = routingProfileCreateSchema.parse(request.body);
    const profile = {
      ...body,
      requiredCapabilities: body.requiredCapabilities as ProviderCapabilityFlag[]
    };
    app.routingProfileRegistry.register(profile);
    recordAudit(app, request, "routing_profile.create", "routing_profile", profile.id);
    return profile;
  });

  app.patch("/admin/v1/routing-profiles/:id", { preHandler: adminAuth }, async (request) => {
    const params = { id: parseIdParam(request) };
    const patch = routingProfilePatchSchema.parse(request.body);
    const update: Partial<{
      displayName: string;
      candidates: string[];
      fallback: boolean;
      enabled: boolean;
      requiredCapabilities: ProviderCapabilityFlag[];
    }> = { ...patch };
    if (patch.requiredCapabilities) {
      update.requiredCapabilities = patch.requiredCapabilities as ProviderCapabilityFlag[];
    } else {
      delete update.requiredCapabilities;
    }
    const updated = app.routingProfileRegistry.update(params.id, update);
    recordAudit(app, request, "routing_profile.update", "routing_profile", params.id);
    return updated;
  });

  // ─── Model Pricing ─────────────────────────────────────────
  app.get("/admin/v1/model-pricing", { preHandler: adminAuth }, async () => {
    return app.modelPricingService.list();
  });

  app.put("/admin/v1/model-pricing/:model", { preHandler: adminAuth }, async (request, reply) => {
    const params = request.params as { model: string };
    const body = request.body as {
      inputRate?: number;
      outputRate?: number;
      cachedInputRate?: number;
      label?: string;
    };
    if (typeof body.inputRate !== "number" || typeof body.outputRate !== "number") {
      return reply.code(400).send({
        error: { message: "inputRate and outputRate are required numbers", code: "validation_error" }
      });
    }
    const entry = app.modelPricingService.set({
      model: params.model,
      inputRate: body.inputRate,
      outputRate: body.outputRate,
      cachedInputRate: body.cachedInputRate,
      label: body.label
    });
    recordAudit(app, request, "model_pricing.upsert", "model_pricing", params.model);
    return entry;
  });

  app.delete("/admin/v1/model-pricing/:model", { preHandler: adminAuth }, async (request, reply) => {
    const params = request.params as { model: string };
    const deleted = app.modelPricingService.delete(params.model);
    if (!deleted) {
      return reply.code(404).send({
        error: { message: `No pricing found for model "${params.model}"`, code: "not_found" }
      });
    }
    recordAudit(app, request, "model_pricing.delete", "model_pricing", params.model);
    return { deleted: true };
  });
}
