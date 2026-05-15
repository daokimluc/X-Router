import type { ProviderAccount } from "../../base/ProviderAccount.js";
import type { SessionManager } from "../../base/SessionManager.js";
import type { ProviderContext, SessionRefreshResult } from "../../base/types.js";
import type { KiroCredentialPayload } from "./kiroTypes.js";

/**
 * Kiro session manager — refreshes access token using a stored refresh token.
 *
 * Kiro uses the same refresh flow as the desktop app:
 *   POST https://prod.<region>.auth.desktop.kiro.dev/refreshToken
 *   { "refreshToken": "<token>" }
 *
 * Response: { accessToken, refreshToken, expiresIn, idToken? }
 */
export class KiroSessionManager implements SessionManager {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async refreshSession(
    account: ProviderAccount,
    context: ProviderContext
  ): Promise<SessionRefreshResult> {
    const credential = context.credentialPayload as KiroCredentialPayload | undefined;
    if (!credential) {
      return { refreshed: false, message: "No credential payload supplied" };
    }
    const refreshToken = credential.refreshToken;
    if (!refreshToken) {
      return { refreshed: false, message: "Account has no refresh token" };
    }

    const region = credential.region ?? "us-east-1";
    const url = `https://prod.${region}.auth.desktop.kiro.dev/refreshToken`;

    try {
      const res = await this.fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken })
      });

      if (!res.ok) {
        const text = await safeText(res);
        return {
          refreshed: false,
          message: `Kiro refresh failed (${res.status}): ${text.slice(0, 200)}`,
          authError: res.status === 401 || res.status === 403
        };
      }

      const data = (await res.json()) as {
        accessToken?: string;
        refreshToken?: string;
        expiresIn?: number;
        idToken?: string;
      };

      if (!data.accessToken) {
        return { refreshed: false, message: "Kiro response missing accessToken" };
      }

      const expiresAt = data.expiresIn
        ? new Date(Date.now() + data.expiresIn * 1000)
        : undefined;

      return {
        refreshed: true,
        credentialPayload: {
          ...credential,
          accessToken: data.accessToken,
          refreshToken: data.refreshToken ?? refreshToken,
          idToken: data.idToken,
          expiresAt: expiresAt?.toISOString()
        },
        expiresAt,
        message: "Kiro session refreshed"
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { refreshed: false, message: `Kiro refresh network error: ${message}` };
    }
  }

  getDesktopRefreshUrl(credential: KiroCredentialPayload): string {
    const region = credential.region ?? "us-east-1";
    return `https://prod.${region}.auth.desktop.kiro.dev/refreshToken`;
  }
}

async function safeText(res: Response): Promise<string> {
  try { return await res.text(); } catch { return ""; }
}
