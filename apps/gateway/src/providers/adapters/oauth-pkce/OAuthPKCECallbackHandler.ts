/**
 * Generic OAuth PKCE Callback Handler.
 *
 * Manages the OAuth PKCE flow for any provider that has an OAuthProviderConfig:
 * - Stores pending OAuth state (state → {codeVerifier, providerType, redirectUri}) in memory
 * - Validates state on callback
 * - Exchanges authorization code for tokens via OAuthPKCEAdapter
 * - Stores tokens encrypted via SecretService
 * - Creates ProviderAccount with status "active" after successful exchange
 *
 * @module providers/adapters/oauth-pkce/OAuthPKCECallbackHandler
 */

import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { OAuthProviderConfig } from "../../registry/ProviderTypeDefinition.js";
import type { ProviderAccount } from "../../base/ProviderAccount.js";
import { OAuthPKCEAdapter } from "./OAuthPKCEAdapter.js";
import type { OAuthStartResult, OAuthTokenResponse } from "./OAuthPKCEAdapter.js";
import { getOAuthProviderConfig } from "./oauthProviderConfigs.js";

// ============================================================================
// Types
// ============================================================================

/**
 * Pending OAuth state stored in memory for callback validation.
 */
export type PendingOAuthState = {
  codeVerifier: string;
  providerType: string;
  redirectUri: string;
  createdAt: number;
  /** Optional account draft info for creating the account on callback */
  accountDraft?: {
    displayName: string;
    owner?: string;
    maxConcurrency: number;
    weight: number;
    allowedModels?: string[];
    tags?: string[];
  };
};

/**
 * Result of initiating an OAuth PKCE flow.
 */
export type OAuthPKCEFlowStartResult = {
  authorizationUrl: string;
  state: string;
};

/**
 * Result of completing an OAuth PKCE callback.
 */
export type OAuthPKCECallbackResult = {
  success: boolean;
  accountId?: string;
  error?: string;
};

// ============================================================================
// In-memory pending state store
// ============================================================================

/**
 * In-memory store for pending OAuth PKCE states.
 * Maps state → PendingOAuthState for callback validation.
 *
 * States expire after 10 minutes (600,000ms).
 */
const pendingOAuthStates = new Map<string, PendingOAuthState>();

const STATE_TTL_MS = 600_000; // 10 minutes

/**
 * Clean up expired pending states.
 */
