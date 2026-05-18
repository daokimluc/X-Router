import { z } from "zod";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ProviderAccount } from "../providers/base/ProviderAccount.js";
import { applyKiroToken, KiroAuthClient } from "../providers/adapters/kiro/KiroAuthClient.js";
import type { KiroCredentialPayload } from "../providers/adapters/kiro/kiroTypes.js";
import type { OAuthSessionStore } from "../services/OAuthSessionStore.js";
import {
  isGenericOAuthPKCEState,
  handleOAuthPKCECallback,
} from "../providers/adapters/oauth-pkce/OAuthPKCECallbackHandler.js";

export type OAuthCallbackRecord = {
  state: string;
  code?: string;
  token?: string;
  error?: string;
  query: Record<string, string>;
  receivedAt: string;
  accountId?: string;
  accountCreated?: boolean;
  tokenExchanged?: boolean;
};

export type OAuthPendingAccount = {
  state: string;
  codeVerifier: string;
  codeChallenge: string;
  authorizationUrl: string;
  responseType: "code" | "token";
  providerType: string;
  providerInstanceId: string;
  accountId: string;
  displayName: string;
  owner?: string;
  maxConcurrency: number;
  weight: number;
  allowedModels?: string[];
  tags?: string[];
  redirectUri: string;
  createdAt: string;
};

const oauthCallbacks = new Map<string, OAuthCallbackRecord>();
const oauthPendingAccounts = new Map<string, OAuthPendingAccount>();

const callbackQuerySchema = z
  .object({
    state: z.string().min(1),
    code: z.string().optional(),
    error: z.string().optional()
  })
  .catchall(z.union([z.string(), z.array(z.string())]).optional());

