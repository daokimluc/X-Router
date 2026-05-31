/**
 * Admin observability + config routes — usage, usage aggregate, latency metrics,
 * spend snapshots, response-cache stats/flush, request logs, audit logs, and
 * config revisions. Extracted verbatim from routes/admin.ts as part of
 * admin-routes-decompose (behavior-preserving).
 *
 * @module routes/admin/observability
 */
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { AppConfig } from "../../config.js";
import { createAdminAuthMiddleware } from "../../middleware/adminAuth.js";
import { parseIdParam, recordAudit } from "./helpers.js";

const configDraftSchema = z.object({ config: z.record(z.unknown()) });
const rollbackParamsSchema = z.object({ id: z.string().min(1) });

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const str = value instanceof Date ? value.toISOString() : String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export async function registerAdminObservabilityRoutes(
  app: FastifyInstance,
  config: AppConfig
): Promise<void> {
  const adminAuth = createAdminAuthMiddleware(config);

  app.get("/admin/v1/usage", { preHandler: adminAuth }, async (request, reply) => {
    const q = z.object({
      apiKeyHash: z.string().optional(),
      model: z.string().optional(),
      providerType: z.string().optional(),
      protocol: z.enum(["openai", "anthropic"]).optional(),
      from: z.string().datetime().optional(),
      to: z.string().datetime().optional(),
      limit: z.coerce.number().int().min(1).max(1000).optional(),
      offset: z.coerce.number().int().min(0).optional(),
      format: z.enum(["json", "csv"]).optional(),
      aggregate: z.enum(["daily"]).optional()
    }).parse(request.query ?? {});

    const filter = {
      apiKeyHash: q.apiKeyHash,
      model: q.model,
      providerType: q.providerType,
      protocol: q.protocol,
      from: q.from ? new Date(q.from) : undefined,
      to: q.to ? new Date(q.to) : undefined
    };

    if (q.aggregate === "daily") {
      return { data: app.usageService.dailyAggregates(filter) };
    }

    const result = app.usageService.query({ ...filter, limit: q.limit, offset: q.offset });

    if (q.format === "csv") {
      const header = [
        "id","requestId","protocol","model","providerType","providerInstanceId",
        "accountId","apiKeyHash","promptTokens","completionTokens","totalTokens","createdAt"
      ];
      const rows = result.data.map((r) => header.map((k) => csvEscape(
        (r as Record<string, unknown>)[k]
      )).join(","));
      const body = `${header.join(",")}\n${rows.join("\n")}\n`;
      reply.header("content-type", "text/csv; charset=utf-8");
      reply.header("content-disposition", "attachment; filename=usage.csv");
      return body;
    }

    return { data: result.data, total: result.total };
  });

  // Phase 32 — usage-time-series-charts: server-side bucketed aggregate
  app.get("/admin/v1/usage/aggregate", { preHandler: adminAuth }, async (request) => {
    const q = z.object({
      from: z.string().datetime(),
      to: z.string().datetime(),
      bucket: z.enum(["hour", "day"]).optional().default("hour"),
      groupBy: z.enum(["model", "provider"]).optional().default("model")
    }).parse(request.query ?? {});

    return app.usageService.aggregate({
      from: new Date(q.from),
      to: new Date(q.to),
      bucket: q.bucket,
      groupBy: q.groupBy
    });
  });

  // Phase 32 — latency-observability: snapshot of rolling 5-min latency window
  app.get("/admin/v1/metrics/latency", { preHandler: adminAuth }, async () => {
    return app.latencyTracker.snapshot();
  });

  // Phase 32 — spending-caps: spend snapshot per scope
  app.get("/admin/v1/spend/key/:id", { preHandler: adminAuth }, async (request, reply) => {
    const params = { id: parseIdParam(request) };
    const key = app.apiKeyService.list().find((k) => k.id === params.id);
    if (!key) {
      return reply.code(404).send({
        error: { type: "not_found", message: `API key ${params.id} not found`, code: "key_not_found" }
      });
    }
    const team = key.teamId ? app.teamService.get(key.teamId) : undefined;
    const dayCap = key.dailySpendLimitUsd ?? team?.dailySpendLimitUsd ?? null;
    const monthCap = key.monthlySpendLimitUsd ?? team?.monthlySpendLimitUsd ?? null;
    const snap = app.spendLedgerService.snapshot(`key:${key.id}`, dayCap, monthCap);
    return {
      scope: "key" as const,
      id: key.id,
      hour: snap.hour,
      day: snap.day,
      month: snap.month,
      lastBlocked: snap.lastBlocked
    };
  });

  app.get("/admin/v1/spend/team/:id", { preHandler: adminAuth }, async (request, reply) => {
    const params = { id: parseIdParam(request) };
    const team = app.teamService.get(params.id);
    if (!team) {
      return reply.code(404).send({
        error: { type: "not_found", message: `Team ${params.id} not found`, code: "team_not_found" }
      });
    }
    const snap = app.spendLedgerService.snapshot(
      `team:${team.id}`,
      team.dailySpendLimitUsd ?? null,
      team.monthlySpendLimitUsd ?? null
    );
    return {
      scope: "team" as const,
      id: team.id,
      hour: snap.hour,
      day: snap.day,
      month: snap.month,
      lastBlocked: snap.lastBlocked
    };
  });

  // Phase 32 — semantic-response-cache: stats and flush
  app.get("/admin/v1/cache/stats", { preHandler: adminAuth }, async () => {
    return app.responseCacheService.stats();
  });

  app.delete("/admin/v1/cache", { preHandler: adminAuth }, async () => {
    const cleared = app.responseCacheService.delete();
    app.adminAuditService.record({ action: "cache.flush_all", targetType: "cache", targetId: "all" });
    return { cleared };
  });

  app.delete("/admin/v1/cache/:keyPrefix", { preHandler: adminAuth }, async (request) => {
    const params = z.object({ keyPrefix: z.string().min(1).max(64) }).parse(request.params);
    const cleared = app.responseCacheService.delete(params.keyPrefix);
    recordAudit(app, request, "cache.flush_prefix", "cache", params.keyPrefix);
    return { cleared };
  });

  app.get("/admin/v1/request-logs", { preHandler: adminAuth }, async (request, reply) => {
    const q = z.object({
      apiKeyHash: z.string().optional(),
      route: z.string().optional(),
      method: z.string().optional(),
      statusFamily: z.enum(["2xx", "3xx", "4xx", "5xx"]).optional(),
      from: z.string().datetime().optional(),
      to: z.string().datetime().optional(),
      limit: z.coerce.number().int().min(1).max(1000).optional(),
      offset: z.coerce.number().int().min(0).optional(),
      format: z.enum(["json", "csv"]).optional()
    }).parse(request.query ?? {});

    const result = app.requestLogService.query({
      apiKeyHash: q.apiKeyHash,
      route: q.route,
      method: q.method,
      statusFamily: q.statusFamily,
      from: q.from ? new Date(q.from) : undefined,
      to: q.to ? new Date(q.to) : undefined,
      limit: q.limit,
      offset: q.offset
    });

    if (q.format === "csv") {
      const header = [
        "id","requestId","method","route","statusCode","durationMs","apiKeyHash","createdAt"
      ];
      const rows = result.data.map((r) => header.map((k) => csvEscape(
        (r as Record<string, unknown>)[k]
      )).join(","));
      const body = `${header.join(",")}\n${rows.join("\n")}\n`;
      reply.header("content-type", "text/csv; charset=utf-8");
      reply.header("content-disposition", "attachment; filename=request-logs.csv");
      return body;
    }

    return { data: result.data, total: result.total };
  });

  app.delete("/admin/v1/request-logs", { preHandler: adminAuth }, async (request) => {
    app.requestLogService.clear();
    recordAudit(app, request, "request_logs.clear", "logs", "request-logs");
    return { message: "Request logs cleared" };
  });

  app.get("/admin/v1/audit-logs", { preHandler: adminAuth }, async () => {
    return { data: app.adminAuditService.list() };
  });

  app.get("/admin/v1/config/current", { preHandler: adminAuth }, async () => {
    return { data: app.configRevisionService.getCurrent() };
  });

  app.get("/admin/v1/config/revisions", { preHandler: adminAuth }, async () => {
    return { data: app.configRevisionService.listRevisions() };
  });

  app.post("/admin/v1/config/validate", { preHandler: adminAuth }, async (request) => {
    const body = configDraftSchema.parse(request.body);
    return app.configRevisionService.validateDraft(body.config);
  });

  app.post("/admin/v1/config/publish", { preHandler: adminAuth }, async (request) => {
    const body = configDraftSchema.parse(request.body);
    const revision = app.configRevisionService.publish(body.config, request.adminAuth?.apiKeyHash);
    recordAudit(app, request, "config.publish", "config_revision", revision.id);
    return revision;
  });

  app.post("/admin/v1/config/revisions/:id/rollback", { preHandler: adminAuth }, async (request) => {
    const params = rollbackParamsSchema.parse(request.params);
    const revision = app.configRevisionService.rollback(params.id, request.adminAuth?.apiKeyHash);
    recordAudit(app, request, "config.rollback", "config_revision", params.id);
    return revision;
  });
}
