/**
 * Admin account routes — account CRUD, enable/disable, credential rotation,
 * reset-suspension, quota, and refresh-session. Extracted verbatim from
 * routes/admin.ts as part of admin-routes-decompose.
 *
 * @module routes/admin/accounts
 */
import { z } from "zod";
import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { AppConfig } from "../../config.js";
import { createAdminAuthMiddleware } from "../../middleware/adminAuth.js";
import { KiroAuthClient } from "../../providers/adapters/kiro/KiroAuthClient.js";
import { NotFoundError } from "../../errors/NotFoundError.js";
import type { ProviderAccount } from "../../providers/base/ProviderAccount.js";
import { findAccountPoolForAccount, parseIdParam, recordAudit } from "./helpers.js";

const accountCreateSchema = z.object({
  id: z.string().min(1),
  providerInstanceId: z.string().min(1),
  providerType: z.string().min(1).optional(),
  displayName: z.string().min(1),
  owner: z.string().min(1).optional(),
  credentialType: z.enum([
    "api_key",
    "bearer_token",
    "oauth",
    "refresh_token",
    "session_cookie",
    "custom_json"
  ]),
  credentialPayload: z.record(z.unknown()),
  maxConcurrency: z.number().int().positive().default(3),
  weight: z.number().int().positive().default(1),
  allowedModels: z.array(z.string().min(1)).optional(),
  tags: z.array(z.string().min(1)).optional()
});

const accountPatchSchema = z.object({
  displayName: z.string().min(1).optional(),
  owner: z.string().min(1).optional(),
  maxConcurrency: z.number().int().positive().optional(),
  weight: z.number().int().positive().optional(),
  allowedModels: z.array(z.string().min(1)).optional(),
  tags: z.array(z.string().min(1)).optional()
});

const credentialRotateSchema = z.object({
  credentialType: z.enum([
    "api_key",
    "bearer_token",
    "oauth",
    "refresh_token",
    "session_cookie",
    "custom_json"
  ]),
  credentialPayload: z.record(z.unknown())
});

