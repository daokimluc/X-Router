/**
 * Provider Accounts REST API routes
 * POST /admin/v1/providers/:providerType/accounts - Add account (sync modes + OAuth PKCE)
 * GET /admin/v1/providers/:providerType/accounts - List accounts
 * DELETE /admin/v1/providers/:providerType/accounts/:accountId - Delete account
 * GET /admin/v1/oauth-sessions/:oauthSessionId - Poll OAuth session status
 * @module routes/providerAccounts
 */

import { randomUUID, randomBytes, createHash } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z, ZodError } from "zod";
import type { AccountPool } from "../account-pool/AccountPool.js";
import type { ProviderAccount, ProviderAccountSecret } from "../providers/base/ProviderAccount.js";
import type { ProviderTypeDefinition } from "../providers/registry/ProviderTypeDefinition.js";
import type { AddAccountLockService, AddAccountLockTimeoutError } from "../services/AddAccountLockService.js";
import type { IdempotencyStore } from "../services/IdempotencyStore.js";
import type { OAuthSessionStore } from "../services/OAuthSessionStore.js";
import type { RateLimitService } from "../services/RateLimitService.js";
import type { SecretService } from "../services/SecretService.js";
import type { LocalEncryptionService } from "../services/LocalEncryptionService.js";
import type { AdminAuditService } from "../services/AdminAuditService.js";
import type { MetricsService } from "../services/MetricsService.js";
import type { PersistenceService } from "../services/PersistenceService.js";
import type { ConfigRevisionService } from "../services/ConfigRevisionService.js";
import type { ProviderAdapterRegistry } from "../providers/registry/ProviderAdapterRegistry.js";
import type { ProviderRuntimeRegistry } from "../provider-runtime/ProviderRuntimeRegistry.js";
import { createAdminAuthMiddleware } from "../middleware/adminAuth.js";
import type { AppConfig } from "../config.js";
import {
  parseAddAccountRequest,
  CredentialValidationError,
  type AddAccountRequestRaw,
} from "../services/addAccount/schema.js";
import {
  normalizeAddAccountRequest,
  normalizeLabel,
  type AccountDraft,
  type CredentialMode,
} from "../services/addAccount/normalize.js";
import {
  getSupportedCredentialModes,
  isCredentialModeSupported,
} from "../services/addAccount/credentialModeMapping.js";

// ============================================================================
// Types
// ============================================================================

export type ProviderAccountRouteDeps = {
  providerRegistry: ProviderAdapterRegistry;
  providerRuntimeRegistry: ProviderRuntimeRegistry;
  secretService: SecretService;
  encryptionService: LocalEncryptionService;
  addAccountLockService: AddAccountLockService;
  idempotencyStore: IdempotencyStore;
  oauthSessionStore: OAuthSessionStore;
  addAccountRateLimiter: RateLimitService;
  adminAuditService: AdminAuditService;
  metricsService: MetricsService;
  persistenceService: PersistenceService;
  configRevisionService: ConfigRevisionService;
};

export type AddAccountResponse = {
  accountId: string;
  providerType: string;
  credentialMode: CredentialMode;
  label: string;
  enabled: boolean;
  weight: number;
  createdAt: string;
};

export type OAuthStartResponse = {
  oauthSessionId: string;
  authorizationUrl: string;
  expiresAt: string;
};

export type OAuthSessionStatusResponse = {
  id: string;
  status: "pending" | "completed" | "failed" | "expired";
  providerType: string;
  label: string;
  result?: { accountId: string } | { error: string; errorCode?: string };
  expiresAt: string;
};

export type ProviderAccountSummary = {
  accountId: string;
  label: string;
  credentialMode: CredentialMode;
  enabled: boolean;
  weight: number;
  createdAt: string;
};

export type ErrorResponse = {
  error: {
    code: string;
    message: string;
    details?: Array<{ field: string; message: string }>;
  };
};

