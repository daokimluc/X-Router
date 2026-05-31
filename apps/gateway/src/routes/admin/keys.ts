/**
 * Admin API-key + team routes. Extracted verbatim from routes/admin.ts as part
 * of admin-routes-decompose (behavior-preserving).
 *
 * @module routes/admin/keys
 */
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { AppConfig } from "../../config.js";
import { createAdminAuthMiddleware } from "../../middleware/adminAuth.js";
import { isValidIpOrCidr } from "../../utils/ipMatch.js";
import { parseIdParam, recordAudit } from "./helpers.js";

const apiKeyCreateSchema = z.object({
  owner: z.string().min(1).optional(),
  teamId: z.string().min(1).optional(),
  rpmLimit: z.number().int().min(0).optional(),
  dailyLimit: z.number().int().min(0).optional(),
  dailyTokenLimit: z.number().int().min(0).optional(),
  expiresAt: z.string().datetime().optional(),
  allowedModels: z.array(z.string().min(1)).max(200).optional(),
  allowedIps: z.array(z.string().min(1)).max(50).optional(),
  groupName: z.string().min(1).max(64).optional(),
  crossGroupRetry: z.boolean().optional(),
  dailySpendLimitUsd: z.number().min(0).optional(),
  monthlySpendLimitUsd: z.number().min(0).optional(),
  cacheMode: z.enum(["client_choice", "force_use", "force_skip"]).optional()
});