export async function registerOAuthRoutes(
  app: FastifyInstance,
  oauthSessionStore?: OAuthSessionStore
): Promise<void> {
  async function handleCallback(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<string> {
    const parsed = callbackQuerySchema.parse(request.query);
    const query = Object.fromEntries(
      Object.entries(parsed).map(([key, value]) => [
        key,
        Array.isArray(value) ? value.join(",") : value ?? ""
      ])
    );
    const token = extractToken(query);

    const record: OAuthCallbackRecord = {
      state: parsed.state,
      code: parsed.code,
      token,
      error: parsed.error,
      query,
      receivedAt: new Date().toISOString()
    };

    // First, check if this is a callback for OAuthSessionStore (new add-account flow)
    if (oauthSessionStore && (parsed.code || token) && !parsed.error) {
      const session = oauthSessionStore.getByState(parsed.state);
      if (session && session.status === "pending") {
        await completeOAuthSessionCallback(app, oauthSessionStore, session.id, parsed.code, token, query);
        record.accountCreated = true;
      }
    }

    // Then check generic OAuth PKCE providers (Claude Code, GitHub Copilot, Cursor, Codex, Antigravity)
    if (parsed.code && !parsed.error && !record.accountCreated) {
      if (isGenericOAuthPKCEState(parsed.state)) {
        const callbackResult = await handleOAuthPKCECallback(app, parsed.state, parsed.code);
        if (callbackResult.success) {
          record.accountId = callbackResult.accountId;
          record.accountCreated = true;
          record.tokenExchanged = true;
        } else {
          record.error = callbackResult.error;
        }
      }
    }

    // Then check legacy pending accounts
    if ((parsed.code || token) && !parsed.error && !record.accountCreated) {
      const pending = oauthPendingAccounts.get(parsed.state);
      if (pending) {
        await completePendingOAuthAccount(app, pending, record);
      }
    }

    oauthCallbacks.set(parsed.state, record);

    reply.type("text/html");
    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>OAuth callback received</title>
    <style>
      body { margin: 0; font-family: Inter, system-ui, sans-serif; background: #fdfaf6; color: #141414; display: grid; min-height: 100vh; place-items: center; }
      main { width: min(520px, calc(100vw - 32px)); border: 1px solid #e5e0d8; border-radius: 14px; background: #fff; padding: 24px; box-shadow: 0 20px 50px -36px rgba(15,23,42,.45); }
      h1 { margin: 0 0 8px; font-size: 20px; }
      p { margin: 0; color: #6b7280; line-height: 1.5; }
      a { display: inline-flex; margin-top: 16px; border-radius: 10px; background: #e56a4a; color: #fff; padding: 10px 12px; text-decoration: none; font-weight: 700; }
      code { display: block; margin-top: 14px; padding: 10px; border-radius: 10px; background: #f4f4f5; overflow: auto; }
    </style>
  </head>
  <body>
    <main>
      <h1>OAuth callback received</h1>
      <p>${record.accountCreated ? "The account was added to the gateway. You can return to the dashboard." : "You can return to the dashboard and check the callback for this state."}</p>
      <code>${escapeHtml(parsed.state)}</code>
      <a href="http://127.0.0.1:3000">Return to dashboard</a>
    </main>
  </body>
</html>`;
  }

  app.get("/oauth/callback", handleCallback);
  app.get("/windsurf-auth-callback", handleCallback);
}

export function createOAuthPendingAccount(options: {
  providerType: string;
  providerInstanceId: string;
  accountId: string;
  displayName: string;
  owner?: string;
  maxConcurrency: number;
  weight: number;
  allowedModels?: string[];
  tags?: string[];
  authorizationEndpoint: string;
  redirectUri: string;
  scope?: string;
  redirectFrom?: string;
  clientId?: string;
  extraParams?: Record<string, string>;
}): OAuthPendingAccount {
  const state = base64Url(randomBytes(24));
  const codeVerifier = base64Url(randomBytes(24));
  const codeChallenge = base64Url(createHash("sha256").update(codeVerifier).digest());
  const url = new URL(options.authorizationEndpoint);
  const responseType = options.providerType === "windsurf" ? "token" : "code";

  url.searchParams.set("state", state);
  if (options.providerType !== "kiro") {
    url.searchParams.set("response_type", responseType);
  }
  if (options.clientId) {
    url.searchParams.set("client_id", options.clientId);
  }
  if (responseType === "code") {
    url.searchParams.set("code_challenge", codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");
  }
  url.searchParams.set("redirect_uri", options.redirectUri);
  if (options.scope) {
    url.searchParams.set("scope", options.scope);
  }
  if (options.redirectFrom) {
    url.searchParams.set("redirect_from", options.redirectFrom);
  }
  if (options.extraParams) {
    for (const [key, value] of Object.entries(options.extraParams)) {
      if (value) {
        url.searchParams.set(key, value);
      }
    }
  }

  const pending: OAuthPendingAccount = {
    state,
    codeVerifier,
    codeChallenge,
    authorizationUrl: url.toString(),
    responseType,
    providerType: options.providerType,
    providerInstanceId: options.providerInstanceId,
    accountId: options.accountId,
    displayName: options.displayName,
    owner: options.owner,
    maxConcurrency: options.maxConcurrency,
    weight: options.weight,
    allowedModels: options.allowedModels,
    tags: options.tags,
    redirectUri: options.redirectUri,
    createdAt: new Date().toISOString()
  };

  oauthPendingAccounts.set(state, pending);
  return structuredClone(pending);
}

export function getOAuthCallback(state: string): OAuthCallbackRecord | undefined {
  const record = oauthCallbacks.get(state);
  return record ? structuredClone(record) : undefined;
}

export async function completeOAuthCallbackFromUrl(
  app: FastifyInstance,
  callbackUrl: string,
  expectedState?: string
): Promise<OAuthCallbackRecord> {
  const url = new URL(callbackUrl);
  const query = Object.fromEntries(url.searchParams.entries());
  const state = query.state;

  if (!state) {
    throw new Error("OAuth callback URL is missing state");
  }

  if (expectedState && expectedState !== state) {
    throw new Error("OAuth callback state does not match the pending authorization");
  }

  const token = extractToken(query);
  const record: OAuthCallbackRecord = {
    state,
    code: query.code,
    token,
    error: query.error,
    query,
    receivedAt: new Date().toISOString()
  };

  if ((record.code || record.token) && !record.error) {
    const pending = oauthPendingAccounts.get(state);
    if (pending) {
      await completePendingOAuthAccount(app, pending, record);
    }
  }

  oauthCallbacks.set(state, record);
  return structuredClone(record);
}

export async function exchangeOAuthCallbackAccount(
  app: FastifyInstance,
  state: string
): Promise<OAuthCallbackRecord> {
  const callback = oauthCallbacks.get(state);
  const account = findOAuthAccount(app, state, callback?.accountId);

  if (!callback && !account) {
    throw new Error(`OAuth callback ${state} not found`);
  }

  const record =
    callback ??
    ({
      state,
      query: {},
      receivedAt: new Date().toISOString(),
      accountId: account?.id,
      accountCreated: Boolean(account)
    } satisfies OAuthCallbackRecord);

  if (!account) {
    record.error = `OAuth account for state ${state} not found`;
    oauthCallbacks.set(state, record);
    return structuredClone(record);
  }

  const secret = app.secretService.getSecretForAccount(account.id);
  if (!secret) {
    record.error = `Credential secret for ${account.id} not found`;
    oauthCallbacks.set(state, record);
    return structuredClone(record);
  }

  const credential = app.secretService.decryptSecretPayload(secret) as KiroCredentialPayload & {
    provider?: string;
    callbackQuery?: Record<string, string>;
  };

  if (credential.provider !== "kiro" && account.providerType !== "kiro") {
    record.error = "OAuth token exchange is only supported for Kiro accounts";
    oauthCallbacks.set(state, record);
    return structuredClone(record);
  }

  if (credential.accessToken && credential.refreshToken) {
    record.accountId = account.id;
    record.accountCreated = true;
    record.tokenExchanged = true;
    oauthCallbacks.set(state, record);
    return structuredClone(record);
  }

  if (!credential.code || !credential.codeVerifier) {
    record.error = "Kiro OAuth code or code verifier is missing";
    oauthCallbacks.set(state, record);
    return structuredClone(record);
  }

  const token = await new KiroAuthClient().exchangeAuthorizationCode({
    code: credential.code,
    codeVerifier: credential.codeVerifier,
    redirectUri: credential.redirectUri,
    region: credential.region,
    loginOption:
      credential.callbackQuery && typeof credential.callbackQuery.login_option === "string"
        ? credential.callbackQuery.login_option
        : undefined
  });
  const updatedCredential = applyKiroToken(credential, token);

  app.secretService.addCredentialPayload({
    id: account.credentialRef,
    accountId: account.id,
    credentialType: "oauth",
    credentialPayload: {
      ...credential,
      ...updatedCredential,
      tokenType: token.tokenType,
      profileArn: token.profileArn ?? updatedCredential.profileArn,
      grantType: "authorization_code_pkce",
      exchangedAt: new Date().toISOString()
    }
  });

  await saveRuntimeState(app);
  record.accountId = account.id;
  record.accountCreated = true;
  record.tokenExchanged = true;
  record.error = undefined;
  oauthCallbacks.set(state, record);
  return structuredClone(record);
}

async function completePendingOAuthAccount(
  app: FastifyInstance,
  pending: OAuthPendingAccount,
  callback: OAuthCallbackRecord
): Promise<void> {
  const providerInstance = app.providerRuntimeRegistry.getProviderInstance(
    pending.providerInstanceId
  );
  const accountPool = providerInstance
    ? app.providerRuntimeRegistry.getAccountPool(providerInstance.id)
    : undefined;

  if (!providerInstance || !accountPool) {
    callback.error = `Provider instance ${pending.providerInstanceId} not found`;
    return;
  }

  const now = new Date();
  const credentialRef = `secret_${pending.accountId}`;
  let credentialPayload: Record<string, unknown> = {
    provider: pending.providerType,
    grantType:
      pending.responseType === "token"
        ? "implicit_token"
        : "authorization_code_pkce",
    code: callback.code,
    token: callback.token,
    codeVerifier: pending.codeVerifier,
    codeChallenge: pending.codeChallenge,
    responseType: pending.responseType,
    redirectUri: pending.redirectUri,
    state: pending.state,
    callbackQuery: callback.query
  };

  if (pending.providerType === "kiro" && callback.code) {
    try {
      const token = await new KiroAuthClient().exchangeAuthorizationCode({
        code: callback.code,
        codeVerifier: pending.codeVerifier,
        redirectUri: pending.redirectUri,
        loginOption: callback.query.login_option
      });
      credentialPayload = {
        ...credentialPayload,
        ...applyKiroToken({}, token),
        tokenType: token.tokenType,
        profileArn: token.profileArn,
        exchangedAt: now.toISOString()
      };
      callback.tokenExchanged = true;
    } catch (error) {
      callback.error = error instanceof Error ? error.message : "Kiro token exchange failed";
      callback.accountCreated = false;
      callback.tokenExchanged = false;
      oauthCallbacks.set(pending.state, callback);
      return;
    }
  }

  // Windsurf: OAuth implicit flow returns a token that can be used directly
  // as apiKey for the Cascade gRPC backend. No PostAuth exchange needed.
  if (pending.providerType === "windsurf" && callback.token) {
    credentialPayload = {
      ...credentialPayload,
      token: callback.token,
      accessToken: callback.token,
      apiKey: callback.token,
      grantType: "implicit_token",
      exchangedAt: now.toISOString()
    };
    callback.tokenExchanged = true;
  }

  const account: ProviderAccount = {
    id: pending.accountId,
    providerInstanceId: providerInstance.id,
    providerType: pending.providerType,
    displayName: pending.displayName,
    status: "active",
    weight: pending.weight,
    maxConcurrency: pending.maxConcurrency,
    credentialRef,
    allowedModels: pending.allowedModels,
    tags: pending.tags,
    owner: pending.owner,
    runtime: {
      activeRequests: 0,
      totalRequests: 0,
      failedRequests: 0,
      consecutiveFailures: 0
    },
    metadata: {
      oauthState: pending.state,
      oauthProvider: pending.providerType
    },
    createdAt: now,
    updatedAt: now
  };

  app.secretService.addCredentialPayload({
    id: credentialRef,
    accountId: account.id,
    credentialType: "oauth",
    credentialPayload
  });
  accountPool.addAccount(account);
  app.adminAuditService.record({
    action: "account.oauth_callback_create",
    targetType: "account",
    targetId: account.id
  });
  void app.persistenceService.save({
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

  callback.accountId = account.id;
  callback.accountCreated = true;
  oauthPendingAccounts.delete(pending.state);
}

async function saveRuntimeState(app: FastifyInstance): Promise<void> {
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

function findOAuthAccount(
  app: FastifyInstance,
  state: string,
  accountId?: string
): ProviderAccount | undefined {
  const accounts = app.providerRuntimeRegistry.listAccounts();
  const directMatch = accounts.find((account) => {
    if (accountId && account.id === accountId) {
      return true;
    }

    return account.metadata?.oauthState === state;
  });

  if (directMatch) {
    return directMatch;
  }

  for (const account of accounts) {
    const secret = app.secretService.getSecretForAccount(account.id);
    if (!secret) {
      continue;
    }

    try {
      const credential = app.secretService.decryptSecretPayload(secret) as {
        state?: string;
        oauthState?: string;
      };
      if (credential.state === state || credential.oauthState === state) {
        return account;
      }
    } catch {
      continue;
    }
  }
}

function base64Url(buffer: Buffer): string {
  return buffer
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function extractToken(query: Record<string, string>): string | undefined {
  return query.access_token || query.token || query.id_token;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * Complete OAuth callback for OAuthSessionStore (new add-account flow)
 */
async function completeOAuthSessionCallback(
  app: FastifyInstance,
  oauthSessionStore: OAuthSessionStore,
  sessionId: string,
  code?: string,
  token?: string,
  query?: Record<string, string>
): Promise<void> {
  const session = oauthSessionStore.getById(sessionId);
  if (!session || session.status !== "pending") {
    return;
  }

  // Check if session is expired
  if (Date.now() > session.expiresAt) {
    oauthSessionStore.fail(sessionId, "OAuth session expired", "oauth_session_expired");
    return;
  }

  // Find provider instance and account pool
  const instances = app.providerRuntimeRegistry.listProviderInstances();
  const providerInstance = instances.find((i) => i.type === session.providerType);
  if (!providerInstance) {
    oauthSessionStore.fail(sessionId, `Provider instance for ${session.providerType} not found`, "provider_instance_not_found");
    return;
  }

  const accountPool = app.providerRuntimeRegistry.getAccountPool(providerInstance.id);
  if (!accountPool) {
    oauthSessionStore.fail(sessionId, `Account pool for ${providerInstance.id} not found`, "account_pool_not_found");
    return;
  }

  const now = new Date();
  const accountId = `account_${randomUUID()}`;
  const credentialRef = `secret_${accountId}`;
  
  let credentialPayload: Record<string, unknown> = {
    provider: session.providerType,
    grantType: "authorization_code_pkce",
    code,
    token,
    codeVerifier: session.codeVerifier,
    codeChallenge: session.codeChallenge,
    state: session.state,
    callbackQuery: query
  };

  // For Kiro provider, exchange code for tokens
  if (session.providerType === "kiro" && code) {
    try {
      const kiroToken = await new KiroAuthClient().exchangeAuthorizationCode({
        code,
        codeVerifier: session.codeVerifier,
        redirectUri: "http://127.0.0.1:3100/oauth/callback",
        loginOption: query?.login_option
      });
      credentialPayload = {
        ...credentialPayload,
        ...applyKiroToken({}, kiroToken),
        tokenType: kiroToken.tokenType,
        profileArn: kiroToken.profileArn,
        exchangedAt: now.toISOString()
      };
    } catch (error) {
      oauthSessionStore.fail(
        sessionId,
        error instanceof Error ? error.message : "Token exchange failed",
        "oauth_exchange_failed"
      );
      return;
    }
  }

  // Create account
  const account: ProviderAccount = {
    id: accountId,
    providerInstanceId: providerInstance.id,
    providerType: session.providerType,
    displayName: session.accountDraft.label,
    status: session.accountDraft.enabled ? "active" : "disabled",
    weight: session.accountDraft.weight,
    maxConcurrency: session.accountDraft.maxConcurrency,
    credentialRef,
    allowedModels: session.accountDraft.allowedModels,
    tags: session.accountDraft.tags,
    owner: session.accountDraft.owner,
    runtime: {
      activeRequests: 0,
      totalRequests: 0,
      failedRequests: 0,
      consecutiveFailures: 0
    },
    metadata: {
      credentialMode: session.accountDraft.credentialMode,
      oauthState: session.state,
      oauthSessionId: sessionId
    },
    createdAt: now,
    updatedAt: now
  };

  // Add secret
  app.secretService.addCredentialPayload({
    id: credentialRef,
    accountId: account.id,
    credentialType: "oauth",
    credentialPayload
  });

  // Add account to pool
  accountPool.addAccount(account);

  // Audit
  app.adminAuditService.record({
    action: "provider.account.oauth.complete",
    targetType: "oauth_session",
    targetId: sessionId
  });

  // Persist
  void app.persistenceService.save({
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

  // Mark session as completed
  oauthSessionStore.complete(sessionId, accountId);
}


/**
 * Exchange a Windsurf Auth1 token for a sessionToken via WindsurfPostAuth.
 * The sessionToken can be used directly as apiKey for Cascade gRPC.
 *
 * Flow: POST to WindsurfPostAuth with X-Devin-Auth1-Token header
 * → response contains sessionToken (devin-session-token$...)
 *
 * Tries new endpoint first (windsurf.com/_backend), falls back to legacy
 * (server.self-serve.windsurf.com).
 */
async function exchangeWindsurfPostAuth(auth1Token: string): Promise<string> {
  const endpoints = [
    "https://windsurf.com/_backend/exa.seat_management_pb.SeatManagementService/WindsurfPostAuth",
    "https://server.self-serve.windsurf.com/exa.seat_management_pb.SeatManagementService/WindsurfPostAuth"
  ];

  const headers = {
    "Content-Type": "application/proto",
    "Content-Length": "0",
    "Connect-Protocol-Version": "1",
    "X-Devin-Auth1-Token": auth1Token,
    "Referer": "https://windsurf.com/account/login",
    "User-Agent": "windsurf/2.0.67"
  };

  const errors: string[] = [];

  for (const url of endpoints) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: null
      });

      if (response.status >= 400) {
        const text = await response.text().catch(() => "");
        errors.push(`${url} → HTTP ${response.status}: ${text.slice(0, 120)}`);
        continue;
      }

      const raw = await response.text();

      // Try JSON parse first
      try {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        if (typeof parsed.sessionToken === "string" && parsed.sessionToken) {
          return parsed.sessionToken;
        }
      } catch {
        // Not JSON — try regex extraction from binary/proto response
      }

      // Extract sessionToken from raw response (may be binary proto with embedded string)
      const match = raw.match(/devin-session-token\$[a-zA-Z0-9._-]+/);
      if (match) {
        return match[0];
      }

      errors.push(`${url} → no sessionToken in response: ${raw.slice(0, 120)}`);
    } catch (err) {
      errors.push(`${url} → ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  throw new Error(`WindsurfPostAuth failed: ${errors.join(" | ")}`);
}