// ============================================================================
// Error Classes
// ============================================================================

export class ProviderTypeNotFoundError extends Error {
  readonly code = "provider_type_not_found" as const;
  readonly statusCode = 404 as const;

  constructor(providerType: string) {
    super(`Provider type "${providerType}" not found`);
    this.name = "ProviderTypeNotFoundError";
  }
}

export class CredentialModeUnsupportedError extends Error {
  readonly code = "credential_mode_unsupported" as const;
  readonly statusCode = 400 as const;

  constructor(mode: CredentialMode, providerType: string) {
    super(`Credential mode "${mode}" is not supported by provider "${providerType}"`);
    this.name = "CredentialModeUnsupportedError";
  }
}

export class InvalidLabelError extends Error {
  readonly code = "invalid_label" as const;
  readonly statusCode = 400 as const;

  constructor(message: string) {
    super(message);
    this.name = "InvalidLabelError";
  }
}

export class LabelConflictError extends Error {
  readonly code = "label_conflict" as const;
  readonly statusCode = 409 as const;

  constructor(label: string, providerType: string) {
    super(`Label "${label}" already exists for provider "${providerType}"`);
    this.name = "LabelConflictError";
  }
}

export class PersistFailedError extends Error {
  readonly code = "persist_failed" as const;
  readonly statusCode = 500 as const;

  constructor(message: string) {
    super(message);
    this.name = "PersistFailedError";
  }
}

export class NoProviderInstanceError extends Error {
  readonly code = "no_provider_instance" as const;
  readonly statusCode = 404 as const;

  constructor(providerType: string) {
    super(`No provider instance found for type "${providerType}"`);
    this.name = "NoProviderInstanceError";
  }
}

export class OAuthSessionInProgressError extends Error {
  readonly code = "oauth_session_in_progress" as const;
  readonly statusCode = 409 as const;

  constructor(label: string, providerType: string) {
    super(`OAuth session already in progress for label "${label}" on provider "${providerType}"`);
    this.name = "OAuthSessionInProgressError";
  }
}

export class OAuthSessionNotFoundError extends Error {
  readonly code = "oauth_session_not_found" as const;
  readonly statusCode = 404 as const;

  constructor(sessionId: string) {
    super(`OAuth session "${sessionId}" not found`);
    this.name = "OAuthSessionNotFoundError";
  }
}

export class AccountNotFoundError extends Error {
  readonly code = "account_not_found" as const;
  readonly statusCode = 404 as const;

  constructor(accountId: string) {
    super(`Account "${accountId}" not found`);
    this.name = "AccountNotFoundError";
  }
}

// ============================================================================
// Param Schemas
// ============================================================================

const providerTypeParamsSchema = z.object({
  providerType: z.string().min(1),
});

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get provider type definition from registry
 */
function getProviderDefinition(
  providerRegistry: ProviderAdapterRegistry,
  providerType: string
): ProviderTypeDefinition {
  const definitions = providerRegistry.listProviderTypes();
  const definition = definitions.find((d) => d.type === providerType);
  if (!definition) {
    throw new ProviderTypeNotFoundError(providerType);
  }
  return definition;
}

/**
 * Find provider instance and account pool for a provider type
 */
function findProviderInstanceAndPool(
  providerRuntimeRegistry: ProviderRuntimeRegistry,
  providerType: string
): { providerInstanceId: string; accountPool: AccountPool } {
  const instances = providerRuntimeRegistry.listProviderInstances();
  const instance = instances.find((i) => i.type === providerType);
  if (!instance) {
    throw new NoProviderInstanceError(providerType);
  }

  const accountPool = providerRuntimeRegistry.getAccountPool(instance.id);
  if (!accountPool) {
    throw new NoProviderInstanceError(providerType);
  }

  return { providerInstanceId: instance.id, accountPool };
}

/**
 * Check for label conflict (case-insensitive)
 */
