/**
 * Admin provider-instance + channel routes — provider types, instance CRUD,
 * circuit-breaker reset, copy, batch/by-tag/disabled bulk ops, balance updates,
 * bulk model-sync, and the quick-create channel wizard. Extracted verbatim from
 * routes/admin.ts as part of admin-routes-decompose.
 *
 * @module routes/admin/instances
 */
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { AppConfig } from "../../config.js";
import { createAdminAuthMiddleware } from "../../middleware/adminAuth.js";
import { AccountPool } from "../../account-pool/AccountPool.js";
import { createAccountSelectionStrategy } from "../../account-pool/strategyFactory.js";
import type { ProviderAccount } from "../../providers/base/ProviderAccount.js";
import type { ProviderInstance } from "../../providers/base/ProviderInstance.js";
import { isValidStatusCodeMappingKey, validateHeaderOverride } from "../../utils/channelOverride.js";
import { parseIdParam, recordAudit } from "./helpers.js";

const providerInstancePatchSchema = z.object({
  enabled: z.boolean().optional(),
  name: z.string().min(1).optional(),
  priority: z.number().int().min(-1000).max(1000).optional(),
  accountSelectionStrategy: z
    .enum([
      "round_robin",
      "weighted_round_robin",
      "least_busy",
      "lowest_error_rate",
      "lowest_latency",
      "priority"
    ])
    .optional(),
  paramOverride: z.record(z.unknown()).optional(),
  headerOverride: z.record(z.string()).optional(),
  statusCodeMapping: z.record(z.enum(["retry", "disable", "passthrough"])).optional(),
  groupName: z.union([z.string().min(1).max(64), z.null()]).optional(),
  tag: z.union([z.string().min(1).max(64), z.null()]).optional(),
  maxInputTokens: z.union([z.number().int().positive(), z.null()]).optional(),
  systemPromptOverride: z.union([z.string().max(8000), z.null()]).optional(),
  remark: z.union([z.string().max(500), z.null()]).optional(),
  modelMapping: z.union([z.record(z.string()), z.null()]).optional(),
  testModel: z.union([z.string().min(1).max(120), z.null()]).optional(),
  circuitBreaker: z
    .object({
      enabled: z.boolean(),
      failureThreshold: z.number().int().positive(),
      cooldownMs: z.number().int().min(1000),
      halfOpenMaxRequests: z.number().int().positive().optional()
    })
    .optional()
});

const providerInstanceCreateSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  name: z.string().min(1),
  enabled: z.boolean().default(true),
  baseUrl: z.string().url().optional(),
  priority: z.number().optional(),
  config: z.record(z.unknown()).default({}),
  defaultTimeoutMs: z.number().int().positive().default(30000),
  maxRetries: z.number().int().min(0).default(1),
  cooldownMs: z.number().int().positive().default(60000),
  accountSelectionStrategy: z
    .enum([
      "round_robin",
      "weighted_round_robin",
      "least_busy",
      "lowest_error_rate",
      "lowest_latency",
      "priority"
    ])
    .default("round_robin"),
  maxConcurrentRequests: z.number().int().positive().default(20),
  maxConcurrentRequestsPerAccount: z.number().int().positive().default(3),
  circuitBreaker: z
    .object({
      enabled: z.boolean().default(true),
      failureThreshold: z.number().int().positive().default(5),
      cooldownMs: z.number().int().positive().default(60000),
      halfOpenMaxRequests: z.number().int().positive().default(1)
    })
    .default({
      enabled: true,
      failureThreshold: 5,
      cooldownMs: 60000,
      halfOpenMaxRequests: 1
    })
});

