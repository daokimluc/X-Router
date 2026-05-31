import { z } from "zod";
import { readFile, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { AppConfig } from "../config.js";
import { createAdminAuthMiddleware } from "../middleware/adminAuth.js";
import { AccountPool } from "../account-pool/AccountPool.js";
import { KiroAuthClient, applyKiroToken } from "../providers/adapters/kiro/KiroAuthClient.js";
import { ProviderError } from "../providers/base/ProviderErrors.js";
import { NotFoundError } from "../errors/NotFoundError.js";
import { recordAudit } from "./admin/helpers.js";
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
import type { ProviderInstance } from "../providers/base/ProviderInstance.js";

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
const githubDeviceCodeStartSchema = z.object({
  providerInstanceId: z.string().min(1),
  accountId: z.string().min(1),
  displayName: z.string().min(1),
  owner: z.string().min(1).optional(),
  maxConcurrency: z.number().int().positive().default(3),
  weight: z.number().int().positive().default(1),
  allowedModels: z.array(z.string().min(1)).optional(),
  tags: z.array(z.string().min(1)).optional()
});
const githubDeviceCodePollSchema = z.object({
  deviceCode: z.string().min(1),
  providerInstanceId: z.string().min(1),
  accountId: z.string().min(1),
  displayName: z.string().min(1),
  owner: z.string().min(1).optional(),
  maxConcurrency: z.number().int().positive().default(3),
  weight: z.number().int().positive().default(1),
  allowedModels: z.array(z.string().min(1)).optional(),
  tags: z.array(z.string().min(1)).optional()
});
const kiroIdcImportSchema = z.object({
  providerInstanceId: z.string().min(1),
  accountId: z.string().min(1),
  displayName: z.string().min(1),
  refreshToken: z.string().min(1),
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
  region: z.string().min(1).default("us-east-1"),
  owner: z.string().min(1).optional(),
  maxConcurrency: z.number().int().positive().default(3),
  weight: z.number().int().positive().default(1),
  allowedModels: z.array(z.string().min(1)).optional(),
  tags: z.array(z.string().min(1)).optional()
});
const codexLocalImportSchema = z.object({
  providerInstanceId: z.string().min(1),
  accountId: z.string().min(1),
  displayName: z.string().min(1),
  owner: z.string().min(1).optional(),
  maxConcurrency: z.number().int().positive().default(3),
  weight: z.number().int().positive().default(1),
  allowedModels: z.array(z.string().min(1)).optional(),
  tags: z.array(z.string().min(1)).optional()
});

/**
 * Admin OAuth + provider-import routes — version check, OAuth PKCE start,
 * callbacks, and the kiro/windsurf/github-copilot/codex credential imports.
 * The other admin domains live in routes/admin/*.ts; the registrar that wires
 * them all together is routes/admin/index.ts.
 */
export async function registerAdminOAuthImportRoutes(
  app: FastifyInstance,
  config: AppConfig
): Promise<void> {
  const adminAuth = createAdminAuthMiddleware(config);

  // Phase 32 — version check. Reads current version from package.json
  // (resolved at process start) and queries npm for the latest published
  // version. Cached for 1 hour to avoid hammering the registry.
  let versionCache: { current: string; latest: string | null; hasUpdate: boolean; checkedAt: number } | null = null;
  const VERSION_CACHE_MS = 60 * 60 * 1000;
  app.get(
    "/admin/v1/version",
    { preHandler: adminAuth },
    async () => {
      const now = Date.now();
      if (versionCache && now - versionCache.checkedAt < VERSION_CACHE_MS) {
        return versionCache;
      }
      // Read version from package.json
      let current = "unknown";
      try {
        const { readFileSync } = await import("node:fs");
        const { fileURLToPath } = await import("node:url");
        const path = await import("node:path");
        const __dirname = path.dirname(fileURLToPath(import.meta.url));
        // dist/routes/admin.js → ../../package.json (when published) or
        // apps/gateway/src/routes/admin.ts → ../../../package.json (in dev/tests)
        const candidates = [
          path.resolve(__dirname, "..", "..", "package.json"),
          path.resolve(__dirname, "..", "..", "..", "package.json"),
          path.resolve(__dirname, "..", "..", "..", "..", "package.json"),
        ];
        for (const p of candidates) {
          try {
            const pkg = JSON.parse(readFileSync(p, "utf8"));
            if (pkg.name === "@daokimluc/x-router" || pkg.name === "ai-gateway") {
              current = pkg.version;
              break;
            }
          } catch {}
        }
      } catch {}

      // Fetch latest from npm
      let latest: string | null = null;
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 5000);
        const res = await fetch("https://registry.npmjs.org/@daokimluc/x-router/latest", {
          signal: ctrl.signal,
        });
        clearTimeout(timer);
        if (res.ok) {
          const data = await res.json() as { version?: string };
          if (typeof data.version === "string") latest = data.version;
        }
      } catch {
        // network / timeout — leave latest null
      }

      const hasUpdate = !!(latest && current !== "unknown" && compareSemver(latest, current) > 0);
      versionCache = { current, latest, hasUpdate, checkedAt: now };
      return versionCache;
    }
  );

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

      recordAudit(app, request, "oauth.pkce_start", "provider_instance", body.providerInstanceId);

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

        recordAudit(app, request, "oauth.generic_pkce_start", "oauth_flow", result.state);

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
        throw new NotFoundError(`Account pool ${providerInstance.id} not found`);
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
        region: detected.region ?? body.region,
        source: detected.source,
        authMethod: detected.authMethod as "social" | "idc" | undefined,
        clientId: detected.clientId,
        clientSecret: detected.clientSecret
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
      recordAudit(app, request, "account.kiro_import_local", "account", account.id);
      app.persistState();

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
        throw new NotFoundError(`Account pool ${providerInstance.id} not found`);
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

      recordAudit(app, request, "account.kiro_import_cockpit", "provider_instance", providerInstance.id);
      app.persistState();

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
        throw new NotFoundError(`Account pool ${providerInstance.id} not found`);
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
      recordAudit(app, request, "account.windsurf_import_local", "account", account.id);
      app.persistState();

      return {
        data: {
          ...account,
          credentialRef: "[REDACTED]"
        }
      };
    }
  );

  // ============================================================================
  // GitHub Copilot Device Code Flow
  // ============================================================================
  app.post(
    "/admin/v1/oauth/github-copilot/device-code/start",
    { preHandler: adminAuth },
    async (request, reply) => {
      const body = githubDeviceCodeStartSchema.parse(request.body);
      const { GitHubCopilotAdapter } = await import("../providers/adapters/github-copilot/GitHubCopilotAdapter.js");
      const adapter = new GitHubCopilotAdapter();
      const result = await adapter.startDeviceCodeFlow();

      if (!result) {
        reply.code(502);
        return { error: { type: "upstream_error", message: "Failed to start GitHub device code flow", code: "device_code_start_failed" } };
      }

      recordAudit(app, request, "oauth.github_device_code_start", "provider_instance", body.providerInstanceId);

      return {
        data: {
          deviceCode: result.deviceCode,
          userCode: result.userCode,
          verificationUri: result.verificationUri,
          expiresIn: result.expiresIn,
          interval: result.interval,
          accountId: body.accountId
        }
      };
    }
  );

  app.post(
    "/admin/v1/oauth/github-copilot/device-code/poll",
    { preHandler: adminAuth },
    async (request, reply) => {
      const body = githubDeviceCodePollSchema.parse(request.body);
      const { GitHubCopilotAdapter } = await import("../providers/adapters/github-copilot/GitHubCopilotAdapter.js");
      const adapter = new GitHubCopilotAdapter();
      const result = await adapter.pollDeviceCode(body.deviceCode);

      if (!result) {
        reply.code(202);
        return { data: { status: "pending", message: "Waiting for user to authorize" } };
      }

      const providerInstance = app.providerRuntimeRegistry.getProviderInstance(body.providerInstanceId);
      if (!providerInstance || providerInstance.type !== "github_copilot") {
        reply.code(404);
        return { error: { type: "not_found", message: "GitHub Copilot provider instance not found", code: "provider_instance_not_found" } };
      }

      const accountPool = app.providerRuntimeRegistry.getAccountPool(providerInstance.id);
      if (!accountPool) throw new NotFoundError(`Account pool ${providerInstance.id} not found`);

      const now = new Date();
      const credentialRef = `secret_${body.accountId}`;
      const account: ProviderAccount = {
        id: body.accountId,
        providerInstanceId: providerInstance.id,
        providerType: "github_copilot",
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

      app.secretService.addCredentialPayload({
        id: credentialRef,
        accountId: account.id,
        credentialType: "oauth",
        credentialPayload: {
          accessToken: result.accessToken,
          refreshToken: result.refreshToken
        }
      });
      accountPool.addAccount(account);
      recordAudit(app, request, "account.github_copilot_device_code", "account", account.id);
      app.persistState();

      return { data: { ...account, credentialRef: "[REDACTED]" } };
    }
  );

  // ============================================================================
  // Kiro IDC Import (clientId + clientSecret + refreshToken)
  // ============================================================================
  app.post(
    "/admin/v1/oauth/kiro/import-idc",
    { preHandler: adminAuth },
    async (request, reply) => {
      const body = kiroIdcImportSchema.parse(request.body);
      const providerInstance = app.providerRuntimeRegistry.getProviderInstance(body.providerInstanceId);

      if (!providerInstance || providerInstance.type !== "kiro") {
        reply.code(404);
        return { error: { type: "not_found", message: "Kiro provider instance not found", code: "provider_instance_not_found" } };
      }

      const accountPool = app.providerRuntimeRegistry.getAccountPool(providerInstance.id);
      if (!accountPool) throw new NotFoundError(`Account pool ${providerInstance.id} not found`);

      const idcCredential = {
        refreshToken: body.refreshToken,
        clientId: body.clientId,
        clientSecret: body.clientSecret,
        region: body.region,
        authMethod: "idc" as const
      };

      const token = await new KiroAuthClient().refreshToken(idcCredential);
      const credentialPayload = {
        ...idcCredential,
        ...applyKiroToken(idcCredential, token),
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
        runtime: { activeRequests: 0, totalRequests: 0, failedRequests: 0, consecutiveFailures: 0 },
        metadata: { authMethod: "idc", region: body.region },
        createdAt: now,
        updatedAt: now
      };

      app.secretService.addCredentialPayload({
        id: credentialRef,
        accountId: account.id,
        credentialType: "custom_json",
        credentialPayload
      });
      accountPool.addAccount(account);
      recordAudit(app, request, "account.kiro_import_idc", "account", account.id);
      app.persistState();

      return { data: { ...account, credentialRef: "[REDACTED]" } };
    }
  );

  // ============================================================================
  // Codex Local Import (reads from ~/.codex/ or ~/.config/codex/)
  // ============================================================================
  app.post(
    "/admin/v1/oauth/codex/import-local",
    { preHandler: adminAuth },
    async (request, reply) => {
      const body = codexLocalImportSchema.parse(request.body);
      const providerInstance = app.providerRuntimeRegistry.getProviderInstance(body.providerInstanceId);

      if (!providerInstance || providerInstance.type !== "codex") {
        reply.code(404);
        return { error: { type: "not_found", message: "Codex provider instance not found", code: "provider_instance_not_found" } };
      }

      const accountPool = app.providerRuntimeRegistry.getAccountPool(providerInstance.id);
      if (!accountPool) throw new NotFoundError(`Account pool ${providerInstance.id} not found`);

      const detected = await findCodexLocalCredential();
      if (!detected) {
        reply.code(404);
        return { error: { type: "not_found", message: "Codex local auth not found. Run `codex login` first.", code: "codex_local_token_not_found" } };
      }

      const now = new Date();
      const credentialRef = `secret_${body.accountId}`;
      const account: ProviderAccount = {
        id: body.accountId,
        providerInstanceId: providerInstance.id,
        providerType: "codex",
        displayName: body.displayName,
        status: "active",
        weight: body.weight,
        maxConcurrency: body.maxConcurrency,
        credentialRef,
        allowedModels: body.allowedModels,
        tags: body.tags,
        owner: body.owner,
        runtime: { activeRequests: 0, totalRequests: 0, failedRequests: 0, consecutiveFailures: 0 },
        metadata: { authMethod: "local_import", source: detected.source },
        createdAt: now,
        updatedAt: now
      };

      app.secretService.addCredentialPayload({
        id: credentialRef,
        accountId: account.id,
        credentialType: "oauth",
        credentialPayload: {
          accessToken: detected.accessToken,
          refreshToken: detected.refreshToken,
          expiresAt: detected.expiresAt
        }
      });
      accountPool.addAccount(account);
      recordAudit(app, request, "account.codex_import_local", "account", account.id);
      app.persistState();

      return { data: { ...account, credentialRef: "[REDACTED]" } };
    }
  );

}

