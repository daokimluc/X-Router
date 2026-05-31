import type { ProviderAccount, ProviderAccountSecret } from "../providers/base/ProviderAccount.js";
import type { ProviderInstance } from "../providers/base/ProviderInstance.js";
import type { ProviderContext, SessionRefreshResult } from "../providers/base/types.js";
import { KeyedMutex } from "../utils/mutex.js";

/** Minimal adapter surface needed to refresh — keeps this service decoupled. */
type RefreshableAdapter = {
  refreshSession?: (
    account: ProviderAccount,
    context: ProviderContext
  ) => Promise<SessionRefreshResult>;
};

/** Minimal secret-store surface (satisfied by SecretService). */
type SecretStore = {
  getSecretForAccount(accountId: string): ProviderAccountSecret | undefined;
  decryptSecretPayload(secret: ProviderAccountSecret): Record<string, unknown>;
  updateSecretPayload(
    secretId: string,
    credentialPayload: Record<string, unknown>,
    expiresAt?: Date
  ): ProviderAccountSecret | undefined;
};

export type RefreshTrigger = "background" | "on_auth_error";

export type RefreshOutcome = {
  /** A refresh ran and the credential was written. */
  refreshed: boolean;
  /** The refresh was skipped because another path already refreshed it. */
  skipped: boolean;
  /** Short machine-readable reason for skip/no-op (for logging). */
  reason?: string;
  /** Latest credential payload (post-refresh if refreshed, otherwise current). */
  credentialPayload?: Record<string, unknown>;
};

const DEFAULT_REFRESH_BEFORE_MS = 5 * 60_000;

function readAccessToken(payload: Record<string, unknown> | undefined): string | undefined {
  if (!payload) return undefined;
  const v = payload.accessToken ?? payload.access_token;
  return typeof v === "string" ? v : undefined;
}

function readExpiryMs(payload: Record<string, unknown> | undefined): number | undefined {
  if (!payload) return undefined;
  const raw = payload.expiresAt ?? payload.expires_at;
  if (typeof raw !== "string" && typeof raw !== "number") return undefined;
  const ms = new Date(raw).getTime();
  return Number.isNaN(ms) ? undefined : ms;
}

/**
 * Serializes credential refreshes per account so concurrent refresh paths
 * (the background loop and the on-401 path) cannot run at once for one account.
 * A rotating refresh token is then consumed exactly once.
 */
export class RefreshLockService {
  private readonly mutex = new KeyedMutex();

  /** Low-level lock primitive (kept for callers that own their refresh logic). */
  async runForAccount(
    account: ProviderAccount,
    refresh: () => Promise<SessionRefreshResult>,
    _context?: ProviderContext
  ): Promise<SessionRefreshResult> {
    return this.mutex.runExclusive(account.id, refresh);
  }

  /**
   * Refresh an account's credential under the per-account lock, re-checking
   * inside the lock whether a refresh is still required. This is the single
   * funnel for every refresh trigger.
   *
   * - `background`: skip if the stored credential's expiry is already beyond the
   *   refresh window (another path refreshed it since we decided to).
   * - `on_auth_error`: skip if the stored access token already differs from the
   *   token the failed request used (another path refreshed it) — the caller
   *   then retries with the now-current credential.
   *
   * The secret is written inside the lock via `updateSecretPayload`, so the
   * read-modify-write is atomic with respect to other refreshes for the account.
   */
  async refreshIfNeeded(options: {
    account: ProviderAccount;
    adapter: RefreshableAdapter;
    providerInstance: ProviderInstance;
    secretService: SecretStore;
    trigger: RefreshTrigger;
    /** Background-only: refresh when expiry is within this window (ms). */
    refreshBeforeMs?: number;
    /** on_auth_error-only: the access token the failed request used. */
    staleAccessToken?: string;
  }): Promise<RefreshOutcome> {
    const {
      account,
      adapter,
      providerInstance,
      secretService,
      trigger,
      refreshBeforeMs = DEFAULT_REFRESH_BEFORE_MS,
      staleAccessToken
    } = options;

    if (!adapter.refreshSession) {
      return { refreshed: false, skipped: false, reason: "no_refresh_support" };
    }

    return this.mutex.runExclusive(account.id, async () => {
      // Re-read the credential INSIDE the lock — another path may have refreshed
      // it while we waited to acquire.
      const secret = secretService.getSecretForAccount(account.id);
      if (!secret) {
        return { refreshed: false, skipped: false, reason: "no_secret" };
      }
      const current = secretService.decryptSecretPayload(secret);

      if (trigger === "background") {
        const expiryMs = readExpiryMs(current);
        if (expiryMs !== undefined && expiryMs - Date.now() > refreshBeforeMs) {
          return {
            refreshed: false,
            skipped: true,
            reason: "already_fresh",
            credentialPayload: current
          };
        }
      } else if (trigger === "on_auth_error" && staleAccessToken) {
        const currentToken = readAccessToken(current);
        if (currentToken && currentToken !== staleAccessToken) {
          // Another path already rotated the token — retry with the new one.
          return {
            refreshed: false,
            skipped: true,
            reason: "token_already_rotated",
            credentialPayload: current
          };
        }
      }

      const result = await adapter.refreshSession!(account, {
        providerInstance,
        credentialPayload: current
      });

      if (result.refreshed && result.credentialPayload) {
        const expiresAt =
          result.expiresAt ??
          (() => {
            const ms = readExpiryMs(result.credentialPayload);
            return ms !== undefined ? new Date(ms) : undefined;
          })();
        secretService.updateSecretPayload(secret.id, result.credentialPayload, expiresAt);
        return {
          refreshed: true,
          skipped: false,
          credentialPayload: result.credentialPayload
        };
      }

      return {
        refreshed: false,
        skipped: false,
        reason: result.message ?? "not_refreshed",
        credentialPayload: current
      };
    });
  }
}