function checkLabelConflict(
  accountPool: AccountPool,
  normalizedLabel: string,
  providerType: string
): void {
  const accounts = accountPool.listAccounts();
  const lowerLabel = normalizedLabel.toLowerCase();
  const conflict = accounts.find(
    (a) => normalizeLabel(a.displayName).toLowerCase() === lowerLabel
  );
  if (conflict) {
    throw new LabelConflictError(normalizedLabel, providerType);
  }
}

/**
 * Validate normalized label (1-64 chars)
 */
function validateNormalizedLabel(label: string): void {
  if (label.length === 0) {
    throw new InvalidLabelError("Label cannot be empty after normalization");
  }
  if (label.length > 64) {
    throw new InvalidLabelError("Label must be at most 64 characters after normalization");
  }
}

/**
 * Map credential mode to credential type for ProviderAccountSecret
 */
function credentialModeToCredentialType(
  mode: CredentialMode
): ProviderAccountSecret["credentialType"] {
  switch (mode) {
    case "api_key":
      return "api_key";
    case "refresh_token":
      return "refresh_token";
    case "mock_static":
      return "custom_json";
    case "oauth_pkce":
      return "oauth";
    default: {
      const _exhaustive: never = mode;
      throw new Error(`Unknown credential mode: ${_exhaustive}`);
    }
  }
}

/**
 * Build credential payload for encryption
 */
function buildCredentialPayload(
  mode: CredentialMode,
  credentials: AddAccountRequestRaw["credentials"]
): Record<string, unknown> {
  switch (mode) {
    case "api_key":
      return { apiKey: credentials?.apiKey };
    case "refresh_token":
      return { refreshToken: credentials?.refreshToken };
    case "mock_static":
      return { mockToken: credentials?.mockToken };
    case "oauth_pkce":
      // OAuth PKCE doesn't have credentials in initial request
      return {};
    default: {
      const _exhaustive: never = mode;
      throw new Error(`Unknown credential mode: ${_exhaustive}`);
    }
  }
}

/**
 * Create ProviderAccount from AccountDraft
 */
