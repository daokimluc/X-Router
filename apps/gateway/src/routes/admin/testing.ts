/**
 * Admin testing routes — account test, provider-instance test-model, test-all,
 * provider-instance test, and per-instance sync-models. Extracted verbatim from
 * routes/admin.ts as part of admin-routes-decompose.
 *
 * @module routes/admin/testing
 */
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { AppConfig } from "../../config.js";
import { createAdminAuthMiddleware } from "../../middleware/adminAuth.js";
import { ProviderError } from "../../providers/base/ProviderErrors.js";
import { NotFoundError } from "../../errors/NotFoundError.js";
import { parseIdParam, recordAudit } from "./helpers.js";

const accountTestSchema = z.object({
  model: z.string().min(1).optional(),
  prompt: z.string().min(1).default("Health check. Reply with ok."),
  maxTokens: z.number().int().positive().max(512).default(64)
});
const providerModelTestSchema = z.object({
  model: z.string().min(1),
  prompt: z.string().min(1).default("Health check. Reply with ok."),
  maxTokens: z.number().int().positive().max(512).default(64)
});

function resolveAccountTestModel(
  app: FastifyInstance,
  providerInstanceId: string,
  requestedModel?: string
): { publicModel: string; upstreamModel: string } {
  const mappings = app.modelRegistry
    .listPublicModels()
    .filter((mapping) => mapping.providerInstanceId === providerInstanceId);

  const mapping = requestedModel
    ? mappings.find((item) => item.publicModel === requestedModel)
    : mappings[0];

  if (!mapping) {
    throw new NotFoundError(
      requestedModel
        ? `Model ${requestedModel} is not mapped to provider instance ${providerInstanceId}`
        : `No enabled model mapping found for provider instance ${providerInstanceId}`
    );
  }

  return {
    publicModel: mapping.publicModel,
    upstreamModel: mapping.upstreamModel
  };
}