export async function registerAdminKeysRoutes(
  app: FastifyInstance,
  config: AppConfig
): Promise<void> {
  const adminAuth = createAdminAuthMiddleware(config);

  app.get("/admin/v1/api-keys", { preHandler: adminAuth }, async () => {
    return {
      data: app.apiKeyService.list().map((apiKey) => ({
        ...apiKey,
        limits: app.rateLimitService.getSnapshot(apiKey.keyHash)
      }))
    };
  });

  app.post("/admin/v1/api-keys", { preHandler: adminAuth }, async (request, reply) => {
    const body = apiKeyCreateSchema.parse(request.body ?? {});

    if (body.allowedIps) {
      for (const entry of body.allowedIps) {
        if (!isValidIpOrCidr(entry)) {
          await reply.code(400).send({
            error: { type: "validation_error", message: `Invalid IP or CIDR: "${entry}"`, code: "invalid_ip_entry" }
          });
          return;
        }
      }
    }

    const apiKey = app.apiKeyService.create({
      ...body,
      expiresAt: body.expiresAt ? new Date(body.expiresAt) : undefined
    });
    recordAudit(app, request, "api_key.create", "api_key", apiKey.id);
    return apiKey;
  });

  app.patch("/admin/v1/api-keys/:id", { preHandler: adminAuth }, async (request, reply) => {
    const params = { id: parseIdParam(request) };
    const body = z.object({
      owner: z.string().optional(),
      teamId: z.string().optional(),
      rpmLimit: z.number().int().min(0).optional(),
      dailyLimit: z.number().int().min(0).optional(),
      dailyTokenLimit: z.number().int().min(0).optional(),
      enabled: z.boolean().optional(),
      expiresAt: z.union([z.string().datetime(), z.null()]).optional(),
      allowedModels: z.array(z.string().min(1)).max(200).optional(),
      allowedIps: z.array(z.string().min(1)).max(50).optional(),
      groupName: z.union([z.string().min(1).max(64), z.null()]).optional(),
      crossGroupRetry: z.boolean().optional(),
      dailySpendLimitUsd: z.union([z.number().min(0), z.null()]).optional(),
      monthlySpendLimitUsd: z.union([z.number().min(0), z.null()]).optional(),
      cacheMode: z.enum(["client_choice", "force_use", "force_skip"]).optional()
    }).parse(request.body ?? {});

    if (body.allowedIps) {
      for (const entry of body.allowedIps) {
        if (!isValidIpOrCidr(entry)) {
          await reply.code(400).send({
            error: { type: "validation_error", message: `Invalid IP or CIDR: "${entry}"`, code: "invalid_ip_entry" }
          });
          return;
        }
      }
    }

    const updated = app.apiKeyService.update(params.id, {
      ...body,
      expiresAt: body.expiresAt === null ? null : body.expiresAt ? new Date(body.expiresAt) : undefined
    });
    if (!updated) {
      await reply.code(404).send({ error: { type: "not_found", message: "Key not found" } });
      return;
    }
    return updated;
  });

  app.get("/admin/v1/api-keys/:id/reveal", { preHandler: adminAuth }, async (request, reply) => {
    const params = { id: parseIdParam(request) };
    const key = app.apiKeyService.reveal(params.id);
    if (!key) {
      await reply.code(404).send({ error: { type: "not_found", message: "Key not found" } });
      return;
    }
    recordAudit(app, request, "api_key.reveal", "api_key", params.id);
    return { key };
  });

  app.post("/admin/v1/api-keys/:id/enable", { preHandler: adminAuth }, async (request) => {
    const params = { id: parseIdParam(request) };
    const updated = app.apiKeyService.setEnabled(params.id, true);
    recordAudit(app, request, "api_key.enable", "api_key", params.id);
    return updated;
  });

  app.post("/admin/v1/api-keys/:id/disable", { preHandler: adminAuth }, async (request) => {
    const params = { id: parseIdParam(request) };
    const updated = app.apiKeyService.setEnabled(params.id, false);
    recordAudit(app, request, "api_key.disable", "api_key", params.id);
    return updated;
  });

  app.delete("/admin/v1/api-keys/:id", { preHandler: adminAuth }, async (request, reply) => {
    const params = { id: parseIdParam(request) };
    try {
      const removed = app.apiKeyService.delete(params.id);
      recordAudit(app, request, "api_key.delete", "api_key", params.id);
      app.persistState();
      return removed;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      if (/not found/i.test(message)) {
        await reply.code(404).send({
          error: { type: "not_found", message, code: "api_key_not_found" }
        });
        return;
      }
      throw err;
    }
  });

  // ─── API Key Balance / Top-up ───────────────────────────────
  // Moved to the marketplace layer (usd-wallet #1). The USD wallet is a
  // commercial-marketplace concern; its admin endpoints are registered by
  // registerMarketplace() only when MARKETPLACE_ENABLED.

  // ─── API Key Batch Operations ───────────────────────────────
  app.post("/admin/v1/api-keys/batch-delete", { preHandler: adminAuth }, async (request) => {
    const body = z.object({
      ids: z.array(z.string().min(1)).min(1).max(500)
    }).parse(request.body ?? {});

    const result = app.apiKeyService.bulkDelete(body.ids);
    recordAudit(app, request, "api_key.batch_delete", "api_key", "*");
    app.persistState();
    return result;
  });

  app.get("/admin/v1/api-keys/export", { preHandler: adminAuth }, async (request, reply) => {
    const query = z.object({
      format: z.enum(["csv", "json"]).optional().default("json")
    }).parse(request.query ?? {});

    const keys = app.apiKeyService.list();
    recordAudit(app, request, "api_key.export", "api_key", "*");

    if (query.format === "csv") {
      const header = [
        "id", "owner", "teamId", "keyHash", "enabled", "createdAt",
        "expiresAt", "walletUsd", "rpmLimit", "dailyLimit", "dailyTokenLimit",
        "allowedModels", "allowedIps", "groupName"
      ].join(",");

      const escape = (v: unknown): string => {
        if (v === undefined || v === null) return "";
        const s = Array.isArray(v) ? v.join(";") : String(v);
        if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
        return s;
      };

      const rows = keys.map((k) => [
        k.id, k.owner, k.teamId, k.keyHash, k.enabled,
        k.createdAt instanceof Date ? k.createdAt.toISOString() : k.createdAt,
        k.expiresAt instanceof Date ? k.expiresAt.toISOString() : k.expiresAt,
        k.walletMicroUsd === undefined ? "" : (k.walletMicroUsd / 1_000_000).toFixed(6),
        k.rpmLimit, k.dailyLimit, k.dailyTokenLimit,
        k.allowedModels, k.allowedIps, k.groupName
      ].map(escape).join(","));

      reply.header("content-type", "text/csv; charset=utf-8");
      reply.header("content-disposition", "attachment; filename=api-keys.csv");
      return [header, ...rows].join("\n");
    }

    return { data: keys };
  });

  // ─── Teams ─────────────────────────────────────────────────
  app.get("/admin/v1/teams", { preHandler: adminAuth }, async () => ({ data: app.teamService.list() }));

  app.post("/admin/v1/teams", { preHandler: adminAuth }, async (request) => {
    const schema = z.object({
      name: z.string().min(1).max(80),
      description: z.string().max(500).optional(),
      enabled: z.boolean().optional(),
      allowedModels: z.array(z.string()).optional(),
      allowedProviders: z.array(z.string()).optional(),
      rpmLimit: z.number().int().positive().optional(),
      dailyLimit: z.number().int().positive().optional(),
      monthlyLimit: z.number().int().positive().optional()
    });
    const body = schema.parse(request.body);
    const team = app.teamService.create(body);
    recordAudit(app, request, "team.create", "team", team.id);
    return team;
  });

  app.patch("/admin/v1/teams/:id", { preHandler: adminAuth }, async (request) => {
    const params = { id: parseIdParam(request) };
    const schema = z.object({
      name: z.string().min(1).max(80).optional(),
      description: z.string().max(500).optional(),
      enabled: z.boolean().optional(),
      allowedModels: z.array(z.string()).optional(),
      allowedProviders: z.array(z.string()).optional(),
      rpmLimit: z.number().int().positive().optional(),
      dailyLimit: z.number().int().positive().optional(),
      monthlyLimit: z.number().int().positive().optional()
    });
    const body = schema.parse(request.body);
    const team = app.teamService.update(params.id, body);
    recordAudit(app, request, "team.update", "team", params.id);
    return team;
  });

  app.delete("/admin/v1/teams/:id", { preHandler: adminAuth }, async (request, reply) => {
    const params = { id: parseIdParam(request) };
    try {
      const removed = app.teamService.delete(params.id);
      recordAudit(app, request, "team.delete", "team", params.id);
      return removed;
    } catch (err) {
      await reply.code(404).send({
        error: { type: "not_found", message: err instanceof Error ? err.message : "Team not found", code: "team_not_found" }
      });
    }
  });
}