export async function registerAdminInstanceRoutes(
  app: FastifyInstance,
  config: AppConfig
): Promise<void> {
  const adminAuth = createAdminAuthMiddleware(config);

  // PLACEHOLDER_INSTANCE_ROUTES

  app.get("/admin/v1/provider-types", { preHandler: adminAuth }, async () => {
    return { data: app.providerRegistry.listProviderTypes() };
  });

  app.get("/admin/v1/provider-instances", { preHandler: adminAuth }, async () => {
    return { data: app.providerRuntimeRegistry.listProviderInstances() };
  });

  app.post("/admin/v1/provider-instances", { preHandler: adminAuth }, async (request) => {
    const body = providerInstanceCreateSchema.parse(request.body);
    const now = new Date();
    const providerInstance: ProviderInstance = { ...body, createdAt: now, updatedAt: now };
    app.providerRuntimeRegistry.registerProviderInstance(providerInstance);
    if (!app.providerRuntimeRegistry.getAccountPool(providerInstance.id)) {
      app.providerRuntimeRegistry.registerAccountPool(
        providerInstance.id,
        new AccountPool([], createAccountSelectionStrategy(providerInstance.accountSelectionStrategy))
      );
    }
    recordAudit(app, request, "provider_instance.create", "provider_instance", providerInstance.id);
    return providerInstance;
  });

  app.patch("/admin/v1/provider-instances/:id", { preHandler: adminAuth }, async (request, reply) => {
    const params = { id: parseIdParam(request) };
    const patch = providerInstancePatchSchema.parse(request.body);

    if (patch.headerOverride) {
      const conflicts = validateHeaderOverride(patch.headerOverride);
      if (!conflicts.valid) {
        await reply.code(400).send({
          error: {
            type: "validation_error",
            message: `Reserved headers cannot be overridden: ${conflicts.reservedConflicts.join(", ")}`,
            code: "reserved_header_override"
          }
        });
        return;
      }
    }
    if (patch.statusCodeMapping) {
      for (const key of Object.keys(patch.statusCodeMapping)) {
        if (!isValidStatusCodeMappingKey(key)) {
          await reply.code(400).send({
            error: {
              type: "validation_error",
              message: `Invalid status code key: "${key}". Use "401", "5xx", etc.`,
              code: "invalid_status_code_key"
            }
          });
          return;
        }
      }
    }

    const updated = app.providerRuntimeRegistry.updateProviderInstance(params.id, {
      ...patch,
      groupName: patch.groupName === null ? undefined : patch.groupName,
      tag: patch.tag === null ? undefined : patch.tag,
      maxInputTokens: patch.maxInputTokens === null ? undefined : patch.maxInputTokens,
      systemPromptOverride: patch.systemPromptOverride === null ? undefined : patch.systemPromptOverride,
      remark: patch.remark === null ? undefined : patch.remark,
      modelMapping: patch.modelMapping === null ? undefined : patch.modelMapping,
      testModel: patch.testModel === null ? undefined : patch.testModel,
      circuitBreaker: patch.circuitBreaker
        ? {
            enabled: patch.circuitBreaker.enabled,
            failureThreshold: patch.circuitBreaker.failureThreshold,
            cooldownMs: patch.circuitBreaker.cooldownMs,
            halfOpenMaxRequests: patch.circuitBreaker.halfOpenMaxRequests ?? 1
          }
        : undefined
    });
    recordAudit(app, request, "provider_instance.update", "provider_instance", params.id);
    return updated;
  });

  app.post("/admin/v1/provider-instances/:id/circuit-breaker/reset", { preHandler: adminAuth }, async (request) => {
    const params = { id: parseIdParam(request) };
    app.circuitBreaker.reset(params.id);
    recordAudit(app, request, "circuit_breaker.reset", "provider_instance", params.id);
    return { ok: true, state: app.circuitBreaker.getCircuitState(params.id) };
  });

  // PLACEHOLDER_INSTANCE_ROUTES_2

  // Phase 25 — duplicate a provider instance with a new id and name.
  app.post("/admin/v1/provider-instances/:id/copy", { preHandler: adminAuth }, async (request, reply) => {
    const params = { id: parseIdParam(request) };
    const body = z.object({
      newId: z.string().min(1),
      newName: z.string().min(1).optional()
    }).parse(request.body ?? {});

    const source = app.providerRuntimeRegistry.getProviderInstance(params.id);
    if (!source) {
      return reply.code(404).send({
        error: { type: "not_found", message: `Provider instance "${params.id}" not found`, code: "not_found" }
      });
    }
    if (app.providerRuntimeRegistry.getProviderInstance(body.newId)) {
      return reply.code(409).send({
        error: { type: "conflict", message: `Provider instance "${body.newId}" already exists`, code: "id_conflict" }
      });
    }

    const copy: ProviderInstance = {
      ...structuredClone(source),
      id: body.newId,
      name: body.newName ?? `${source.name} (copy)`,
      enabled: false, // copies start disabled to avoid accidental traffic
      createdAt: new Date(),
      updatedAt: new Date()
    };
    app.providerRuntimeRegistry.registerProviderInstance(copy);
    recordAudit(app, request, "provider_instance.copy", "provider_instance", body.newId);
    app.persistState();
    return copy;
  });

  // Phase 25 — batch operations on provider instances.
  app.post("/admin/v1/provider-instances/batch", { preHandler: adminAuth }, async (request) => {
    const body = z.object({
      ids: z.array(z.string().min(1)).min(1).max(200),
      action: z.enum(["enable", "disable", "delete"])
    }).parse(request.body ?? {});

    const updated: string[] = [];
    const notFound: string[] = [];
    for (const id of body.ids) {
      if (body.action === "delete") {
        const had = app.providerRuntimeRegistry.removeProviderInstance(id);
        if (had) updated.push(id);
        else notFound.push(id);
      } else {
        const inst = app.providerRuntimeRegistry.getProviderInstance(id);
        if (!inst) {
          notFound.push(id);
          continue;
        }
        app.providerRuntimeRegistry.updateProviderInstance(id, { enabled: body.action === "enable" });
        updated.push(id);
      }
    }
    recordAudit(app, request, `provider_instance.batch_${body.action}`, "provider_instance", "*");
    app.persistState();
    return { action: body.action, updated: updated.length, ids: updated, notFound };
  });

  // Phase 29 — bulk action by tag (enable/disable/delete all instances with given tag).
  app.post("/admin/v1/provider-instances/by-tag", { preHandler: adminAuth }, async (request) => {
    const body = z.object({
      tag: z.string().min(1).max(64),
      action: z.enum(["enable", "disable", "delete"])
    }).parse(request.body ?? {});

    const matching = app.providerRuntimeRegistry.listProviderInstances().filter((i) => i.tag === body.tag);

    const updated: string[] = [];
    for (const inst of matching) {
      if (body.action === "delete") {
        if (app.providerRuntimeRegistry.removeProviderInstance(inst.id)) {
          updated.push(inst.id);
        }
      } else {
        app.providerRuntimeRegistry.updateProviderInstance(inst.id, { enabled: body.action === "enable" });
        updated.push(inst.id);
      }
    }
    recordAudit(app, request, `provider_instance.tag_${body.action}`, "provider_instance", `tag:${body.tag}`);
    app.persistState();
    return { tag: body.tag, action: body.action, matched: matching.length, updated };
  });

  // Phase 29 — cleanup all disabled provider instances at once.
  app.delete("/admin/v1/provider-instances/disabled", { preHandler: adminAuth }, async (request) => {
    const disabled = app.providerRuntimeRegistry.listProviderInstances().filter((i) => !i.enabled);
    const removed: string[] = [];
    for (const inst of disabled) {
      if (app.providerRuntimeRegistry.removeProviderInstance(inst.id)) {
        removed.push(inst.id);
      }
    }
    recordAudit(app, request, "provider_instance.cleanup_disabled", "provider_instance", "*");
    app.persistState();
    return { removed: removed.length, ids: removed };
  });

  // Phase 29 — query upstream balance for a single channel (best-effort).
  app.post("/admin/v1/provider-instances/:id/update-balance", { preHandler: adminAuth }, async (request, reply) => {
    const params = { id: parseIdParam(request) };
    const inst = app.providerRuntimeRegistry.getProviderInstance(params.id);
    if (!inst) {
      return reply.code(404).send({
        error: { type: "not_found", message: `Provider instance "${params.id}" not found`, code: "not_found" }
      });
    }
    const now = new Date();
    const updated = app.providerRuntimeRegistry.updateProviderInstance(params.id, {
      upstreamBalanceUpdatedAt: now
    });
    recordAudit(app, request, "provider_instance.update_balance", "provider_instance", params.id);
    return {
      instanceId: params.id,
      balance: updated.upstreamBalance ?? null,
      updatedAt: now.toISOString(),
      note: "Balance query API not yet implemented for this adapter — timestamp recorded."
    };
  });

  // Phase 29 — bulk balance update across all enabled instances.
  app.post("/admin/v1/provider-instances/update-balance-all", { preHandler: adminAuth }, async (request) => {
    const enabled = app.providerRuntimeRegistry.listProviderInstances().filter((i) => i.enabled);
    const now = new Date();
    const ids: string[] = [];
    for (const inst of enabled) {
      app.providerRuntimeRegistry.updateProviderInstance(inst.id, { upstreamBalanceUpdatedAt: now });
      ids.push(inst.id);
    }
    recordAudit(app, request, "provider_instance.update_balance_all", "provider_instance", "*");
    return { count: ids.length, ids, timestamp: now.toISOString() };
  });

  // PLACEHOLDER_INSTANCE_ROUTES_3

  // Phase 29 — bulk upstream model drift detection across all enabled instances.
  app.post("/admin/v1/sync-models/bulk", { preHandler: adminAuth }, async (request) => {
    const body = z.object({
      autoCreate: z.boolean().optional().default(false)
    }).parse(request.body ?? {});

    const enabled = app.providerRuntimeRegistry.listProviderInstances().filter((i) => i.enabled);

    const results: Array<{
      instanceId: string;
      instanceName: string;
      discovered: number;
      new: Array<{ id: string; upstreamModel: string }>;
      removed: Array<{ id: string; publicModel: string }>;
      autoCreated?: string[];
      error?: string;
    }> = [];

    for (const inst of enabled) {
      const adapter = app.providerRegistry.getAdapter(inst.type);
      if (!adapter) {
        results.push({
          instanceId: inst.id,
          instanceName: inst.name,
          discovered: 0,
          new: [],
          removed: [],
          error: `No adapter for type "${inst.type}"`
        });
        continue;
      }

      const pool = app.providerRuntimeRegistry.getAccountPool(inst.id);
      const accounts = pool ? pool.listAccounts().filter((a) => a.status !== "disabled") : [];
      const account = accounts[0];
      const secret = account ? app.secretService.getSecretForAccount(account.id) : undefined;
      const credentialPayload = secret ? app.secretService.decryptSecretPayload(secret) : {};

      try {
        const upstreamModels = await adapter.listModels({ providerInstance: inst, credentialPayload });
        const existingMappings = app.modelRegistry.listModelMappings().filter((m) => m.providerInstanceId === inst.id);
        const existingUpstream = new Set(existingMappings.map((m) => m.upstreamModel));
        const newModels = upstreamModels.filter((m) => !existingUpstream.has(m.upstreamModel));
        const removedModels = existingMappings.filter(
          (m) => !upstreamModels.some((u) => u.upstreamModel === m.upstreamModel)
        );

        const created: string[] = [];
        if (body.autoCreate) {
          for (const model of newModels) {
            const mappingId = `${inst.type}_${model.id}`.replace(/[^a-z0-9_]+/gi, "_");
            try {
              app.modelRegistry.register({
                id: mappingId,
                publicModel: model.id,
                providerInstanceId: inst.id,
                providerType: inst.type,
                upstreamModel: model.upstreamModel,
                capabilities: ["chat"],
                enabled: true
              });
              created.push(model.id);
            } catch {
              // mapping already exists — skip
            }
          }
        }

        results.push({
          instanceId: inst.id,
          instanceName: inst.name,
          discovered: upstreamModels.length,
          new: newModels.map((m) => ({ id: m.id, upstreamModel: m.upstreamModel })),
          removed: removedModels.map((m) => ({ id: m.id, publicModel: m.publicModel })),
          autoCreated: body.autoCreate ? created : undefined
        });
      } catch (err) {
        results.push({
          instanceId: inst.id,
          instanceName: inst.name,
          discovered: 0,
          new: [],
          removed: [],
          error: err instanceof Error ? err.message : String(err)
        });
      }
    }

    recordAudit(
      app,
      request,
      body.autoCreate ? "models.bulk_sync_apply" : "models.bulk_sync_detect",
      "provider_instance",
      "*"
    );

    const totalNew = results.reduce((s, r) => s + r.new.length, 0);
    const totalRemoved = results.reduce((s, r) => s + r.removed.length, 0);
    const totalErrors = results.filter((r) => r.error).length;

    return {
      autoCreate: body.autoCreate,
      instancesScanned: results.length,
      totalNewModels: totalNew,
      totalRemovedModels: totalRemoved,
      totalErrors,
      results
    };
  });

  // PLACEHOLDER_INSTANCE_ROUTES_4

  // Phase 30 — Quick-create channel: atomic create instance + accounts + model mappings.
  app.post("/admin/v1/channels/quick-create", { preHandler: adminAuth }, async (request, reply) => {
    const schema = z.object({
      // Basic
      id: z.string().min(1).max(120),
      type: z.string().min(1),
      name: z.string().min(1).max(120),
      baseUrl: z.string().url().optional(),
      groupName: z.string().min(1).max(64).optional(),
      tag: z.string().min(1).max(64).optional(),
      priority: z.number().int().min(-1000).max(1000).optional(),
      remark: z.string().max(500).optional(),
      // Credentials — accept either single key or list
      credentialType: z.enum([
        "api_key",
        "bearer_token",
        "oauth",
        "refresh_token",
        "session_cookie",
        "custom_json"
      ]).default("api_key"),
      keys: z.array(z.string().min(1)).min(1).max(50),
      // Models
      models: z.array(z.string().min(1)).min(1).max(200),
      modelMapping: z.record(z.string()).optional(),
      testModel: z.string().min(1).optional(),
      // Advanced (optional)
      maxInputTokens: z.number().int().positive().optional(),
      systemPromptOverride: z.string().max(8000).optional(),
      paramOverride: z.record(z.unknown()).optional(),
      headerOverride: z.record(z.string()).optional(),
      statusCodeMapping: z.record(z.enum(["retry", "disable", "passthrough"])).optional(),
      autoBan: z.boolean().optional()
    });
    const body = schema.parse(request.body ?? {});

    if (app.providerRuntimeRegistry.getProviderInstance(body.id)) {
      return reply.code(409).send({
        error: { type: "conflict", message: `Channel id "${body.id}" already exists`, code: "id_conflict" }
      });
    }

    if (body.headerOverride) {
      const conflicts = validateHeaderOverride(body.headerOverride);
      if (!conflicts.valid) {
        return reply.code(400).send({
          error: {
            type: "validation_error",
            message: `Reserved headers cannot be overridden: ${conflicts.reservedConflicts.join(", ")}`,
            code: "reserved_header_override"
          }
        });
      }
    }
    if (body.statusCodeMapping) {
      for (const k of Object.keys(body.statusCodeMapping)) {
        if (!isValidStatusCodeMappingKey(k)) {
          return reply.code(400).send({
            error: { type: "validation_error", message: `Invalid status code key: "${k}"`, code: "invalid_status_code_key" }
          });
        }
      }
    }

    const now = new Date();
    const instance: ProviderInstance = {
      id: body.id,
      type: body.type,
      name: body.name,
      enabled: true,
      baseUrl: body.baseUrl,
      priority: body.priority,
      config: body.baseUrl ? { baseUrl: body.baseUrl } : {},
      defaultTimeoutMs: 30000,
      maxRetries: 1,
      cooldownMs: 60000,
      accountSelectionStrategy: "round_robin",
      maxConcurrentRequests: 20,
      maxConcurrentRequestsPerAccount: 3,
      circuitBreaker: {
        enabled: body.autoBan ?? true,
        failureThreshold: 5,
        cooldownMs: 60000,
        halfOpenMaxRequests: 1
      },
      groupName: body.groupName,
      tag: body.tag,
      remark: body.remark,
      modelMapping: body.modelMapping,
      testModel: body.testModel,
      maxInputTokens: body.maxInputTokens,
      systemPromptOverride: body.systemPromptOverride,
      paramOverride: body.paramOverride,
      headerOverride: body.headerOverride,
      statusCodeMapping: body.statusCodeMapping,
      createdAt: now,
      updatedAt: now
    };

    app.providerRuntimeRegistry.registerProviderInstance(instance);
    const accountPool = new AccountPool([], createAccountSelectionStrategy(instance.accountSelectionStrategy));
    app.providerRuntimeRegistry.registerAccountPool(instance.id, accountPool);

    // PLACEHOLDER_QUICK_CREATE_BODY

    // Create N accounts (1 per key)
    const createdAccountIds: string[] = [];
    body.keys.forEach((key, index) => {
      const accountId = `${instance.id}_acc_${index + 1}`;
      const credentialRef = `${instance.id}_cred_${index + 1}`;
      const account: ProviderAccount = {
        id: accountId,
        providerInstanceId: instance.id,
        providerType: instance.type,
        displayName: `${instance.name} key ${index + 1}`,
        status: "active",
        weight: 1,
        maxConcurrency: 3,
        credentialRef,
        runtime: {
          activeRequests: 0,
          totalRequests: 0,
          failedRequests: 0,
          consecutiveFailures: 0
        },
        createdAt: now,
        updatedAt: now
      };
      const credentialPayload: Record<string, unknown> =
        body.credentialType === "api_key"
          ? { apiKey: key }
          : body.credentialType === "bearer_token"
          ? { accessToken: key }
          : body.credentialType === "refresh_token"
          ? { refreshToken: key }
          : { apiKey: key };
      app.secretService.addCredentialPayload({
        id: credentialRef,
        accountId,
        credentialType: body.credentialType,
        credentialPayload
      });
      accountPool.addAccount(account);
      createdAccountIds.push(accountId);
    });

    // Create N model mappings (1 per model in body.models)
    const createdMappingIds: string[] = [];
    for (const model of body.models) {
      const mappingId = `${instance.id}_${model}`.replace(/[^a-z0-9_]+/gi, "_");
      try {
        app.modelRegistry.register({
          id: mappingId,
          publicModel: model,
          providerInstanceId: instance.id,
          providerType: instance.type,
          upstreamModel: body.modelMapping?.[model] ?? model,
          capabilities: ["chat"],
          enabled: true
        });
        createdMappingIds.push(mappingId);
      } catch {
        // Phase 31 — multiple channels can serve the same publicModel.
        // Only skip if the mapping ID already exists (same channel + model).
      }
    }

    recordAudit(app, request, "channel.quick_create", "provider_instance", instance.id);
    app.persistState();

    return {
      instance,
      accounts: createdAccountIds,
      models: createdMappingIds,
      summary: `Created channel "${instance.id}" with ${createdAccountIds.length} key(s) and ${createdMappingIds.length} model(s).`
    };
  });
}