export async function registerAdminTestingRoutes(
  app: FastifyInstance,
  config: AppConfig
): Promise<void> {
  const adminAuth = createAdminAuthMiddleware(config);

  app.post(
    "/admin/v1/accounts/:id/test",
    {
      preHandler: adminAuth
    },
    async (request) => {
      const params = { id: parseIdParam(request) };
      const body = accountTestSchema.parse(request.body ?? {});
      const startedAt = performance.now();
      const providerInstance = app.providerRuntimeRegistry
        .listProviderInstances()
        .find((instance) =>
          app.providerRuntimeRegistry.getAccountPool(instance.id)?.getAccount(params.id)
        );

      if (!providerInstance) {
        throw new NotFoundError(`Account ${params.id} not found`);
      }

      const accountPool = app.providerRuntimeRegistry.getAccountPool(providerInstance.id);
      const account = accountPool?.getAccount(params.id);

      if (!account) {
        throw new NotFoundError(`Account ${params.id} not found`);
      }

      const adapter = app.providerRegistry.getAdapter(providerInstance.type);
      const secret = app.secretService.getSecretForAccount(account.id);
      const credentialPayload = secret
        ? app.secretService.decryptSecretPayload(secret)
        : {};
      const model = resolveAccountTestModel(app, providerInstance.id, body.model);

      // Auto-refresh token before test if adapter supports it
      let finalCredentialPayload = credentialPayload;
      if (adapter.refreshSession) {
        try {
          const refreshResult = await adapter.refreshSession(account, {
            providerInstance,
            credentialPayload
          });
          if (refreshResult.refreshed && refreshResult.credentialPayload && secret) {
            app.secretService.updateSecretPayload(secret.id, refreshResult.credentialPayload);
            finalCredentialPayload = refreshResult.credentialPayload;
            request.log.info({ accountId: account.id }, "Token refreshed before test");
          } else {
            request.log.warn({ accountId: account.id, message: refreshResult.message }, "Token refresh returned non-refreshed result");
          }
        } catch (refreshErr) {
          request.log.warn({ accountId: account.id, err: refreshErr }, "Token refresh failed before test");
        }
      }

      try {
        const response = await adapter.chatCompletions(
          {
            model: model.upstreamModel,
            messages: [
              {
                role: "user",
                content: body.prompt
              }
            ],
            max_tokens: body.maxTokens,
            stream: false
          },
          {
            providerInstance,
            account,
            requestId: request.id,
            credentialPayload: finalCredentialPayload
          }
        );

        if (Symbol.asyncIterator in (response as Record<PropertyKey, unknown>)) {
          throw new ProviderError({
            code: "provider_bad_response",
            message: "Account test expected a non-streaming provider response",
            retryable: false,
            statusCode: 502
          });
        }
        const normalizedResponse = response as {
          choices?: Array<{ message?: { content?: string } }>;
        };

        return {
          ok: true,
          accountId: account.id,
          providerType: providerInstance.type,
          providerInstanceId: providerInstance.id,
          publicModel: model.publicModel,
          upstreamModel: model.upstreamModel,
          durationMs: Math.round((performance.now() - startedAt) * 10) / 10,
          preview: normalizedResponse.choices?.[0]?.message?.content ?? ""
        };
      } catch (error) {
        return {
          ok: false,
          accountId: account.id,
          providerType: providerInstance.type,
          providerInstanceId: providerInstance.id,
          publicModel: model.publicModel,
          upstreamModel: model.upstreamModel,
          durationMs: Math.round((performance.now() - startedAt) * 10) / 10,
          error: {
            code: error instanceof ProviderError ? error.code : "provider_test_failed",
            message: error instanceof Error ? error.message : "Account test failed",
            retryable: error instanceof ProviderError ? error.retryable : false
          }
        };
      }
    }
  );

  app.post(
    "/admin/v1/provider-instances/:id/test-model",
    {
      preHandler: adminAuth
    },
    async (request) => {
      const params = { id: parseIdParam(request) };
      const body = providerModelTestSchema.parse(request.body ?? {});
      const startedAt = performance.now();
      const providerInstance = app.providerRuntimeRegistry.getProviderInstance(params.id);

      if (!providerInstance) {
        throw new NotFoundError(`Provider instance ${params.id} not found`);
      }

      const accountPool = app.providerRuntimeRegistry.getAccountPool(providerInstance.id);
      const account = accountPool?.listAccounts().find((item) => item.status === "active");

      if (!account) {
        throw new NotFoundError(`No active account found for provider instance ${providerInstance.id}`);
      }

      const adapter = app.providerRegistry.getAdapter(providerInstance.type);
      const secret = app.secretService.getSecretForAccount(account.id);
      const credentialPayload = secret
        ? app.secretService.decryptSecretPayload(secret)
        : {};

      // Resolve model mapping: publicModel → upstreamModel
      // Phase 31 — multiple channels may serve the same publicModel; pick the one
      // belonging to THIS instance so upstreamModel formatting matches.
      const mapping =
        app.modelRegistry
          .listModelMappings()
          .find(
            (m) => m.providerInstanceId === providerInstance.id && m.publicModel === body.model
          ) ?? app.modelRegistry.get(body.model);
      const upstreamModel = mapping?.upstreamModel ?? body.model;

      try {
        const response = await adapter.chatCompletions(
          {
            model: upstreamModel,
            messages: [
              {
                role: "user",
                content: body.prompt
              }
            ],
            max_tokens: body.maxTokens,
            stream: false
          },
          {
            providerInstance,
            account,
            requestId: request.id,
            credentialPayload
          }
        );

        if (Symbol.asyncIterator in (response as Record<PropertyKey, unknown>)) {
          throw new ProviderError({
            code: "provider_bad_response",
            message: "Model test expected a non-streaming provider response",
            retryable: false,
            statusCode: 502
          });
        }
        const normalizedResponse = response as {
          choices?: Array<{ message?: { content?: string } }>;
        };

        return {
          ok: true,
          accountId: account.id,
          providerType: providerInstance.type,
          providerInstanceId: providerInstance.id,
          upstreamModel: body.model,
          durationMs: Math.round((performance.now() - startedAt) * 10) / 10,
          preview: normalizedResponse.choices?.[0]?.message?.content ?? ""
        };
      } catch (error) {
        return {
          ok: false,
          accountId: account.id,
          providerType: providerInstance.type,
          providerInstanceId: providerInstance.id,
          upstreamModel: body.model,
          durationMs: Math.round((performance.now() - startedAt) * 10) / 10,
          error: {
            code: error instanceof ProviderError ? error.code : "provider_model_test_failed",
            message: error instanceof Error ? error.message : "Model test failed",
            retryable: error instanceof ProviderError ? error.retryable : false
          }
        };
      }
    }
  );

  // ─── Batch Provider Testing ─────────────────────────────────

  app.post(
    "/admin/v1/test-all",
    { preHandler: adminAuth },
    async (request) => {
      const instances = app.providerRuntimeRegistry.listProviderInstances()
        .filter((inst) => inst.enabled);

      const results: Array<{
        providerInstanceId: string;
        type: string;
        name: string;
        status: "ok" | "degraded" | "down" | "error";
        message?: string;
        durationMs: number;
      }> = [];

      for (const inst of instances) {
        const adapter = app.providerRegistry.getAdapter(inst.type);
        if (!adapter) {
          results.push({
            providerInstanceId: inst.id,
            type: inst.type,
            name: inst.name,
            status: "error",
            message: "No adapter registered",
            durationMs: 0,
          });
          continue;
        }

        // Find a credential for health check
        const pool = app.providerRuntimeRegistry.getAccountPool(inst.id);
        const accounts = pool ? pool.listAccounts().filter((a) => a.status !== "disabled") : [];
        const account = accounts[0];
        const secret = account ? app.secretService.getSecretForAccount(account.id) : undefined;
        const credentialPayload = secret
          ? app.secretService.decryptSecretPayload(secret)
          : {};

        const start = Date.now();
        try {
          const health = await adapter.healthCheck({
            providerInstance: inst,
            credentialPayload,
          });
          const durationMs = Date.now() - start;
          // Phase 29 — persist test result on the instance
          app.providerRuntimeRegistry.updateProviderInstance(inst.id, {
            lastTestAt: new Date(),
            lastTestDurationMs: durationMs,
            lastTestStatus: health.status
          });
          results.push({
            providerInstanceId: inst.id,
            type: inst.type,
            name: inst.name,
            status: health.status,
            message: health.message,
            durationMs,
          });
        } catch (err) {
          const durationMs = Date.now() - start;
          app.providerRuntimeRegistry.updateProviderInstance(inst.id, {
            lastTestAt: new Date(),
            lastTestDurationMs: durationMs,
            lastTestStatus: "error"
          });
          results.push({
            providerInstanceId: inst.id,
            type: inst.type,
            name: inst.name,
            status: "error",
            message: err instanceof Error ? err.message : "Unknown error",
            durationMs,
          });
        }
      }

      recordAudit(app, request, "provider.test_all", "provider_instance", "*",);

      const ok = results.filter((r) => r.status === "ok").length;
      const degraded = results.filter((r) => r.status === "degraded").length;
      const down = results.filter((r) => r.status === "down" || r.status === "error").length;

      return {
        summary: { total: results.length, ok, degraded, down },
        results,
      };
    }
  );

  app.post(
    "/admin/v1/provider-instances/:id/test",
    { preHandler: adminAuth },
    async (request, reply) => {
      const params = request.params as { id: string };
      const inst = app.providerRuntimeRegistry.getProviderInstance(params.id);

      if (!inst) {
        return reply.code(404).send({
          error: { message: `Provider instance "${params.id}" not found`, code: "not_found" }
        });
      }

      const adapter = app.providerRegistry.getAdapter(inst.type);
      if (!adapter) {
        return reply.code(400).send({
          error: { message: `No adapter for type "${inst.type}"`, code: "no_adapter" }
        });
      }

      const pool = app.providerRuntimeRegistry.getAccountPool(inst.id);
      const accounts = pool ? pool.listAccounts().filter((a) => a.status !== "disabled") : [];
      const account = accounts[0];
      const secret = account ? app.secretService.getSecretForAccount(account.id) : undefined;
      const credentialPayload = secret
        ? app.secretService.decryptSecretPayload(secret)
        : {};

      const start = Date.now();
      try {
        const health = await adapter.healthCheck({
          providerInstance: inst,
          credentialPayload,
        });
        return {
          providerInstanceId: inst.id,
          type: inst.type,
          name: inst.name,
          status: health.status,
          message: health.message,
          durationMs: Date.now() - start,
        };
      } catch (err) {
        return {
          providerInstanceId: inst.id,
          type: inst.type,
          name: inst.name,
          status: "error",
          message: err instanceof Error ? err.message : "Unknown error",
          durationMs: Date.now() - start,
        };
      }
    }
  );

  // ─── Model Sync from Upstream ───────────────────────────────

  app.post(
    "/admin/v1/provider-instances/:id/sync-models",
    { preHandler: adminAuth },
    async (request, reply) => {
      const params = request.params as { id: string };
      const inst = app.providerRuntimeRegistry.getProviderInstance(params.id);

      if (!inst) {
        return reply.code(404).send({
          error: { message: `Provider instance "${params.id}" not found`, code: "not_found" }
        });
      }

      const adapter = app.providerRegistry.getAdapter(inst.type);
      if (!adapter) {
        return reply.code(400).send({
          error: { message: `No adapter for type "${inst.type}"`, code: "no_adapter" }
        });
      }

      // Get credentials for the first active account
      const pool = app.providerRuntimeRegistry.getAccountPool(inst.id);
      const accounts = pool ? pool.listAccounts().filter((a) => a.status !== "disabled") : [];
      const account = accounts[0];
      const secret = account ? app.secretService.getSecretForAccount(account.id) : undefined;
      const credentialPayload = secret
        ? app.secretService.decryptSecretPayload(secret)
        : {};

      try {
        const upstreamModels = await adapter.listModels({
          providerInstance: inst,
          credentialPayload,
        });

        // Compare with existing model mappings for this provider
        const existingMappings = app.modelRegistry.listModelMappings()
          .filter((m) => m.providerInstanceId === inst.id);
        const existingUpstream = new Set(existingMappings.map((m) => m.upstreamModel));

        const newModels = upstreamModels.filter((m) => !existingUpstream.has(m.upstreamModel));
        const removedModels = existingMappings.filter(
          (m) => !upstreamModels.some((u) => u.upstreamModel === m.upstreamModel)
        );

        // Auto-create option
        const body = request.body as { autoCreate?: boolean } | null;
        const created: string[] = [];

        if (body?.autoCreate) {
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
                enabled: true,
              });
              created.push(model.id);
            } catch {
              // Already exists — skip
            }
          }
        }

        recordAudit(app, request, "provider.sync_models", "provider_instance", params.id,);

        return {
          providerInstanceId: inst.id,
          discovered: upstreamModels.length,
          new: newModels.map((m) => ({ id: m.id, upstreamModel: m.upstreamModel })),
          removed: removedModels.map((m) => ({ id: m.id, publicModel: m.publicModel })),
          autoCreated: created,
        };
      } catch (err) {
        return reply.code(500).send({
          error: {
            message: err instanceof Error ? err.message : "Failed to sync models",
            code: "sync_failed"
          }
        });
      }
    }
  );
}