export async function registerAdminAccountRoutes(
  app: FastifyInstance,
  config: AppConfig
): Promise<void> {
  const adminAuth = createAdminAuthMiddleware(config);

  // PLACEHOLDER_ACCOUNT_ROUTES

  app.get("/admin/v1/accounts", { preHandler: adminAuth }, async () => {
    // Order accounts by `priority` for display (lower = earlier). Accounts
    // without a priority keep insertion order, after prioritized ones.
    const ordered = app.providerRuntimeRegistry.listAccounts()
      .map((account, index) => ({ account, index }))
      .sort((a, b) => {
        const pa = a.account.priority ?? Number.MAX_SAFE_INTEGER;
        const pb = b.account.priority ?? Number.MAX_SAFE_INTEGER;
        return pa - pb || a.index - b.index;
      })
      .map((x) => x.account);
    return {
      data: ordered.map((account) => {
        const secret = app.secretService.getSecretForAccount(account.id);
        const payload = secret ? app.secretService.decryptSecretPayload(secret) : null;
        const p = payload as Record<string, unknown> | null;
        let machineId = p?.machineId as string | undefined;
        if (!machineId && p?.refreshToken && typeof p.refreshToken === "string") {
          machineId = createHash("sha256").update(p.refreshToken).digest("hex");
        }
        if (!machineId && account.providerType === "kiro") {
          machineId = createHash("sha256").update(account.id).digest("hex");
        }
        return {
          ...account,
          credentialRef: account.credentialRef ? "[REDACTED]" : undefined,
          metadata: {
            ...account.metadata,
            ...(machineId ? { machineId } : {}),
          },
          tokenStatus: secret ? {
            expiresAt: secret.expiresAt?.toISOString() ?? null,
            lastRefreshedAt: secret.updatedAt?.toISOString() ?? null,
            credentialType: secret.credentialType,
          } : null,
          quota: app.accountQuotaService ? app.accountQuotaService.getSnapshot(account.id) : null,
        };
      })
    };
  });

  app.post("/admin/v1/accounts", { preHandler: adminAuth }, async (request) => {
    const body = accountCreateSchema.parse(request.body);
    const providerInstance = app.providerRuntimeRegistry.getProviderInstance(body.providerInstanceId);

    if (!providerInstance) {
      throw new NotFoundError(`Provider instance ${body.providerInstanceId} not found`);
    }

    const accountPool = app.providerRuntimeRegistry.getAccountPool(providerInstance.id);
    if (!accountPool) {
      throw new NotFoundError(`Account pool ${providerInstance.id} not found`);
    }

    const now = new Date();
    const credentialRef = `secret_${body.id}`;
    const account: ProviderAccount = {
      id: body.id,
      providerInstanceId: providerInstance.id,
      providerType: body.providerType ?? providerInstance.type,
      displayName: body.displayName,
      status: "active",
      weight: body.weight,
      maxConcurrency: body.maxConcurrency,
      credentialRef,
      allowedModels: body.allowedModels,
      tags: body.tags,
      owner: body.owner,
      runtime: { activeRequests: 0, totalRequests: 0, failedRequests: 0, consecutiveFailures: 0 },
      createdAt: now,
      updatedAt: now
    };

    // Auto-refresh Kiro token when adding with refreshToken (skip for api_key auth)
    let finalCredentialPayload = body.credentialPayload;
    const effectiveType = body.providerType ?? providerInstance.type;
    const kiroCredential = body.credentialPayload as Record<string, unknown>;
    const isApiKeyAuth = kiroCredential.authMethod === "api_key" || kiroCredential.kiroApiKey;
    if (effectiveType === "kiro" && !isApiKeyAuth && body.credentialPayload.refreshToken && typeof body.credentialPayload.refreshToken === "string") {
      try {
        const token = await new KiroAuthClient().refreshToken({
          refreshToken: kiroCredential.refreshToken as string,
          clientId: kiroCredential.clientId as string | undefined,
          clientSecret: kiroCredential.clientSecret as string | undefined,
          region: (kiroCredential.region as string) ?? "us-east-1",
          authMethod: (kiroCredential.authMethod as "social" | "idc") ?? (kiroCredential.clientId ? "idc" : "social")
        });
        finalCredentialPayload = {
          ...kiroCredential,
          accessToken: token.accessToken,
          refreshToken: token.refreshToken ?? kiroCredential.refreshToken,
          expiresAt: token.expiresAt ?? (token.expiresIn ? new Date(Date.now() + token.expiresIn * 1000).toISOString() : undefined),
          profileArn: token.profileArn,
          tokenType: token.tokenType
        };
      } catch {
        // If refresh fails, store as-is — user can refresh later
      }
    }
    // For API key auth, set accessToken = kiroApiKey for direct use
    if (effectiveType === "kiro" && isApiKeyAuth && kiroCredential.kiroApiKey) {
      finalCredentialPayload = { ...kiroCredential, accessToken: kiroCredential.kiroApiKey as string };
    }

    app.secretService.addCredentialPayload({
      id: credentialRef,
      accountId: account.id,
      credentialType: body.credentialType,
      credentialPayload: finalCredentialPayload
    });
    accountPool.addAccount(account);
    recordAudit(app, request, "account.create", "account", account.id);
    app.persistState();

    return { ...account, credentialRef: "[REDACTED]" };
  });

  // PLACEHOLDER_ACCOUNT_ROUTES_2

  app.post("/admin/v1/accounts/:id/enable", { preHandler: adminAuth }, async (request) => {
    const params = { id: parseIdParam(request) };
    const accountPool = findAccountPoolForAccount(app, params.id);
    accountPool.enable(params.id);
    recordAudit(app, request, "account.enable", "account", params.id);
    app.persistState();
    return { status: "ok" };
  });

  app.patch("/admin/v1/accounts/:id", { preHandler: adminAuth }, async (request) => {
    const params = { id: parseIdParam(request) };
    const patch = accountPatchSchema.parse(request.body);
    const accountPool = findAccountPoolForAccount(app, params.id);
    const updated = accountPool.updateAccount(params.id, patch);
    recordAudit(app, request, "account.update", "account", params.id);
    app.persistState();
    return { ...updated, credentialRef: updated.credentialRef ? "[REDACTED]" : undefined };
  });

  app.delete("/admin/v1/accounts/:id", { preHandler: adminAuth }, async (request) => {
    const params = { id: parseIdParam(request) };
    const accountPool = findAccountPoolForAccount(app, params.id);
    const removed = accountPool.removeAccount(params.id);
    app.secretService.deleteSecretForAccount(params.id);
    recordAudit(app, request, "account.delete", "account", params.id);
    app.persistState();
    return { ...removed, credentialRef: removed.credentialRef ? "[REDACTED]" : undefined };
  });

  app.post("/admin/v1/accounts/:id/credential", { preHandler: adminAuth }, async (request) => {
    const params = { id: parseIdParam(request) };
    const body = credentialRotateSchema.parse(request.body);
    const accountPool = findAccountPoolForAccount(app, params.id);
    const account = accountPool.getAccount(params.id);
    if (!account) {
      throw new NotFoundError(`Account ${params.id} not found`);
    }
    app.secretService.addCredentialPayload({
      id: account.credentialRef,
      accountId: account.id,
      credentialType: body.credentialType,
      credentialPayload: body.credentialPayload
    });
    recordAudit(app, request, "account.credential.rotate", "account", params.id);
    app.persistState();
    return { status: "ok" };
  });

  app.post("/admin/v1/accounts/:id/disable", { preHandler: adminAuth }, async (request) => {
    const params = { id: parseIdParam(request) };
    const accountPool = findAccountPoolForAccount(app, params.id);
    accountPool.disable(params.id, "disabled by admin");
    recordAudit(app, request, "account.disable", "account", params.id);
    app.persistState();
    return { status: "ok" };
  });

  app.post("/admin/v1/accounts/:id/reset-suspension", { preHandler: adminAuth }, async (request) => {
    const params = { id: parseIdParam(request) };
    const accountPool = findAccountPoolForAccount(app, params.id);
    const account = accountPool.getAccount(params.id);
    if (!account) {
      throw new NotFoundError(`Account ${params.id} not found`);
    }
    accountPool.enable(params.id);
    const secret = app.secretService.getSecretForAccount(params.id);
    if (secret) {
      const payload = app.secretService.decryptSecretPayload(secret) as Record<string, unknown>;
      delete payload.suspendedAt;
      delete payload.suspensionReason;
      app.secretService.updateSecretPayload(secret.id, payload);
    }
    recordAudit(app, request, "account.reset_suspension", "account", params.id);
    app.persistState();
    return { status: "ok", message: "Suspension cleared, account re-enabled" };
  });

  app.get("/admin/v1/accounts/:id/quota", { preHandler: adminAuth }, async (request) => {
    const params = { id: parseIdParam(request) };
    if (!app.accountQuotaService) {
      return { data: { requests: 0, tokens: 0, exhausted: false, dailyRequestLimit: 0, dailyTokenLimit: 0 } };
    }
    const snapshot = app.accountQuotaService.getSnapshot(params.id);
    return { data: snapshot };
  });

  app.post("/admin/v1/accounts/:id/refresh-session", { preHandler: adminAuth }, async (request, reply) => {
    const params = { id: parseIdParam(request) };
    const account = app.providerRuntimeRegistry.getAccount(params.id);
    if (!account) {
      await reply.code(404).send({
        error: { type: "not_found", message: `Account ${params.id} not found`, code: "account_not_found" }
      });
      return;
    }

    const providerInstance = app.providerRuntimeRegistry.getProviderInstance(account.providerInstanceId);
    if (!providerInstance) {
      await reply.code(404).send({
        error: { type: "not_found", message: "Provider instance not found", code: "provider_instance_not_found" }
      });
      return;
    }

    const adapter = app.providerRegistry.getAdapter(providerInstance.type);
    if (!adapter.refreshSession) {
      await reply.code(400).send({
        error: { type: "unsupported", message: "Provider does not support session refresh", code: "refresh_unsupported" }
      });
      return;
    }

    const secret = app.secretService.getSecretForAccount(params.id);
    const credentialPayload = secret ? app.secretService.decryptSecretPayload(secret) : {};

    const result = await adapter.refreshSession(account, { providerInstance, credentialPayload });

    if (result.refreshed && result.credentialPayload && secret) {
      app.secretService.updateSecretPayload(secret.id, result.credentialPayload);
    }

    if (!result.refreshed && result.authError) {
      try {
        app.providerRuntimeRegistry.setAccountStatus(params.id, "disabled");
      } catch { /* ignore */ }
    }

    recordAudit(app, request, "account.refresh_session", "account", params.id);
    return result;
  });
}