async function findKiroRefreshToken(): Promise<
  { refreshToken: string; accessToken?: string; clientId?: string; clientSecret?: string; authMethod?: string; region?: string; source: string } | undefined
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

  let tokenFile: { refreshToken: string; accessToken?: string; authMethod?: string; clientIdHash?: string; region?: string; source: string } | undefined;

  for (const file of orderedFiles) {
    try {
      const raw = await readFile(join(cachePath, file), "utf8");
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (
        typeof parsed.refreshToken === "string" &&
        (parsed.refreshToken as string).startsWith("aorAAAAAG")
      ) {
        tokenFile = {
          refreshToken: parsed.refreshToken as string,
          accessToken: typeof parsed.accessToken === "string" ? parsed.accessToken as string : undefined,
          authMethod: typeof parsed.authMethod === "string" ? parsed.authMethod as string : undefined,
          clientIdHash: typeof parsed.clientIdHash === "string" ? parsed.clientIdHash as string : undefined,
          region: typeof parsed.region === "string" ? parsed.region as string : undefined,
          source: join(cachePath, file)
        };
        break;
      }
    } catch {
      continue;
    }
  }

  if (!tokenFile) return undefined;

  // If IdC auth, look up clientId/clientSecret from the corresponding client registration file
  if (tokenFile.authMethod === "IdC" && tokenFile.clientIdHash) {
    const clientFile = join(cachePath, `${tokenFile.clientIdHash}.json`);
    try {
      const raw = await readFile(clientFile, "utf8");
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      return {
        refreshToken: tokenFile.refreshToken,
        accessToken: tokenFile.accessToken,
        clientId: typeof parsed.clientId === "string" ? parsed.clientId : undefined,
        clientSecret: typeof parsed.clientSecret === "string" ? parsed.clientSecret : undefined,
        authMethod: "idc",
        region: tokenFile.region,
        source: tokenFile.source
      };
    } catch {
      // Fall through — return without client credentials
    }
  }

  return {
    refreshToken: tokenFile.refreshToken,
    accessToken: tokenFile.accessToken,
    authMethod: tokenFile.authMethod === "IdC" ? "idc" : "social",
    region: tokenFile.region,
    source: tokenFile.source
  };
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