function cleanupExpiredStates(): void {
  const now = Date.now();
  for (const [state, pending] of pendingOAuthStates.entries()) {
    if (now - pending.createdAt > STATE_TTL_MS) {
      pendingOAuthStates.delete(state);
    }
  }
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Get the pending OAuth states map (for testing/inspection).
 */
export function getPendingOAuthStates(): ReadonlyMap<string, PendingOAuthState> {
  return pendingOAuthStates;
}

/**
 * Clear all pending OAuth states (for testing).
 */
export function clearPendingOAuthStates(): void {
  pendingOAuthStates.clear();
}

/**
 * Start an OAuth PKCE flow for a given provider type.
 *
 * Uses the OAuthPKCEAdapter to generate code_verifier, code_challenge, state,
 * and build the authorization URL. Stores the pending state in memory.
 *
 * @param providerType - The provider type (e.g., "claude_code", "github_copilot")
 * @param oauthConfig - The OAuth configuration for the provider (optional, looked up by providerType if not provided)
 * @param accountDraft - Optional account draft info for creating the account on callback
 * @returns The authorization URL and state token
 * @throws Error if no OAuth config found for the provider type
 */
export function startOAuthPKCEFlow(
  providerType: string,
  oauthConfig?: OAuthProviderConfig,
  accountDraft?: PendingOAuthState["accountDraft"]
): OAuthPKCEFlowStartResult {
  // Clean up expired states periodically
  cleanupExpiredStates();

  const config = oauthConfig ?? getOAuthProviderConfig(providerType);
  if (!config) {
    throw new Error(
      `No OAuth configuration found for provider type "${providerType}". ` +
      `Supported OAuth providers: claude_code, github_copilot, cursor, codex, antigravity`
    );
  }

  const adapter = new OAuthPKCEAdapter();
  const result: OAuthStartResult = adapter.startOAuthFlow(config);

  // Store pending state for callback validation
  pendingOAuthStates.set(result.state, {
    codeVerifier: result.codeVerifier,
    providerType,
    redirectUri: config.redirectUri,
    createdAt: Date.now(),
    accountDraft,
  });

  return {
    authorizationUrl: result.authorizationUrl,
    state: result.state,
  };
}

/**
 * Handle an OAuth PKCE callback for a generic provider.
 *
 * Validates the state, exchanges the authorization code for tokens,
 * stores tokens encrypted via SecretService, and creates a ProviderAccount
 * with status "active".
 *
 * @param app - The Fastify instance (for accessing services)
 * @param state - The state parameter from the callback
 * @param code - The authorization code from the callback
 * @returns The callback result with account ID or error
 */
export async function handleOAuthPKCECallback(
  app: FastifyInstance,
  state: string,
  code: string
): Promise<OAuthPKCECallbackResult> {
  // 1. Validate state — look up pending state
  const pending = pendingOAuthStates.get(state);
  if (!pending) {
    return {
      success: false,
      error: "Invalid or expired OAuth state. Please restart the authorization flow.",
    };
  }

  // Check if state has expired
  if (Date.now() - pending.createdAt > STATE_TTL_MS) {
    pendingOAuthStates.delete(state);
    return {
      success: false,
      error: "OAuth state has expired. Please restart the authorization flow.",
    };
  }

  // 2. Get OAuth config for the provider
  const oauthConfig = getOAuthProviderConfig(pending.providerType);
  if (!oauthConfig) {
    pendingOAuthStates.delete(state);
    return {
      success: false,
      error: `No OAuth configuration found for provider type "${pending.providerType}"`,
    };
  }

  // 3. Exchange authorization code for tokens
  let tokenResponse: OAuthTokenResponse;
  try {
    const adapter = new OAuthPKCEAdapter();
    tokenResponse = await adapter.exchangeCode(
      code,
      pending.codeVerifier,
      pending.redirectUri,
      oauthConfig
    );
  } catch (error) {
    pendingOAuthStates.delete(state);
    return {
      success: false,
      error: error instanceof Error
        ? `Token exchange failed: ${error.message}`
        : "Token exchange failed",
    };
  }

  // 4. Find provider instance and account pool
  const instances = app.providerRuntimeRegistry.listProviderInstances();
  const providerInstance = instances.find((i) => i.type === pending.providerType);
  if (!providerInstance) {
    pendingOAuthStates.delete(state);
    return {
      success: false,
      error: `Provider instance for "${pending.providerType}" not found. Ensure the provider is registered.`,
    };
  }

  const accountPool = app.providerRuntimeRegistry.getAccountPool(providerInstance.id);
  if (!accountPool) {
    pendingOAuthStates.delete(state);
    return {
      success: false,
      error: `Account pool for provider "${pending.providerType}" not found.`,
    };
  }

  // 5. Create account and store tokens
  const now = new Date();
  const accountId = `account_${randomUUID()}`;
  const credentialRef = `secret_${accountId}`;

  const expiresAt = tokenResponse.expires_in
    ? new Date(now.getTime() + tokenResponse.expires_in * 1000).toISOString()
    : undefined;

  // Build encrypted credential payload
  const credentialPayload: Record<string, unknown> = {
    accessToken: tokenResponse.access_token,
    refreshToken: tokenResponse.refresh_token,
    tokenType: tokenResponse.token_type ?? "Bearer",
    expiresAt,
    scope: tokenResponse.scope,
    provider: pending.providerType,
    grantType: "authorization_code_pkce",
    codeVerifier: pending.codeVerifier,
    state,
    exchangedAt: now.toISOString(),
  };

  // 6. Store tokens encrypted via SecretService
  app.secretService.addCredentialPayload({
    id: credentialRef,
    accountId,
    credentialType: "oauth",
    credentialPayload,
  });

  // 7. Create ProviderAccount with status "active"
  const draft = pending.accountDraft;
  const account: ProviderAccount = {
    id: accountId,
    providerInstanceId: providerInstance.id,
    providerType: pending.providerType,
    displayName: draft?.displayName ?? `${pending.providerType} account`,
    status: "active",
    weight: draft?.weight ?? 1,
    maxConcurrency: draft?.maxConcurrency ?? 5,
    credentialRef,
    allowedModels: draft?.allowedModels,
    tags: draft?.tags,
    owner: draft?.owner,
    runtime: {
      activeRequests: 0,
      totalRequests: 0,
      failedRequests: 0,
      consecutiveFailures: 0,
    },
    metadata: {
      credentialMode: "oauth_pkce",
      oauthState: state,
      oauthProvider: pending.providerType,
    },
    createdAt: now,
    updatedAt: now,
  };

  accountPool.addAccount(account);

  // 8. Audit
  app.adminAuditService.record({
    action: "account.oauth_pkce_callback_create",
    targetType: "account",
    targetId: accountId,
  });

  // 9. Persist state
  void app.persistenceService.save({
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
  });

  // 10. Clean up pending state
  pendingOAuthStates.delete(state);

  return {
    success: true,
    accountId,
  };
}

/**
 * Check if a state belongs to a generic OAuth PKCE provider.
 * Used by the callback route to determine if this handler should process the callback.
 */
export function isGenericOAuthPKCEState(state: string): boolean {
  return pendingOAuthStates.has(state);
}