function createProviderAccount(
  draft: AccountDraft,
  providerType: string,
  providerInstanceId: string
): ProviderAccount {
  const accountId = `account_${randomUUID()}`;
  const credentialRef = `secret_${accountId}`;
  const now = new Date();

  return {
    id: accountId,
    providerInstanceId,
    providerType,
    displayName: draft.label,
    status: draft.enabled ? "active" : "disabled",
    weight: draft.weight,
    maxConcurrency: draft.maxConcurrency,
    credentialRef,
    allowedModels: draft.allowedModels,
    tags: draft.tags,
    owner: draft.owner,
    runtime: {
      activeRequests: 0,
      totalRequests: 0,
      failedRequests: 0,
      consecutiveFailures: 0,
    },
    metadata: {
      credentialMode: draft.credentialMode,
    },
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Build AddAccountResponse from ProviderAccount
 */
function buildAddAccountResponse(
  account: ProviderAccount,
  credentialMode: CredentialMode
): AddAccountResponse {
  return {
    accountId: account.id,
    providerType: account.providerType,
    credentialMode,
    label: account.displayName,
    enabled: account.status === "active",
    weight: account.weight,
    createdAt: account.createdAt.toISOString(),
  };
}

/**
 * Build error response
 */
function buildErrorResponse(
  code: string,
  message: string,
  details?: Array<{ field: string; message: string }>
): ErrorResponse {
  return {
    error: {
      code,
      message,
      ...(details && { details }),
    },
  };
}

/**
 * Generate base64url encoded random bytes
 */
function base64Url(buffer: Buffer): string {
  return buffer
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

/**
 * Generate OAuth PKCE state (32 bytes base64url)
 */
function generateOAuthState(): string {
  return base64Url(randomBytes(32));
}

/**
 * Generate OAuth PKCE code verifier (64 chars)
 */
function generateCodeVerifier(): string {
  // 48 bytes = 64 chars in base64url
  return base64Url(randomBytes(48));
}

/**
 * Generate OAuth PKCE code challenge from verifier
 */
function generateCodeChallenge(codeVerifier: string): string {
  return base64Url(createHash("sha256").update(codeVerifier).digest());
}

/**
 * Build OAuth authorization URL
 */
function buildAuthorizationUrl(
  authorizationEndpoint: string,
  state: string,
  codeChallenge: string,
  redirectUri: string,
  clientId?: string,
  scope?: string,
  extraParams?: Record<string, string>
): string {
  const url = new URL(authorizationEndpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("redirect_uri", redirectUri);
  
  if (clientId) {
    url.searchParams.set("client_id", clientId);
  }
  if (scope) {
    url.searchParams.set("scope", scope);
  }
  if (extraParams) {
    for (const [key, value] of Object.entries(extraParams)) {
      if (value) {
        url.searchParams.set(key, value);
      }
    }
  }
  
  return url.toString();
}

/**
 * Get OAuth authorization endpoint for a provider type.
 * Checks the definition's oauthConfig first, then falls back to known endpoints.
 */
function getOAuthAuthorizationEndpoint(
  definition: ProviderTypeDefinition,
  providerType: string
): string {
  // Check if provider definition has oauthConfig (new multi-provider OAuth PKCE flow)
  if (definition.oauthConfig?.authorizationEndpoint) {
    return definition.oauthConfig.authorizationEndpoint;
  }

  // Known OAuth endpoints for common providers (legacy)
  const knownEndpoints: Record<string, string> = {
    kiro: "https://app.kiro.dev/signin",
    google: "https://accounts.google.com/o/oauth2/v2/auth",
    github: "https://github.com/login/oauth/authorize",
    microsoft: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
  };

  const endpoint = knownEndpoints[providerType];
  if (endpoint) {
    return endpoint;
  }

  // Fallback: check if provider has OAuth config in configSchema
  const configSchema = definition.configSchema as { authorizationEndpoint?: string } | undefined;
  if (configSchema?.authorizationEndpoint) {
    return configSchema.authorizationEndpoint;
  }

  // Default fallback
  throw new Error(`OAuth authorization endpoint not configured for provider "${providerType}"`);
}

/**
 * Handle known errors and send appropriate response
 */
function handleError(
  error: unknown,
  reply: FastifyReply
): ErrorResponse {
  // ZodError
  if (error instanceof ZodError) {
    const details = error.errors.map((e) => ({
      field: e.path.join("."),
      message: e.message,
    }));
    reply.code(400);
    return buildErrorResponse("invalid_request_payload", "Invalid request payload", details);
  }

  // CredentialValidationError
  if (error instanceof CredentialValidationError) {
    reply.code(error.statusCode);
    return buildErrorResponse(
      error.code,
      error.message,
      error.field ? [{ field: error.field, message: error.message }] : undefined
    );
  }

  // Known error types with code and statusCode
  if (
    error instanceof ProviderTypeNotFoundError ||
    error instanceof CredentialModeUnsupportedError ||
    error instanceof InvalidLabelError ||
    error instanceof LabelConflictError ||
    error instanceof PersistFailedError ||
    error instanceof NoProviderInstanceError ||
    error instanceof OAuthSessionInProgressError ||
    error instanceof OAuthSessionNotFoundError ||
    error instanceof AccountNotFoundError
  ) {
    reply.code(error.statusCode);
    return buildErrorResponse(error.code, error.message);
  }

  // AddAccountLockTimeoutError
  if (
    error instanceof Error &&
    "code" in error &&
    error.code === "add_account_in_progress"
  ) {
    reply.code(409);
    return buildErrorResponse("add_account_in_progress", error.message);
  }

  // Unknown error
  reply.code(500);
  return buildErrorResponse(
    "internal_error",
    error instanceof Error ? error.message : "An unexpected error occurred"
  );
}

// ============================================================================
// Route Registration
// ============================================================================

export async function registerProviderAccountRoutes(
  app: FastifyInstance,
  config: AppConfig,
  deps: ProviderAccountRouteDeps
): Promise<void> {
  const adminAuth = createAdminAuthMiddleware(config);

  const {
    providerRegistry,
    providerRuntimeRegistry,
    secretService,
    addAccountLockService,
    idempotencyStore,
    addAccountRateLimiter,
    adminAuditService,
    persistenceService,
  } = deps;

  // ==========================================================================
  // POST /admin/v1/providers/:providerType/accounts
  // Add account (synchronous modes: api_key, refresh_token, mock_static)
  // ==========================================================================
  app.post<{
    Params: { providerType: string };
    Body: unknown;
  }>(
    "/admin/v1/providers/:providerType/accounts",
    {
      preHandler: adminAuth,
    },
    async (request, reply) => {
      const actorKeyHash = request.adminAuth?.apiKeyHash;

      try {
        // 1. Parse and validate params
        const { providerType } = providerTypeParamsSchema.parse(request.params);

        // 2. Rate limit check
        const rateLimitResult = addAccountRateLimiter.checkAndConsume(actorKeyHash ?? "anonymous");
        if (!rateLimitResult.allowed) {
          reply.code(429);
          // Calculate retry-after based on minute window
          const minuteWindowStart = new Date(rateLimitResult.snapshot.minuteWindowStart).getTime();
          const retryAfterSeconds = Math.max(1, Math.ceil((minuteWindowStart + 60000 - Date.now()) / 1000));
          reply.header("Retry-After", String(retryAfterSeconds));
          return buildErrorResponse("rate_limited", rateLimitResult.message);
        }

        // 3. Idempotency check
        const idempotencyKey = request.headers["idempotency-key"];
        if (typeof idempotencyKey === "string" && idempotencyKey.length > 0) {
          const cached = idempotencyStore.get(idempotencyKey);
          if (cached) {
            reply.code(cached.statusCode);
            return cached.body;
          }
        }

        // 4. Get provider definition
        const definition = getProviderDefinition(providerRegistry, providerType);

        // 5. Parse and validate request body
        const rawRequest = parseAddAccountRequest(request.body);

        // 6. Check credential mode is supported
        if (!isCredentialModeSupported(definition, rawRequest.credentialMode)) {
          throw new CredentialModeUnsupportedError(rawRequest.credentialMode, providerType);
        }

        // 7. Normalize request
        const draft = normalizeAddAccountRequest(rawRequest);

        // 8. Validate normalized label
        validateNormalizedLabel(draft.label);

        // 9. Handle OAuth PKCE (async flow - returns 202)
        if (draft.credentialMode === "oauth_pkce") {
          // Find provider instance and account pool
          const { providerInstanceId, accountPool } = findProviderInstanceAndPool(
            providerRuntimeRegistry,
            providerType
          );

          // Check for existing active OAuth session
          if (deps.oauthSessionStore.hasActiveSession(providerType, draft.label)) {
            throw new OAuthSessionInProgressError(draft.label, providerType);
          }

          // Check label conflict
          checkLabelConflict(accountPool, draft.label, providerType);

          // Generate OAuth PKCE parameters
          const state = generateOAuthState();
          const codeVerifier = generateCodeVerifier();
          const codeChallenge = generateCodeChallenge(codeVerifier);
          const oauthSessionId = randomUUID();
          const expiresAt = Date.now() + 600_000; // 10 minutes

          // Build authorization URL using oauthConfig from definition if available
          const redirectUri = definition.oauthConfig?.redirectUri ?? "http://127.0.0.1:3100/oauth/callback";
          const authorizationEndpoint = getOAuthAuthorizationEndpoint(definition, providerType);
          const clientId = definition.oauthConfig?.clientId;
          const scope = definition.oauthConfig?.scope;
          const authorizationUrl = buildAuthorizationUrl(
            authorizationEndpoint,
            state,
            codeChallenge,
            redirectUri,
            clientId,
            scope
          );

          // Create OAuth session
          deps.oauthSessionStore.create({
            id: oauthSessionId,
            state,
            codeVerifier,
            codeChallenge,
            providerType,
            normalizedLabel: draft.label,
            accountDraft: draft,
            authorizationUrl,
            expiresAt,
          });

          // Audit
          adminAuditService.record({
            action: "provider.account.oauth.start",
            actorKeyHash,
            targetType: "oauth_session",
            targetId: oauthSessionId,
          });

          // Return 202 with OAuth session info
          const response: { data: OAuthStartResponse } = {
            data: {
              oauthSessionId,
              authorizationUrl,
              expiresAt: new Date(expiresAt).toISOString(),
            },
          };

          reply.code(202);
          return response;
        }

        // 10. Find provider instance and account pool
        const { providerInstanceId, accountPool } = findProviderInstanceAndPool(
          providerRuntimeRegistry,
          providerType
        );

        // 11. Acquire lock and execute
        const result = await addAccountLockService.acquire(
          providerType,
          draft.label,
          async () => {
            // 12. Check label conflict (inside lock)
            checkLabelConflict(accountPool, draft.label, providerType);

            // 13. Create account
            const account = createProviderAccount(draft, providerType, providerInstanceId);

            // 14. Build and encrypt credential payload
            const credentialPayload = buildCredentialPayload(
              draft.credentialMode,
              rawRequest.credentials
            );

            // 15. Add secret to SecretService
            secretService.addCredentialPayload({
              id: account.credentialRef,
              accountId: account.id,
              credentialType: credentialModeToCredentialType(draft.credentialMode),
              credentialPayload,
            });

            // 16. Add account to pool
            accountPool.addAccount(account);

            // 17. Persist state
            try {
              await persistenceService.save(createPersistedState(app));
            } catch (persistError) {
              // Rollback: remove account and secret
              accountPool.removeAccount(account.id);
              secretService.deleteSecretForAccount(account.id);
              throw new PersistFailedError(
                persistError instanceof Error ? persistError.message : "Failed to persist state"
              );
            }

            // 18. Audit
            adminAuditService.record({
              action: "provider.account.add",
              actorKeyHash,
              targetType: "account",
              targetId: account.id,
            });

            return account;
          }
        );

        // 19. Build response
        const response: { data: AddAccountResponse } = {
          data: buildAddAccountResponse(result, draft.credentialMode),
        };

        // 20. Store in idempotency cache
        if (typeof idempotencyKey === "string" && idempotencyKey.length > 0) {
          idempotencyStore.set(idempotencyKey, 201, response);
        }

        reply.code(201);
        return response;
      } catch (error) {
        // Audit failure
        if (
          error instanceof Error &&
          !(error instanceof ZodError) &&
          !("statusCode" in error && (error as { statusCode: number }).statusCode < 500)
        ) {
          adminAuditService.record({
            action: "provider.account.add.failed",
            actorKeyHash,
            targetType: "account",
            targetId: request.params.providerType,
          });
        }

        return handleError(error, reply);
      }
    }
  );

  // ==========================================================================
  // GET /admin/v1/oauth-sessions/:oauthSessionId
  // Poll OAuth session status
  // ==========================================================================
  app.get<{
    Params: { oauthSessionId: string };
  }>(
    "/admin/v1/oauth-sessions/:oauthSessionId",
    {
      preHandler: adminAuth,
    },
    async (request, reply) => {
      try {
        const { oauthSessionId } = z
          .object({ oauthSessionId: z.string().min(1) })
          .parse(request.params);

        const session = deps.oauthSessionStore.getById(oauthSessionId);
        if (!session) {
          throw new OAuthSessionNotFoundError(oauthSessionId);
        }

        const response: { data: OAuthSessionStatusResponse } = {
          data: {
            id: session.id,
            status: session.status,
            providerType: session.providerType,
            label: session.normalizedLabel,
            result: session.result,
            expiresAt: new Date(session.expiresAt).toISOString(),
          },
        };

        return response;
      } catch (error) {
        return handleError(error, reply);
      }
    }
  );

  // ==========================================================================
  // GET /admin/v1/providers/:providerType/accounts
  // List accounts for a provider type (no secrets)
  // ==========================================================================
  app.get<{
    Params: { providerType: string };
  }>(
    "/admin/v1/providers/:providerType/accounts",
    {
      preHandler: adminAuth,
    },
    async (request, reply) => {
      try {
        const { providerType } = providerTypeParamsSchema.parse(request.params);

        // Verify provider type exists
        getProviderDefinition(providerRegistry, providerType);

        // Find provider instance and account pool
        const { accountPool } = findProviderInstanceAndPool(
          providerRuntimeRegistry,
          providerType
        );

        // Get accounts and map to summary (no secrets)
        const accounts = accountPool.listAccounts();
        const summaries: ProviderAccountSummary[] = accounts.map((account) => ({
          accountId: account.id,
          label: account.displayName,
          credentialMode: (account.metadata?.credentialMode as CredentialMode) ?? "api_key",
          enabled: account.status === "active",
          weight: account.weight,
          createdAt: account.createdAt.toISOString(),
        }));

        return { data: summaries };
      } catch (error) {
        return handleError(error, reply);
      }
    }
  );

  // ==========================================================================
  // DELETE /admin/v1/providers/:providerType/accounts/:accountId
  // Delete an account
  // ==========================================================================
  app.delete<{
    Params: { providerType: string; accountId: string };
  }>(
    "/admin/v1/providers/:providerType/accounts/:accountId",
    {
      preHandler: adminAuth,
    },
    async (request, reply) => {
      const actorKeyHash = request.adminAuth?.apiKeyHash;

      try {
        const { providerType, accountId } = z
          .object({
            providerType: z.string().min(1),
            accountId: z.string().min(1),
          })
          .parse(request.params);

        // Verify provider type exists
        getProviderDefinition(providerRegistry, providerType);

        // Find provider instance and account pool
        const { accountPool } = findProviderInstanceAndPool(
          providerRuntimeRegistry,
          providerType
        );

        // Check if account exists
        const account = accountPool.getAccount(accountId);
        if (!account) {
          throw new AccountNotFoundError(accountId);
        }

        // Remove account from pool
        accountPool.removeAccount(accountId);

        // Delete secret
        secretService.deleteSecretForAccount(accountId);

        // Persist state
        try {
          await persistenceService.save(createPersistedState(app));
        } catch (persistError) {
          // Rollback: re-add account (but secret is lost)
          accountPool.addAccount(account);
          throw new PersistFailedError(
            persistError instanceof Error ? persistError.message : "Failed to persist state"
          );
        }

        // Audit
        adminAuditService.record({
          action: "provider.account.delete",
          actorKeyHash,
          targetType: "account",
          targetId: accountId,
        });

        reply.code(204);
        return;
      } catch (error) {
        return handleError(error, reply);
      }
    }
  );
}

// ============================================================================
// Helper to create persisted state (same as in app.ts)
// ============================================================================

function createPersistedState(app: FastifyInstance) {
  return {
    providerInstances: app.providerRuntimeRegistry.listProviderInstances(),
    accounts: app.providerRuntimeRegistry.listAccounts(),
    modelMappings: app.modelRegistry.listModelMappings(),
    routingProfiles: app.routingProfileRegistry.listRoutingProfiles(),
    apiKeys: app.apiKeyService.list(),
    secrets: app.secretService.listSecrets(),
    config: {
      current: app.configRevisionService.getCurrent(),
      revisions: app.configRevisionService.listRevisions(),
    },
  };
}