async function findCodexLocalCredential(): Promise<
  | { accessToken: string; refreshToken?: string; expiresAt?: string; source: string }
  | undefined
> {
  const candidates = [
    join(homedir(), ".codex", "auth.json"),
    join(homedir(), ".config", "codex", "auth.json"),
    join(homedir(), "AppData", "Roaming", "codex", "auth.json")
  ];

  for (const filePath of candidates) {
    try {
      const content = await readFile(filePath, "utf-8");
      const data = JSON.parse(content) as Record<string, unknown>;
      const accessToken =
        (data.access_token as string) ?? (data.accessToken as string);
      if (accessToken) {
        return {
          accessToken,
          refreshToken:
            (data.refresh_token as string) ?? (data.refreshToken as string),
          expiresAt:
            (data.expires_at as string) ?? (data.expiresAt as string),
          source: filePath
        };
      }
    } catch {
      continue;
    }
  }

  return undefined;
}

/**
 * Lightweight semver comparator: returns >0 if a > b, <0 if a < b, 0 if equal.
 * Handles "1.2.3", "1.2.3-rc.1", "v1.2.3" prefixes. Pre-release tags lose to
 * the same major.minor.patch without a tag (1.2.3 > 1.2.3-rc.1).
 */
function compareSemver(a: string, b: string): number {
  const stripV = (v: string) => v.replace(/^v/, "");
  const parse = (v: string) => {
    const [core, pre] = stripV(v).split("-");
    const [maj, min, pat] = core.split(".").map((p) => parseInt(p, 10) || 0);
    return { maj, min, pat, pre: pre ?? "" };
  };
  const A = parse(a);
  const B = parse(b);
  if (A.maj !== B.maj) return A.maj - B.maj;
  if (A.min !== B.min) return A.min - B.min;
  if (A.pat !== B.pat) return A.pat - B.pat;
  // Same core: pre-release < release
  if (A.pre === "" && B.pre !== "") return 1;
  if (A.pre !== "" && B.pre === "") return -1;
  return A.pre.localeCompare(B.pre);
}
