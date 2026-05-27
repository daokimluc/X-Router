import { z } from "zod";
import { readFile, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { AppConfig } from "../config.js";
import { createAdminAuthMiddleware } from "../middleware/adminAuth.js";
import { AccountPool } from "../account-pool/AccountPool.js";
import { createAccountSelectionStrategy } from "../account-pool/strategyFactory.js";
import { KiroAuthClient, applyKiroToken } from "../providers/adapters/kiro/KiroAuthClient.js";
import { ProviderError } from "../providers/base/ProviderErrors.js";
import {
  completeOAuthCallbackFromUrl,
  createOAuthPendingAccount,
  exchangeOAuthCallbackAccount,
  getOAuthCallback
} from "./oauth.js";
import {
  startOAuthPKCEFlow
} from "../providers/adapters/oauth-pkce/OAuthPKCECallbackHandler.js";
import type { ProviderAccount } from "../providers/base/ProviderAccount.js";
import type { ProviderCapabilityFlag } from "../providers/base/ProviderCapabilities.js";
import type { ProviderInstance } from "../providers/base/ProviderInstance.js";

const providerInstancePatchSchema = z.object({
  enabled: z.boolean().optional(),
  name: z.string().min(1).optional(),
  priority: z.number().optional(),
  accountSelectionStrategy: z
    .enum([
      "round_robin",
      "weighted_round_robin",
      "least_busy",
      "lowest_error_rate",
      "lowest_latency"
    ])
    .optional()
});
const capabilitySchema = z.enum([
  "chat",
  "messages",
  "streaming",
  "tool_calling",
  "json_mode",
  "image_input"
]);
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
      "lowest_latency"
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
const apiKeyCreateSchema = z.object({
  owner: z.string().min(1).optional(),
  teamId: z.string().min(1).optional(),
  rpmLimit: z.number().int().min(0).optional(),
  dailyLimit: z.number().int().min(0).optional(),
  dailyTokenLimit: z.number().int().min(0).optional()
});
const configDraftSchema = z.object({
  config: z.record(z.unknown())
});
const rollbackParamsSchema = z.object({
  id: z.string().min(1)
});
const oauthStateParamsSchema = z.object({
  state: z.string().min(1)
});
const oauthPkceStartSchema = z.object({
  providerType: z.string().min(1),
  providerInstanceId: z.string().min(1),
  accountId: z.string().min(1),
  displayName: z.string().min(1),
  owner: z.string().min(1).optional(),
  maxConcurrency: z.number().int().positive().default(3),
  weight: z.number().int().positive().default(1),
  allowedModels: z.array(z.string().min(1)).optional(),
  tags: z.array(z.string().min(1)).optional(),
  authorizationEndpoint: z.string().url(),
  redirectUri: z.string().url(),
  scope: z.string().optional(),
  redirectFrom: z.string().optional(),
  clientId: z.string().optional(),
  extraParams: z.record(z.string()).optional()
});
const oauthGenericStartSchema = z.object({
  providerType: z.string().min(1),
  displayName: z.string().min(1).optional(),
  owner: z.string().min(1).optional(),
  maxConcurrency: z.number().int().positive().default(5),
  weight: z.number().int().positive().default(1),
  allowedModels: z.array(z.string().min(1)).optional(),
  tags: z.array(z.string().min(1)).optional()
});
const oauthManualCallbackSchema = z.object({
  state: z.string().min(1).optional(),
  callbackUrl: z.string().min(1)
});
const kiroLocalImportSchema = z.object({
  providerInstanceId: z.string().min(1),
  accountId: z.string().min(1),
  displayName: z.string().min(1),
  owner: z.string().min(1).optional(),
  maxConcurrency: z.number().int().positive().default(3),
  weight: z.number().int().positive().default(1),
  allowedModels: z.array(z.string().min(1)).optional(),
  tags: z.array(z.string().min(1)).optional(),
  region: z.string().min(1).default("us-east-1")
});
const kiroCockpitImportSchema = z.object({
  providerInstanceId: z.string().min(1),
  owner: z.string().min(1).optional(),
  maxConcurrency: z.number().int().positive().default(3),
  weight: z.number().int().positive().default(1),
  allowedModels: z.array(z.string().min(1)).optional(),
  tags: z.array(z.string().min(1)).optional(),
  region: z.string().min(1).default("us-east-1")
});
const windsurfLocalImportSchema = z.object({
  providerInstanceId: z.string().min(1),
  accountId: z.string().min(1),
  displayName: z.string().min(1),
  owner: z.string().min(1).optional(),
  maxConcurrency: z.number().int().positive().default(3),
  weight: z.number().int().positive().default(1),
  allowedModels: z.array(z.string().min(1)).optional(),
  tags: z.array(z.string().min(1)).optional()
});
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

export async function registerAdminRoutes(
  app: FastifyInstance,
  config: AppConfig
): Promise<void> {
  const adminAuth = createAdminAuthMiddleware(config);

  app.get(
    "/admin/v1/oauth/pkce/start",
    {
      preHandler: adminAuth
    },
    async () => {
      return {
        data: {
          redirectUri: "http://127.0.0.1:3100/oauth/callback",
          kiroAuthorizationEndpoint: "https://app.kiro.dev/signin",
          redirectFrom: "KiroIDE"
        }
      };
    }
  );

  app.post(
    "/admin/v1/oauth/pkce/start",
    {
      preHandler: adminAuth
    },
    async (request) => {
      const body = oauthPkceStartSchema.parse(request.body);
      const pending = createOAuthPendingAccount(body);

      app.adminAuditService.record({
        action: "oauth.pkce_start",
        actorKeyHash: request.adminAuth?.apiKeyHash,
        targetType: "provider_instance",
        targetId: body.providerInstanceId
      });

      return {
        data: {
          state: pending.state,
          codeChallenge: pending.codeChallenge,
          authorizationUrl: pending.authorizationUrl,
          accountId: pending.accountId,
          redirectUri: pending.redirectUri
        }
      };
    }
  );

  // ============================================================================
  // POST /admin/oauth/start — Generic OAuth PKCE flow start
  // Accepts providerType, calls OAuthPKCEAdapter.startOAuthFlow(),
  // stores pending session (state → codeVerifier mapping), returns authorizationUrl.
  // Sessions expire after 10 minutes.
  // ============================================================================
  app.post(
    "/admin/oauth/start",
    {
      preHandler: adminAuth
    },
    async (request, reply) => {
      const body = oauthGenericStartSchema.parse(request.body);

      try {
        const result = startOAuthPKCEFlow(
          body.providerType,
          undefined, // oauthConfig looked up by providerType internally
          {
            displayName: body.displayName ?? `${body.providerType} account`,
            owner: body.owner,
            maxConcurrency: body.maxConcurrency,
            weight: body.weight,
            allowedModels: body.allowedModels,
            tags: body.tags,
          }
        );

        app.adminAuditService.record({
          action: "oauth.generic_pkce_start",
          actorKeyHash: request.adminAuth?.apiKeyHash,
          targetType: "oauth_flow",
          targetId: result.state
        });

        return {
          data: {
            authorizationUrl: result.authorizationUrl,
            state: result.state,
            providerType: body.providerType,
            expiresIn: 600 // 10 minutes in seconds
          }
        };
      } catch (error) {
        reply.code(400);
        return {
          error: {
            type: "invalid_request",
            message: error instanceof Error ? error.message : "Failed to start OAuth flow",
            code: "oauth_start_failed"
          }
        };
      }
    }
  );

  app.get(
    "/admin/v1/oauth/callbacks/:state",
    {
      preHandler: adminAuth
    },
    async (request, reply) => {
      const params = oauthStateParamsSchema.parse(request.params);
      const callback = getOAuthCallback(params.state);

      if (!callback) {
        reply.code(404);
        return {
          error: {
            type: "not_found",
            message: "OAuth callback not found",
            code: "oauth_callback_not_found"
          }
        };
      }

      return {
        data: callback
      };
    }
  );

  app.post(
    "/admin/v1/oauth/callbacks/:state/exchange",
    {
      preHandler: adminAuth
    },
    async (request, reply) => {
      const params = oauthStateParamsSchema.parse(request.params);

      try {
        const callback = await exchangeOAuthCallbackAccount(app, params.state);
        return {
          data: callback
        };
      } catch (error) {
        reply.code(400);
        return {
          error: {
            type: "provider_error",
            message: error instanceof Error ? error.message : "OAuth token exchange failed",
            code: "oauth_token_exchange_failed"
          }
        };
      }
    }
  );

  app.post(
    "/admin/v1/oauth/callbacks/manual",
    {
      preHandler: adminAuth
    },
    async (request, reply) => {
      const body = oauthManualCallbackSchema.parse(request.body);

      try {
        const callback = await completeOAuthCallbackFromUrl(
          app,
          body.callbackUrl,
          body.state
        );
        return {
          data: callback
        };
      } catch (error) {
        reply.code(400);
        return {
          error: {
            type: "provider_error",
            message: error instanceof Error ? error.message : "OAuth callback import failed",
            code: "oauth_callback_import_failed"
          }
        };
      }
    }
  );

  app.post(
    "/admin/v1/oauth/kiro/import-local",
    {
      preHandler: adminAuth
    },
    async (request, reply) => {
      const body = kiroLocalImportSchema.parse(request.body);
      const providerInstance = app.providerRuntimeRegistry.getProviderInstance(
        body.providerInstanceId
      );

      if (!providerInstance || providerInstance.type !== "kiro") {
        reply.code(404);
        return {
          error: {
            type: "not_found",
            message: "Kiro provider instance not found",
            code: "provider_instance_not_found"
          }
        };
      }

      const accountPool = app.providerRuntimeRegistry.getAccountPool(providerInstance.id);
      if (!accountPool) {
        throw new Error(`Account pool ${providerInstance.id} not found`);
      }

      const detected = await findKiroRefreshToken();
      if (!detected) {
        reply.code(404);
        return {
          error: {
            type: "not_found",
            message: "Kiro local refresh token not found. Login in Kiro app first, then retry.",
            code: "kiro_local_token_not_found"
          }
        };
      }

      const baseCredential = {
        provider: "kiro",
        grantType: "import_refresh_token",
        refreshToken: detected.refreshToken,
        region: body.region,
        source: detected.source
      };
      const token = await new KiroAuthClient().refreshToken(baseCredential);
      const credentialPayload = {
        ...baseCredential,
        ...applyKiroToken(baseCredential, token),
        tokenType: token.tokenType,
        importedAt: new Date().toISOString()
      };
      const now = new Date();
      const credentialRef = `secret_${body.accountId}`;
      const account: ProviderAccount = {
        id: body.accountId,
        providerInstanceId: providerInstance.id,
        providerType: "kiro",
        displayName: body.displayName,
        status: "active",
        weight: body.weight,
        maxConcurrency: body.maxConcurrency,
        credentialRef,
        allowedModels: body.allowedModels,
        tags: body.tags,
        owner: body.owner,
        runtime: {
          activeRequests: 0,
          totalRequests: 0,
          failedRequests: 0,
          consecutiveFailures: 0
        },
        metadata: {
          authMethod: "local_import",
          tokenSource: detected.source
        },
        createdAt: now,
        updatedAt: now
      };

      app.secretService.addCredentialPayload({
        id: credentialRef,
        accountId: account.id,
        credentialType: "refresh_token",
        credentialPayload
      });
      accountPool.addAccount(account);
      app.adminAuditService.record({
        action: "account.kiro_import_local",
        actorKeyHash: request.adminAuth?.apiKeyHash,
        targetType: "account",
        targetId: account.id
      });
      await saveAdminRuntimeState(app);

      return {
        data: {
          ...account,
          credentialRef: "[REDACTED]"
        }
      };
    }
  );

  app.post(
    "/admin/v1/oauth/kiro/import-cockpit",
    {
      preHandler: adminAuth
    },
    async (request, reply) => {
      const body = kiroCockpitImportSchema.parse(request.body);
      const providerInstance = app.providerRuntimeRegistry.getProviderInstance(
        body.providerInstanceId
      );

      if (!providerInstance || providerInstance.type !== "kiro") {
        reply.code(404);
        return {
          error: {
            type: "not_found",
            message: "Kiro provider instance not found",
            code: "provider_instance_not_found"
          }
        };
      }

      const accountPool = app.providerRuntimeRegistry.getAccountPool(providerInstance.id);
      if (!accountPool) {
        throw new Error(`Account pool ${providerInstance.id} not found`);
      }

      const detected = await findKiroCockpitCredentials();
      if (detected.length === 0) {
        reply.code(404);
        return {
          error: {
            type: "not_found",
            message:
              "No Cockpit Kiro accounts found. Expected files in ~/.antigravity_cockpit/kiro_accounts.",
            code: "kiro_cockpit_accounts_not_found"
          }
        };
      }

      const now = new Date();
      const imported: ProviderAccount[] = [];

      for (const credential of detected) {
        const accountId = `account_${credential.id}`;
        const credentialRef = `secret_${accountId}`;
        const account: ProviderAccount = {
          id: accountId,
          providerInstanceId: providerInstance.id,
          providerType: "kiro",
          displayName: credential.email ?? credential.loginHint ?? credential.id,
          status: "active",
          weight: body.weight,
          maxConcurrency: body.maxConcurrency,
          credentialRef,
          allowedModels: body.allowedModels,
          tags: [...(body.tags ?? []), "cockpit"],
          owner: body.owner,
          runtime: {
            activeRequests: 0,
            totalRequests: 0,
            failedRequests: 0,
            consecutiveFailures: 0
          },
          metadata: {
            authMethod: "cockpit_import",
            tokenSource: credential.source,
            email: credential.email,
            planName: credential.planName,
            planTier: credential.planTier
          },
          createdAt: now,
          updatedAt: now
        };

        app.secretService.addCredentialPayload({
          id: credentialRef,
          accountId: account.id,
          credentialType: "refresh_token",
          credentialPayload: {
            provider: "kiro",
            accessToken: credential.accessToken,
            refreshToken: credential.refreshToken,
            expiresAt: credential.expiresAt,
            profileArn: credential.profileArn,
            tokenType: credential.tokenType,
            email: credential.email,
            loginHint: credential.loginHint,
            authMethod: "cockpit_import",
            region: body.region,
            source: credential.source,
            importedAt: now.toISOString()
          }
        });
        accountPool.addAccount(account);
        imported.push(account);
      }

      app.adminAuditService.record({
        action: "account.kiro_import_cockpit",
        actorKeyHash: request.adminAuth?.apiKeyHash,
        targetType: "provider_instance",
        targetId: providerInstance.id
      });
      await saveAdminRuntimeState(app);

      return {
        data: imported.map((account) => ({
          ...account,
          credentialRef: "[REDACTED]"
        }))
      };
    }
  );

  app.post(
    "/admin/v1/oauth/windsurf/import-local",
    {
      preHandler: adminAuth
    },
    async (request, reply) => {
      const body = windsurfLocalImportSchema.parse(request.body);
      const providerInstance = app.providerRuntimeRegistry.getProviderInstance(
        body.providerInstanceId
      );

      if (!providerInstance || providerInstance.type !== "windsurf") {
        reply.code(404);
        return {
          error: {
            type: "not_found",
            message: "Windsurf provider instance not found",
            code: "provider_instance_not_found"
          }
        };
      }

      const accountPool = app.providerRuntimeRegistry.getAccountPool(providerInstance.id);
      if (!accountPool) {
        throw new Error(`Account pool ${providerInstance.id} not found`);
      }

      const detected = await findWindsurfLocalCredential();
      if (!detected) {
        reply.code(404);
        return {
          error: {
            type: "not_found",
            message:
              "Windsurf local session not found. Login in Windsurf or Cockpit first, then retry.",
            code: "windsurf_local_token_not_found"
          }
        };
      }

      const now = new Date();
      const credentialRef = `secret_${body.accountId}`;
      const account: ProviderAccount = {
        id: body.accountId,
        providerInstanceId: providerInstance.id,
        providerType: "windsurf",
        displayName: body.displayName,
        status: "active",
        weight: body.weight,
        maxConcurrency: body.maxConcurrency,
        credentialRef,
        allowedModels: body.allowedModels,
        tags: body.tags,
        owner: body.owner,
        runtime: {
          activeRequests: 0,
          totalRequests: 0,
          failedRequests: 0,
          consecutiveFailures: 0
        },
        metadata: {
          authMethod: "local_import",
          tokenSource: detected.source,
          email: detected.email
        },
        createdAt: now,
        updatedAt: now
      };

      app.secretService.addCredentialPayload({
        id: credentialRef,
        accountId: account.id,
        credentialType: "bearer_token",
        credentialPayload: {
          provider: "windsurf",
          token: detected.token,
          accessToken: detected.token,
          apiKey: detected.apiKey,
          apiServerUrl: detected.apiServerUrl,
          email: detected.email,
          importedAt: now.toISOString(),
          source: detected.source,
          // Devin-specific fields
          isDevin: detected.isDevin,
          devinInfo: detected.devinInfo,
          teamId: detected.teamId
        }
      });
      accountPool.addAccount(account);
      app.adminAuditService.record({
        action: "account.windsurf_import_local",
        actorKeyHash: request.adminAuth?.apiKeyHash,
        targetType: "account",
        targetId: account.id
      });
      await saveAdminRuntimeState(app);

      return {
        data: {
          ...account,
          credentialRef: "[REDACTED]"
        }
      };
    }
  );

  app.get(
    "/admin/v1/provider-types",
    {
      preHandler: adminAuth
    },
    async () => {
      return {
        data: app.providerRegistry.listProviderTypes()
      };
    }
  );

  app.get(
    "/admin/v1/provider-instances",
    {
      preHandler: adminAuth
    },
    async () => {
      return {
        data: app.providerRuntimeRegistry.listProviderInstances()
      };
    }
  );

  app.post(
    "/admin/v1/provider-instances",
    {
      preHandler: adminAuth
    },
    async (request) => {
      const body = providerInstanceCreateSchema.parse(request.body);
      const now = new Date();
      const providerInstance: ProviderInstance = {
        ...body,
        createdAt: now,
        updatedAt: now
      };

      app.providerRuntimeRegistry.registerProviderInstance(providerInstance);

      if (!app.providerRuntimeRegistry.getAccountPool(providerInstance.id)) {
        app.providerRuntimeRegistry.registerAccountPool(
          providerInstance.id,
          new AccountPool(
            [],
            createAccountSelectionStrategy(providerInstance.accountSelectionStrategy)
          )
        );
      }

      app.adminAuditService.record({
        action: "provider_instance.create",
        actorKeyHash: request.adminAuth?.apiKeyHash,
        targetType: "provider_instance",
        targetId: providerInstance.id
      });

      return providerInstance;
    }
  );

  app.patch(
    "/admin/v1/provider-instances/:id",
    {
      preHandler: adminAuth
    },
    async (request) => {
      const params = z.object({ id: z.string().min(1) }).parse(request.params);
      const patch = providerInstancePatchSchema.parse(request.body);
      const updated = app.providerRuntimeRegistry.updateProviderInstance(
        params.id,
        patch
      );
      app.adminAuditService.record({
        action: "provider_instance.update",
        actorKeyHash: request.adminAuth?.apiKeyHash,
        targetType: "provider_instance",
        targetId: params.id
      });

      return updated;
    }
  );

  app.post(
    "/admin/v1/provider-instances/:id/circuit-breaker/reset",
    { preHandler: adminAuth },
    async (request) => {
      const params = z.object({ id: z.string().min(1) }).parse(request.params);
      app.circuitBreaker.reset(params.id);
      app.adminAuditService.record({
        action: "circuit_breaker.reset",
        actorKeyHash: request.adminAuth?.apiKeyHash,
        targetType: "provider_instance",
        targetId: params.id
      });
      return { ok: true, state: app.circuitBreaker.getCircuitState(params.id) };
    }
  );

  app.get(
    "/admin/v1/accounts",
    {
      preHandler: adminAuth
    },
    async () => {
      return {
        data: app.providerRuntimeRegistry.listAccounts().map((account) => {
          const secret = app.secretService.getSecretForAccount(account.id);
          return {
            ...account,
            credentialRef: account.credentialRef ? "[REDACTED]" : undefined,
            tokenStatus: secret ? {
              expiresAt: secret.expiresAt?.toISOString() ?? null,
              lastRefreshedAt: secret.updatedAt?.toISOString() ?? null,
              credentialType: secret.credentialType,
            } : null,
          };
        })
      };
    }
  );

  app.post(
    "/admin/v1/accounts",
    {
      preHandler: adminAuth
    },
    async (request) => {
      const body = accountCreateSchema.parse(request.body);
      const providerInstance = app.providerRuntimeRegistry.getProviderInstance(
        body.providerInstanceId
      );

      if (!providerInstance) {
        throw new Error(`Provider instance ${body.providerInstanceId} not found`);
      }

      const accountPool = app.providerRuntimeRegistry.getAccountPool(
        providerInstance.id
      );

      if (!accountPool) {
        throw new Error(`Account pool ${providerInstance.id} not found`);
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
        runtime: {
          activeRequests: 0,
          totalRequests: 0,
          failedRequests: 0,
          consecutiveFailures: 0
        },
        createdAt: now,
        updatedAt: now
      };

      app.secretService.addCredentialPayload({
        id: credentialRef,
        accountId: account.id,
        credentialType: body.credentialType,
        credentialPayload: body.credentialPayload
      });
      accountPool.addAccount(account);
      app.adminAuditService.record({
        action: "account.create",
        actorKeyHash: request.adminAuth?.apiKeyHash,
        targetType: "account",
        targetId: account.id
      });
      await saveAdminRuntimeState(app);

      return {
        ...account,
        credentialRef: "[REDACTED]"
      };
    }
  );

  app.post(
    "/admin/v1/accounts/:id/enable",
    {
      preHandler: adminAuth
    },
    async (request) => {
      const params = z.object({ id: z.string().min(1) }).parse(request.params);
      const accountPool = findAccountPoolForAccount(app, params.id);
      accountPool.enable(params.id);
      app.adminAuditService.record({
        action: "account.enable",
        actorKeyHash: request.adminAuth?.apiKeyHash,
        targetType: "account",
        targetId: params.id
      });
      await saveAdminRuntimeState(app);

      return {
        status: "ok"
      };
    }
  );

  app.patch(
    "/admin/v1/accounts/:id",
    {
      preHandler: adminAuth
    },
    async (request) => {
      const params = z.object({ id: z.string().min(1) }).parse(request.params);
      const patch = accountPatchSchema.parse(request.body);
      const accountPool = findAccountPoolForAccount(app, params.id);
      const updated = accountPool.updateAccount(params.id, patch);

      app.adminAuditService.record({
        action: "account.update",
        actorKeyHash: request.adminAuth?.apiKeyHash,
        targetType: "account",
        targetId: params.id
      });
      await saveAdminRuntimeState(app);

      return {
        ...updated,
        credentialRef: updated.credentialRef ? "[REDACTED]" : undefined
      };
    }
  );

  app.delete(
    "/admin/v1/accounts/:id",
    {
      preHandler: adminAuth
    },
    async (request) => {
      const params = z.object({ id: z.string().min(1) }).parse(request.params);
      const accountPool = findAccountPoolForAccount(app, params.id);
      const removed = accountPool.removeAccount(params.id);
      app.secretService.deleteSecretForAccount(params.id);

      app.adminAuditService.record({
        action: "account.delete",
        actorKeyHash: request.adminAuth?.apiKeyHash,
        targetType: "account",
        targetId: params.id
      });
      await saveAdminRuntimeState(app);

      return {
        ...removed,
        credentialRef: removed.credentialRef ? "[REDACTED]" : undefined
      };
    }
  );

  app.post(
    "/admin/v1/accounts/:id/credential",
    {
      preHandler: adminAuth
    },
    async (request) => {
      const params = z.object({ id: z.string().min(1) }).parse(request.params);
      const body = credentialRotateSchema.parse(request.body);
      const accountPool = findAccountPoolForAccount(app, params.id);
      const account = accountPool.getAccount(params.id);

      if (!account) {
        throw new Error(`Account ${params.id} not found`);
      }

      app.secretService.addCredentialPayload({
        id: account.credentialRef,
        accountId: account.id,
        credentialType: body.credentialType,
        credentialPayload: body.credentialPayload
      });
      app.adminAuditService.record({
        action: "account.credential.rotate",
        actorKeyHash: request.adminAuth?.apiKeyHash,
        targetType: "account",
        targetId: params.id
      });
      await saveAdminRuntimeState(app);

      return {
        status: "ok"
      };
    }
  );

  app.post(
    "/admin/v1/accounts/:id/disable",
    {
      preHandler: adminAuth
    },
    async (request) => {
      const params = z.object({ id: z.string().min(1) }).parse(request.params);
      const accountPool = findAccountPoolForAccount(app, params.id);
      accountPool.disable(params.id, "disabled by admin");
      app.adminAuditService.record({
        action: "account.disable",
        actorKeyHash: request.adminAuth?.apiKeyHash,
        targetType: "account",
        targetId: params.id
      });
      await saveAdminRuntimeState(app);

      return {
        status: "ok"
      };
    }
  );

  app.post(
    "/admin/v1/accounts/:id/refresh-session",
    {
      preHandler: adminAuth
    },
    async (request, reply) => {
      const params = z.object({ id: z.string().min(1) }).parse(request.params);
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
      const credentialPayload = secret
        ? app.secretService.decryptSecretPayload(secret)
        : {};

      const result = await adapter.refreshSession(account, {
        providerInstance,
        credentialPayload
      });

      // Persist refreshed credential if returned
      if (result.refreshed && result.credentialPayload && secret) {
        app.secretService.updateSecretPayload(secret.id, result.credentialPayload);
      }

      // Disable account if auth error during refresh
      if (!result.refreshed && result.authError) {
        try {
          app.providerRuntimeRegistry.setAccountStatus(params.id, "disabled");
        } catch { /* ignore */ }
      }

      app.adminAuditService.record({
        action: "account.refresh_session",
        actorKeyHash: request.adminAuth?.apiKeyHash,
        targetType: "account",
        targetId: params.id
      });

      return result;
    }
  );

  app.post(
    "/admin/v1/accounts/:id/test",
    {
      preHandler: adminAuth
    },
    async (request) => {
      const params = z.object({ id: z.string().min(1) }).parse(request.params);
      const body = accountTestSchema.parse(request.body ?? {});
      const startedAt = performance.now();
      const providerInstance = app.providerRuntimeRegistry
        .listProviderInstances()
        .find((instance) =>
          app.providerRuntimeRegistry.getAccountPool(instance.id)?.getAccount(params.id)
        );

      if (!providerInstance) {
        throw new Error(`Account ${params.id} not found`);
      }

      const accountPool = app.providerRuntimeRegistry.getAccountPool(providerInstance.id);
      const account = accountPool?.getAccount(params.id);

      if (!account) {
        throw new Error(`Account ${params.id} not found`);
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
      const params = z.object({ id: z.string().min(1) }).parse(request.params);
      const body = providerModelTestSchema.parse(request.body ?? {});
      const startedAt = performance.now();
      const providerInstance = app.providerRuntimeRegistry.getProviderInstance(params.id);

      if (!providerInstance) {
        throw new Error(`Provider instance ${params.id} not found`);
      }

      const accountPool = app.providerRuntimeRegistry.getAccountPool(providerInstance.id);
      const account = accountPool?.listAccounts().find((item) => item.status === "active");

      if (!account) {
        throw new Error(`No active account found for provider instance ${providerInstance.id}`);
      }

      const adapter = app.providerRegistry.getAdapter(providerInstance.type);
      const secret = app.secretService.getSecretForAccount(account.id);
      const credentialPayload = secret
        ? app.secretService.decryptSecretPayload(secret)
        : {};

      try {
        const response = await adapter.chatCompletions(
          {
            model: body.model,
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
          results.push({
            providerInstanceId: inst.id,
            type: inst.type,
            name: inst.name,
            status: health.status,
            message: health.message,
            durationMs: Date.now() - start,
          });
        } catch (err) {
          results.push({
            providerInstanceId: inst.id,
            type: inst.type,
            name: inst.name,
            status: "error",
            message: err instanceof Error ? err.message : "Unknown error",
            durationMs: Date.now() - start,
          });
        }
      }

      app.adminAuditService.record({
        action: "provider.test_all",
        actorKeyHash: request.adminAuth?.apiKeyHash,
        targetType: "provider_instance",
        targetId: "*",
      });

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

        app.adminAuditService.record({
          action: "provider.sync_models",
          actorKeyHash: request.adminAuth?.apiKeyHash,
          targetType: "provider_instance",
          targetId: params.id,
        });

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

  app.get(
    "/admin/v1/model-mappings",
    {
      preHandler: adminAuth
    },
    async () => {
      return {
        data: app.modelRegistry.listModelMappings()
      };
    }
  );

  app.post(
    "/admin/v1/model-mappings",
    {
      preHandler: adminAuth
    },
    async (request) => {
      const body = modelMappingCreateSchema.parse(request.body);
      const mapping = {
        ...body,
        capabilities: body.capabilities as ProviderCapabilityFlag[]
      };

      app.modelRegistry.register(mapping);
      app.adminAuditService.record({
        action: "model_mapping.create",
        actorKeyHash: request.adminAuth?.apiKeyHash,
        targetType: "model_mapping",
        targetId: mapping.id
      });
      await saveAdminRuntimeState(app);

      return mapping;
    }
  );

  app.patch(
    "/admin/v1/model-mappings/:id",
    {
      preHandler: adminAuth
    },
    async (request) => {
      const params = z.object({ id: z.string().min(1) }).parse(request.params);
      const patch = modelMappingPatchSchema.parse(request.body);
      const normalizedPatch = {
        ...patch,
        capabilities: patch.capabilities as ProviderCapabilityFlag[] | undefined
      };

      if (normalizedPatch.capabilities === undefined) {
        delete normalizedPatch.capabilities;
      }

      const updated = app.modelRegistry.updateById(params.id, normalizedPatch);

      app.adminAuditService.record({
        action: "model_mapping.update",
        actorKeyHash: request.adminAuth?.apiKeyHash,
        targetType: "model_mapping",
        targetId: params.id
      });
      await saveAdminRuntimeState(app);

      return updated;
    }
  );

  app.delete(
    "/admin/v1/model-mappings/:id",
    {
      preHandler: adminAuth
    },
    async (request) => {
      const params = z.object({ id: z.string().min(1) }).parse(request.params);
      const removed = app.modelRegistry.deleteById(params.id);

      app.adminAuditService.record({
        action: "model_mapping.delete",
        actorKeyHash: request.adminAuth?.apiKeyHash,
        targetType: "model_mapping",
        targetId: params.id
      });
      await saveAdminRuntimeState(app);

      return removed;
    }
  );

  // ─── Model Aliases ─────────────────────────────────────────

  app.get(
    "/admin/v1/model-aliases",
    { preHandler: adminAuth },
    async () => {
      return { data: app.modelRegistry.listAliases() };
    }
  );

  app.post(
    "/admin/v1/model-aliases",
    { preHandler: adminAuth },
    async (request) => {
      const body = z.object({
        alias: z.string().min(1).max(64),
        target: z.string().min(1).max(64)
      }).parse(request.body);

      app.modelRegistry.addAlias(body.alias, body.target);
      app.adminAuditService.record({
        action: "model_alias.create",
        actorKeyHash: request.adminAuth?.apiKeyHash,
        targetType: "model_alias",
        targetId: body.alias
      });
      await saveAdminRuntimeState(app);
      return { alias: body.alias, target: body.target };
    }
  );

  app.delete(
    "/admin/v1/model-aliases/:alias",
    { preHandler: adminAuth },
    async (request) => {
      const params = z.object({ alias: z.string().min(1) }).parse(request.params);
      app.modelRegistry.removeAlias(params.alias);
      app.adminAuditService.record({
        action: "model_alias.delete",
        actorKeyHash: request.adminAuth?.apiKeyHash,
        targetType: "model_alias",
        targetId: params.alias
      });
      await saveAdminRuntimeState(app);
      return { deleted: params.alias };
    }
  );

  app.get(
    "/admin/v1/routing-profiles",
    {
      preHandler: adminAuth
    },
    async () => {
      return {
        data: app.routingProfileRegistry.listRoutingProfiles()
      };
    }
  );

  app.post(
    "/admin/v1/routing-profiles",
    {
      preHandler: adminAuth
    },
    async (request) => {
      const body = routingProfileCreateSchema.parse(request.body);
      const profile = {
        ...body,
        requiredCapabilities: body.requiredCapabilities as ProviderCapabilityFlag[]
      };

      app.routingProfileRegistry.register(profile);
      app.adminAuditService.record({
        action: "routing_profile.create",
        actorKeyHash: request.adminAuth?.apiKeyHash,
        targetType: "routing_profile",
        targetId: profile.id
      });

      return profile;
    }
  );

  app.patch(
    "/admin/v1/routing-profiles/:id",
    {
      preHandler: adminAuth
    },
    async (request) => {
      const params = z.object({ id: z.string().min(1) }).parse(request.params);
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

      app.adminAuditService.record({
        action: "routing_profile.update",
        actorKeyHash: request.adminAuth?.apiKeyHash,
        targetType: "routing_profile",
        targetId: params.id
      });

      return updated;
    }
  );

  app.get(
    "/admin/v1/api-keys",
    {
      preHandler: adminAuth
    },
    async () => {
      return {
        data: app.apiKeyService.list().map((apiKey) => ({
          ...apiKey,
          limits: app.rateLimitService.getSnapshot(apiKey.keyHash)
        }))
      };
    }
  );

  app.post(
    "/admin/v1/api-keys",
    {
      preHandler: adminAuth
    },
    async (request) => {
      const body = apiKeyCreateSchema.parse(request.body ?? {});
      const apiKey = app.apiKeyService.create(body);
      app.adminAuditService.record({
        action: "api_key.create",
        actorKeyHash: request.adminAuth?.apiKeyHash,
        targetType: "api_key",
        targetId: apiKey.id
      });

      return apiKey;
    }
  );

  app.patch(
    "/admin/v1/api-keys/:id",
    {
      preHandler: adminAuth
    },
    async (request, reply) => {
      const params = z.object({ id: z.string().min(1) }).parse(request.params);
      const body = z.object({
        owner: z.string().optional(),
        teamId: z.string().optional(),
        rpmLimit: z.number().int().min(0).optional(),
        dailyLimit: z.number().int().min(0).optional(),
        dailyTokenLimit: z.number().int().min(0).optional(),
        enabled: z.boolean().optional()
      }).parse(request.body ?? {});
      const updated = app.apiKeyService.update(params.id, body);
      if (!updated) {
        await reply.code(404).send({ error: { type: "not_found", message: "Key not found" } });
        return;
      }
      return updated;
    }
  );

  app.get(
    "/admin/v1/api-keys/:id/reveal",
    {
      preHandler: adminAuth
    },
    async (request, reply) => {
      const params = z.object({ id: z.string().min(1) }).parse(request.params);
      const key = app.apiKeyService.reveal(params.id);
      if (!key) {
        await reply.code(404).send({ error: { type: "not_found", message: "Key not found" } });
        return;
      }
      app.adminAuditService.record({
        action: "api_key.reveal",
        actorKeyHash: request.adminAuth?.apiKeyHash,
        targetType: "api_key",
        targetId: params.id
      });
      return { key };
    }
  );

  app.post(
    "/admin/v1/api-keys/:id/enable",
    {
      preHandler: adminAuth
    },
    async (request) => {
      const params = z.object({ id: z.string().min(1) }).parse(request.params);
      const updated = app.apiKeyService.setEnabled(params.id, true);
      app.adminAuditService.record({
        action: "api_key.enable",
        actorKeyHash: request.adminAuth?.apiKeyHash,
        targetType: "api_key",
        targetId: params.id
      });

      return updated;
    }
  );

  app.post(
    "/admin/v1/api-keys/:id/disable",
    {
      preHandler: adminAuth
    },
    async (request) => {
      const params = z.object({ id: z.string().min(1) }).parse(request.params);
      const updated = app.apiKeyService.setEnabled(params.id, false);
      app.adminAuditService.record({
        action: "api_key.disable",
        actorKeyHash: request.adminAuth?.apiKeyHash,
        targetType: "api_key",
        targetId: params.id
      });

      return updated;
    }
  );

  app.delete(
    "/admin/v1/api-keys/:id",
    {
      preHandler: adminAuth
    },
    async (request, reply) => {
      const params = z.object({ id: z.string().min(1) }).parse(request.params);
      try {
        const removed = app.apiKeyService.delete(params.id);
        app.adminAuditService.record({
          action: "api_key.delete",
          actorKeyHash: request.adminAuth?.apiKeyHash,
          targetType: "api_key",
          targetId: params.id
        });
        await saveAdminRuntimeState(app);
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
    }
  );

  // ─── API Key Balance / Top-up ───────────────────────────────

  app.get(
    "/admin/v1/api-keys/:id/balance",
    { preHandler: adminAuth },
    async (request, reply) => {
      const params = z.object({ id: z.string().min(1) }).parse(request.params);
      const balance = app.apiKeyService.getBalance(params.id);
      if (balance === undefined) {
        return { id: params.id, balance: null, unlimited: true };
      }
      return { id: params.id, balance, unlimited: false };
    }
  );

  app.post(
    "/admin/v1/api-keys/:id/topup",
    { preHandler: adminAuth },
    async (request, reply) => {
      const params = z.object({ id: z.string().min(1) }).parse(request.params);
      const body = request.body as { amount?: number };

      if (typeof body.amount !== "number" || body.amount <= 0) {
        return reply.code(400).send({
          error: { message: "amount must be a positive number", code: "validation_error" }
        });
      }

      const updated = app.apiKeyService.topup(params.id, body.amount);
      if (!updated) {
        return reply.code(404).send({
          error: { message: `API key "${params.id}" not found`, code: "not_found" }
        });
      }

      app.adminAuditService.record({
        action: "api_key.topup",
        actorKeyHash: request.adminAuth?.apiKeyHash,
        targetType: "api_key",
        targetId: params.id,
      });

      return { id: params.id, balance: updated.balance, added: body.amount };
    }
  );

  // ─── Teams / Workspaces ──────────────────────────────────

  app.get(
    "/admin/v1/teams",
    { preHandler: adminAuth },
    async () => ({ data: app.teamService.list() })
  );

  app.post(
    "/admin/v1/teams",
    { preHandler: adminAuth },
    async (request) => {
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
      app.adminAuditService.record({
        action: "team.create",
        actorKeyHash: request.adminAuth?.apiKeyHash,
        targetType: "team",
        targetId: team.id
      });
      return team;
    }
  );

  app.patch(
    "/admin/v1/teams/:id",
    { preHandler: adminAuth },
    async (request) => {
      const params = z.object({ id: z.string().min(1) }).parse(request.params);
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
      app.adminAuditService.record({
        action: "team.update",
        actorKeyHash: request.adminAuth?.apiKeyHash,
        targetType: "team",
        targetId: params.id
      });
      return team;
    }
  );

  app.delete(
    "/admin/v1/teams/:id",
    { preHandler: adminAuth },
    async (request, reply) => {
      const params = z.object({ id: z.string().min(1) }).parse(request.params);
      try {
        const removed = app.teamService.delete(params.id);
        app.adminAuditService.record({
          action: "team.delete",
          actorKeyHash: request.adminAuth?.apiKeyHash,
          targetType: "team",
          targetId: params.id
        });
        return removed;
      } catch (err) {
        await reply.code(404).send({
          error: { type: "not_found", message: err instanceof Error ? err.message : "Team not found", code: "team_not_found" }
        });
      }
    }
  );

  // ─── Token Saver settings ────────────────────────────────

  app.get(
    "/admin/v1/token-saver",
    {
      preHandler: adminAuth
    },
    async () => {
      return app.tokenSaverService.getSettings();
    }
  );

  app.put(
    "/admin/v1/token-saver",
    {
      preHandler: adminAuth
    },
    async (request) => {
      const body = request.body as Record<string, unknown> ?? {};
      const updated = app.tokenSaverService.updateSettings({
        compressToolOutput: typeof body.compressToolOutput === "boolean" ? body.compressToolOutput : undefined,
        compressLlmOutput: typeof body.compressLlmOutput === "boolean" ? body.compressLlmOutput : undefined,
        llmCompressionMode: typeof body.llmCompressionMode === "string" && ["lite", "full", "ultra"].includes(body.llmCompressionMode)
          ? body.llmCompressionMode as "lite" | "full" | "ultra"
          : undefined,
      });
      app.adminAuditService.record({
        action: "token_saver.update",
        actorKeyHash: request.adminAuth?.apiKeyHash,
        targetType: "config",
        targetId: "token_saver"
      });
      return updated;
    }
  );

  // ─── Gateway Settings (toggles + actions) ────────────────

  app.get(
    "/admin/v1/settings/runtime",
    { preHandler: adminAuth },
    async () => {
      return {
        requestQueueEnabled: app.requestQueueService.isEnabled(),
        circuitBreakerEnabled: true, // always on per-instance
        autoPeristEnabled: true,
        redactionEnabled: true,
        encryptionEnabled: true,
      };
    }
  );

  app.put(
    "/admin/v1/settings/runtime",
    { preHandler: adminAuth },
    async (request) => {
      const body = request.body as Record<string, unknown> ?? {};
      if (typeof body.requestQueueEnabled === "boolean") {
        app.requestQueueService.updateOptions({ enabled: body.requestQueueEnabled });
      }
      app.adminAuditService.record({
        action: "settings.runtime_update",
        actorKeyHash: request.adminAuth?.apiKeyHash,
        targetType: "config",
        targetId: "runtime"
      });
      return {
        requestQueueEnabled: app.requestQueueService.isEnabled(),
        circuitBreakerEnabled: true,
        autoPeristEnabled: true,
        redactionEnabled: true,
        encryptionEnabled: true,
      };
    }
  );

  // ─── Webhook Notifications ─────────────────────────────────

  app.get(
    "/admin/v1/webhooks",
    { preHandler: adminAuth },
    async () => {
      return app.webhookService.getConfig();
    }
  );

  app.put(
    "/admin/v1/webhooks",
    { preHandler: adminAuth },
    async (request) => {
      const body = request.body as Record<string, unknown> ?? {};
      const updated = app.webhookService.updateConfig({
        enabled: typeof body.enabled === "boolean" ? body.enabled : undefined,
        url: typeof body.url === "string" ? body.url : undefined,
        events: Array.isArray(body.events) ? body.events : undefined
      });
      app.adminAuditService.record({
        action: "webhook.update",
        actorKeyHash: request.adminAuth?.apiKeyHash,
        targetType: "config",
        targetId: "webhook"
      });
      return updated;
    }
  );

  app.post(
    "/admin/v1/webhooks/test",
    { preHandler: adminAuth },
    async () => {
      await app.webhookService.notify("circuit_breaker.close", {
        message: "Test notification from AI Gateway",
        source: "admin_dashboard"
      });
      return { sent: true };
    }
  );

  app.post(
    "/admin/v1/settings/change-password",
    { preHandler: adminAuth },
    async (request) => {
      const body = z.object({
        currentPassword: z.string().min(1),
        newPassword: z.string().min(4)
      }).parse(request.body);
      // Verify current password matches admin key
      if (!config.adminApiKeys.includes(body.currentPassword)) {
        return { success: false, message: "Current password is incorrect" };
      }
      // Note: In production this would update .env or a secrets store.
      // For MVP we just validate — actual password change requires restart.
      return { success: true, message: "Password validated. Update ADMIN_API_KEYS in .env and restart gateway to apply." };
    }
  );

  app.get(
    "/admin/v1/settings/export",
    { preHandler: adminAuth },
    async () => {
      // Export full gateway state
      return {
        providerInstances: app.providerRuntimeRegistry.listProviderInstances(),
        accounts: app.providerRuntimeRegistry.listAccounts(),
        modelMappings: app.modelRegistry.listModelMappings(),
        routingProfiles: app.routingProfileRegistry.listRoutingProfiles(),
        apiKeys: app.apiKeyService.list(),
        teams: app.teamService.list(),
        tokenSaver: app.tokenSaverService.getSettings(),
        exportedAt: new Date().toISOString()
      };
    }
  );

  app.post(
    "/admin/v1/settings/import",
    { preHandler: adminAuth },
    async (request) => {
      const body = request.body as Record<string, unknown> ?? {};
      let imported = 0;

      // Import model mappings
      if (Array.isArray(body.modelMappings)) {
        for (const m of body.modelMappings) {
          try {
            app.modelRegistry.register(m as Parameters<typeof app.modelRegistry.register>[0]);
            imported++;
          } catch { /* skip duplicates */ }
        }
      }

      // Import routing profiles
      if (Array.isArray(body.routingProfiles)) {
        for (const p of body.routingProfiles) {
          try {
            app.routingProfileRegistry.register(p as Parameters<typeof app.routingProfileRegistry.register>[0]);
            imported++;
          } catch { /* skip duplicates */ }
        }
      }

      // Import teams
      if (Array.isArray(body.teams)) {
        for (const t of body.teams) {
          try {
            app.teamService.create(t as Parameters<typeof app.teamService.create>[0]);
            imported++;
          } catch { /* skip duplicates */ }
        }
      }

      app.adminAuditService.record({
        action: "settings.import",
        actorKeyHash: request.adminAuth?.apiKeyHash,
        targetType: "config",
        targetId: "gateway"
      });

      await saveAdminRuntimeState(app);
      return { success: true, message: `Imported ${imported} items`, imported };
    }
  );

  app.post(
    "/admin/v1/settings/reset",
    { preHandler: adminAuth },
    async (request, reply) => {
      const body = z.object({ confirm: z.literal("RESET") }).parse(request.body);
      // Clear all runtime state
      app.usageService.clear();
      app.requestLogService.clear();
      app.adminAuditService.record({
        action: "settings.reset",
        actorKeyHash: request.adminAuth?.apiKeyHash,
        targetType: "config",
        targetId: "gateway"
      });
      return { success: true, message: "Usage and request logs cleared. Accounts and providers preserved." };
    }
  );

  app.get(
    "/admin/v1/usage",
    {
      preHandler: adminAuth
    },
    async (request, reply) => {
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

      const result = app.usageService.query({
        ...filter,
        limit: q.limit,
        offset: q.offset
      });

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
    }
  );

  app.get(
    "/admin/v1/request-logs",
    {
      preHandler: adminAuth
    },
    async (request, reply) => {
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
    }
  );

  app.delete(
    "/admin/v1/request-logs",
    {
      preHandler: adminAuth
    },
    async (request) => {
      app.requestLogService.clear();
      app.adminAuditService.record({
        action: "request_logs.clear",
        actorKeyHash: request.adminAuth?.apiKeyHash,
        targetType: "logs",
        targetId: "request-logs"
      });
      return { message: "Request logs cleared" };
    }
  );

  app.get(
    "/admin/v1/audit-logs",
    {
      preHandler: adminAuth
    },
    async () => {
      return {
        data: app.adminAuditService.list()
      };
    }
  );

  app.get(
    "/admin/v1/config/current",
    {
      preHandler: adminAuth
    },
    async () => {
      return {
        data: app.configRevisionService.getCurrent()
      };
    }
  );

  app.get(
    "/admin/v1/config/revisions",
    {
      preHandler: adminAuth
    },
    async () => {
      return {
        data: app.configRevisionService.listRevisions()
      };
    }
  );

  app.post(
    "/admin/v1/config/validate",
    {
      preHandler: adminAuth
    },
    async (request) => {
      const body = configDraftSchema.parse(request.body);
      return app.configRevisionService.validateDraft(body.config);
    }
  );

  app.post(
    "/admin/v1/config/publish",
    {
      preHandler: adminAuth
    },
    async (request) => {
      const body = configDraftSchema.parse(request.body);
      const revision = app.configRevisionService.publish(
        body.config,
        request.adminAuth?.apiKeyHash
      );
      app.adminAuditService.record({
        action: "config.publish",
        actorKeyHash: request.adminAuth?.apiKeyHash,
        targetType: "config_revision",
        targetId: revision.id
      });

      return revision;
    }
  );

  app.post(
    "/admin/v1/config/revisions/:id/rollback",
    {
      preHandler: adminAuth
    },
    async (request) => {
      const params = rollbackParamsSchema.parse(request.params);
      const revision = app.configRevisionService.rollback(
        params.id,
        request.adminAuth?.apiKeyHash
      );
      app.adminAuditService.record({
        action: "config.rollback",
        actorKeyHash: request.adminAuth?.apiKeyHash,
        targetType: "config_revision",
        targetId: params.id
      });

      return revision;
    }
  );

  // ─── Model Pricing ──────────────────────────────────────────

  app.get(
    "/admin/v1/model-pricing",
    { preHandler: adminAuth },
    async () => {
      return app.modelPricingService.list();
    }
  );

  app.put(
    "/admin/v1/model-pricing/:model",
    { preHandler: adminAuth },
    async (request, reply) => {
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
        label: body.label,
      });

      app.adminAuditService.record({
        action: "model_pricing.upsert",
        actorKeyHash: request.adminAuth?.apiKeyHash,
        targetType: "model_pricing",
        targetId: params.model,
      });

      return entry;
    }
  );

  app.delete(
    "/admin/v1/model-pricing/:model",
    { preHandler: adminAuth },
    async (request, reply) => {
      const params = request.params as { model: string };
      const deleted = app.modelPricingService.delete(params.model);

      if (!deleted) {
        return reply.code(404).send({
          error: { message: `No pricing found for model "${params.model}"`, code: "not_found" }
        });
      }

      app.adminAuditService.record({
        action: "model_pricing.delete",
        actorKeyHash: request.adminAuth?.apiKeyHash,
        targetType: "model_pricing",
        targetId: params.model,
      });

      return { deleted: true };
    }
  );
}

function findAccountPoolForAccount(app: FastifyInstance, accountId: string) {
  for (const providerInstance of app.providerRuntimeRegistry.listProviderInstances()) {
    const pool = app.providerRuntimeRegistry.getAccountPool(providerInstance.id);

    if (pool?.getAccount(accountId)) {
      return pool;
    }
  }

  throw new Error(`Account ${accountId} not found`);
}

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
    throw new Error(
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

async function findKiroRefreshToken(): Promise<
  { refreshToken: string; source: string } | undefined
> {
  const cachePath = join(homedir(), ".aws", "sso", "cache");
  let files: string[];

  try {
    files = await readdir(cachePath);
  } catch {
    return undefined;
  }

  const orderedFiles = [
    ...files.filter((file) => file === "kiro-auth-token.json"),
    ...files.filter((file) => file.endsWith(".json") && file !== "kiro-auth-token.json")
  ];

  for (const file of orderedFiles) {
    try {
      const raw = await readFile(join(cachePath, file), "utf8");
      const parsed = JSON.parse(raw) as { refreshToken?: unknown };
      if (
        typeof parsed.refreshToken === "string" &&
        parsed.refreshToken.startsWith("aorAAAAAG")
      ) {
        return {
          refreshToken: parsed.refreshToken,
          source: join(cachePath, file)
        };
      }
    } catch {
      continue;
    }
  }

  return undefined;
}

async function findKiroCockpitCredentials(): Promise<
  Array<{
    id: string;
    accessToken?: string;
    refreshToken: string;
    expiresAt?: string;
    profileArn?: string;
    tokenType?: string;
    email?: string;
    loginHint?: string;
    planName?: string;
    planTier?: string;
    source: string;
  }>
> {
  const accountsPath = join(homedir(), ".antigravity_cockpit", "kiro_accounts");
  let files: string[];

  try {
    files = await readdir(accountsPath);
  } catch {
    return [];
  }

  const credentials = [];

  for (const file of files.filter((item) => item.endsWith(".json") && !item.endsWith(".bak"))) {
    const source = join(accountsPath, file);

    try {
      const raw = await readFile(source, "utf8");
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const rawToken =
        parsed.kiro_auth_token_raw &&
        typeof parsed.kiro_auth_token_raw === "object" &&
        !Array.isArray(parsed.kiro_auth_token_raw)
          ? (parsed.kiro_auth_token_raw as Record<string, unknown>)
          : {};
      const id = readString(parsed, "id") ?? file.replace(/\.json$/i, "");
      const refreshToken =
        readString(parsed, "refreshToken") ??
        readString(parsed, "refresh_token") ??
        readString(rawToken, "refreshToken") ??
        readString(rawToken, "refresh_token");

      if (!refreshToken?.startsWith("aorAAAAAG")) {
        continue;
      }

      credentials.push({
        id,
        accessToken:
          readString(parsed, "accessToken") ??
          readString(parsed, "access_token") ??
          readString(rawToken, "accessToken") ??
          readString(rawToken, "access_token"),
        refreshToken,
        expiresAt:
          readString(parsed, "expiresAt") ??
          readString(parsed, "expires_at") ??
          readString(rawToken, "expiresAt") ??
          readString(rawToken, "expires_at") ??
          readEpochSeconds(parsed, "expires_at"),
        profileArn:
          readString(parsed, "profileArn") ??
          readString(parsed, "profile_arn") ??
          readString(rawToken, "profileArn") ??
          readString(rawToken, "profile_arn"),
        tokenType:
          readString(parsed, "tokenType") ??
          readString(parsed, "token_type") ??
          readString(rawToken, "tokenType") ??
          readString(rawToken, "token_type") ??
          "Bearer",
        email:
          readString(parsed, "email") ??
          readString(rawToken, "email"),
        loginHint:
          readString(parsed, "loginHint") ??
          readString(parsed, "login_hint") ??
          readString(rawToken, "loginHint") ??
          readString(rawToken, "login_hint"),
        planName: readString(parsed, "plan_name"),
        planTier: readString(parsed, "plan_tier"),
        source
      });
    } catch {
      continue;
    }
  }

  return credentials;
}

async function findWindsurfLocalCredential(): Promise<
  | {
      token: string;
      apiKey?: string;
      apiServerUrl?: string;
      email?: string;
      source: string;
      isDevin?: boolean;
      devinInfo?: {
        accountDisplayName?: string;
        apiUrl?: string;
        canUseCascade?: boolean;
        canUseCli?: boolean;
        devinReviewEnabled?: boolean;
        isAdmin?: boolean;
        orgId?: string;
        webappHost?: string;
      };
      teamId?: string;
    }
  | undefined
> {
  const accountsPath = join(homedir(), ".antigravity_cockpit", "windsurf_accounts");
  let files: string[];

  try {
    files = await readdir(accountsPath);
  } catch {
    return undefined;
  }

  const candidates: Array<{
    token: string;
    apiKey?: string;
    apiServerUrl?: string;
    email?: string;
    source: string;
    lastUsed: number;
    isDevin?: boolean;
    devinInfo?: {
      accountDisplayName?: string;
      apiUrl?: string;
      canUseCascade?: boolean;
      canUseCli?: boolean;
      devinReviewEnabled?: boolean;
      isAdmin?: boolean;
      orgId?: string;
      webappHost?: string;
    };
    teamId?: string;
  }> = [];

  for (const file of files.filter((item) => item.endsWith(".json"))) {
    const source = join(accountsPath, file);

    try {
      const raw = await readFile(source, "utf8");
      const parsed = JSON.parse(raw) as {
        windsurf_auth_token?: unknown;
        windsurf_api_key?: unknown;
        windsurf_api_server_url?: unknown;
        windsurf_auth_status_raw?: {
          sessionToken?: unknown;
          apiKey?: unknown;
          apiServerUrl?: unknown;
          email?: unknown;
        };
        windsurf_user_status?: {
          userStatus?: {
            isDevin?: boolean;
            devinInfo?: {
              accountDisplayName?: string;
              apiUrl?: string;
              canUseCascade?: boolean;
              canUseCli?: boolean;
              devinReviewEnabled?: boolean;
              isAdmin?: boolean;
              orgId?: string;
              webappHost?: string;
            };
            teamId?: string;
          };
        };
        github_email?: unknown;
        usage_updated_at?: unknown;
        last_used?: unknown;
      };
      const token =
        typeof parsed.windsurf_auth_token === "string"
          ? parsed.windsurf_auth_token
          : typeof parsed.windsurf_auth_status_raw?.sessionToken === "string"
            ? parsed.windsurf_auth_status_raw.sessionToken
            : undefined;

      if (!token) {
        continue;
      }

      // Extract Devin-specific info
      const userStatus = parsed.windsurf_user_status?.userStatus;
      const isDevin = userStatus?.isDevin === true;
      const devinInfo = isDevin && userStatus?.devinInfo ? userStatus.devinInfo : undefined;
      const teamId = typeof userStatus?.teamId === "string" ? userStatus.teamId : undefined;

      candidates.push({
        token,
        apiKey:
          typeof parsed.windsurf_api_key === "string"
            ? parsed.windsurf_api_key
            : typeof parsed.windsurf_auth_status_raw?.apiKey === "string"
              ? parsed.windsurf_auth_status_raw.apiKey
              : undefined,
        apiServerUrl:
          typeof parsed.windsurf_api_server_url === "string"
            ? parsed.windsurf_api_server_url
            : typeof parsed.windsurf_auth_status_raw?.apiServerUrl === "string"
              ? parsed.windsurf_auth_status_raw.apiServerUrl
              : undefined,
        email:
          typeof parsed.windsurf_auth_status_raw?.email === "string"
            ? parsed.windsurf_auth_status_raw.email
            : typeof parsed.github_email === "string"
              ? parsed.github_email
              : undefined,
        source,
        lastUsed:
          typeof parsed.last_used === "number"
            ? parsed.last_used
            : typeof parsed.usage_updated_at === "number"
              ? parsed.usage_updated_at
              : 0,
        isDevin,
        devinInfo,
        teamId
      });
    } catch {
      continue;
    }
  }

  return candidates.sort((left, right) => right.lastUsed - left.lastUsed)[0];
}

function readString(data: Record<string, unknown>, key: string): string | undefined {
  const value = data[key];
  return typeof value === "string" && value ? value : undefined;
}

function readEpochSeconds(data: Record<string, unknown>, key: string): string | undefined {
  const value = data[key];

  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }

  return new Date(value * 1000).toISOString();
}

async function saveAdminRuntimeState(app: FastifyInstance): Promise<void> {
  await app.persistenceService.save({
    providerInstances: app.providerRuntimeRegistry.listProviderInstances(),
    accounts: app.providerRuntimeRegistry.listAccounts(),
    modelMappings: app.modelRegistry.listModelMappings(),
    routingProfiles: app.routingProfileRegistry.listRoutingProfiles(),
    apiKeys: app.apiKeyService.list(),
    secrets: app.secretService.listSecrets(),
    config: {
      current: app.configRevisionService.getCurrent(),
      revisions: app.configRevisionService.listRevisions()
    }
  });
}

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const str = value instanceof Date ? value.toISOString() : String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}
