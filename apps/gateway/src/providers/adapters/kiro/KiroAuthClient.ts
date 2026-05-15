import { ProviderError } from "../../base/ProviderErrors.js";
import type { KiroCredentialPayload } from "./kiroTypes.js";

export type KiroTokenResult = {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  expiresAt?: string;
  profileArn?: string;
  tokenType?: string;
};

const DEFAULT_REGION = "us-east-1";
const DEFAULT_SOCIAL_REDIRECT_URI = "kiro://kiro.kiroAgent/authenticate-success";

export class KiroAuthClient {
  async exchangeAuthorizationCode(options: {
    code: string;
    codeVerifier: string;
    redirectUri?: string;
    region?: string;
    loginOption?: string;
  }): Promise<KiroTokenResult> {
    const endpoint = `${getAuthBaseUrl(options.region)}/oauth/token`;
    const redirectUri = options.redirectUri ?? DEFAULT_SOCIAL_REDIRECT_URI;
    const attempts = [
      {
        code: options.code,
        code_verifier: options.codeVerifier,
        redirect_uri: redirectUri,
        login_option: options.loginOption
      },
      {
        code: options.code,
        codeVerifier: options.codeVerifier,
        redirectUri,
        grantType: "authorization_code",
        loginOption: options.loginOption
      },
      {
        code: options.code,
        code_verifier: options.codeVerifier,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
        login_option: options.loginOption
      }
    ];
    let lastError: ProviderError | undefined;

    for (const payload of attempts) {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "User-Agent": "kiro-cli/1.0.0"
        },
        body: JSON.stringify(payload)
      });

      try {
        return await parseKiroTokenResponse(response, "Kiro OAuth token exchange failed");
      } catch (error) {
        if (!(error instanceof ProviderError)) {
          throw error;
        }

        lastError = error;
        if (response.status !== 400) {
          throw error;
        }
      }
    }

    throw lastError;
  }

  async refreshToken(credential: KiroCredentialPayload): Promise<KiroTokenResult> {
    if (!credential.refreshToken) {
      throw new ProviderError({
        code: "provider_auth_error",
        message: "Kiro refresh token is missing",
        statusCode: 401
      });
    }

    if (credential.clientId && credential.clientSecret) {
      const region = credential.region ?? DEFAULT_REGION;
      const response = await fetch(`https://oidc.${region}.amazonaws.com/token`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body: JSON.stringify({
          clientId: credential.clientId,
          clientSecret: credential.clientSecret,
          refreshToken: credential.refreshToken,
          grantType: "refresh_token"
        })
      });

      return parseKiroTokenResponse(response, "Kiro AWS token refresh failed", {
        refreshToken: credential.refreshToken
      });
    }

    const response = await fetch(`${getAuthBaseUrl(credential.region)}/refreshToken`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": "kiro-cli/1.0.0"
      },
      body: JSON.stringify({
        refreshToken: credential.refreshToken
      })
    });

    return parseKiroTokenResponse(response, "Kiro token refresh failed", {
      refreshToken: credential.refreshToken
    });
  }
}

export function applyKiroToken(
  credential: KiroCredentialPayload,
  token: KiroTokenResult
): KiroCredentialPayload {
  return {
    ...credential,
    accessToken: token.accessToken,
    refreshToken: token.refreshToken ?? credential.refreshToken,
    expiresAt:
      token.expiresAt ??
      (token.expiresIn ? new Date(Date.now() + token.expiresIn * 1000).toISOString() : credential.expiresAt),
    profileArn: token.profileArn ?? credential.profileArn
  };
}

export function shouldRefreshKiroCredential(credential: KiroCredentialPayload): boolean {
  if (!credential.refreshToken) {
    return false;
  }

  if (!credential.accessToken) {
    return true;
  }

  if (!credential.expiresAt) {
    return false;
  }

  return new Date(credential.expiresAt).getTime() - Date.now() < 5 * 60 * 1000;
}

async function parseKiroTokenResponse(
  response: Response,
  message: string,
  fallback?: Partial<KiroTokenResult>
): Promise<KiroTokenResult> {
  const text = await response.text();
  const data = text ? parseJsonObject(text) : {};

  if (!response.ok) {
    throw new ProviderError({
      code: "provider_auth_error",
      message: `${message}: ${extractErrorMessage(data, text)}`,
      statusCode: response.status
    });
  }

  const accessToken = readString(data, "accessToken") ?? readString(data, "access_token");
  if (!accessToken) {
    throw new ProviderError({
      code: "provider_auth_error",
      message: `${message}: response did not include accessToken`,
      statusCode: 502
    });
  }

  return {
    accessToken,
    refreshToken:
      readString(data, "refreshToken") ?? readString(data, "refresh_token") ?? fallback?.refreshToken,
    expiresIn: readNumber(data, "expiresIn") ?? readNumber(data, "expires_in") ?? fallback?.expiresIn,
    expiresAt: readString(data, "expiresAt") ?? fallback?.expiresAt,
    profileArn: readString(data, "profileArn") ?? fallback?.profileArn,
    tokenType: readString(data, "tokenType") ?? readString(data, "token_type") ?? fallback?.tokenType
  };
}

function getAuthBaseUrl(region?: string): string {
  return `https://prod.${region ?? DEFAULT_REGION}.auth.desktop.kiro.dev`;
}

function parseJsonObject(text: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function readString(data: Record<string, unknown>, key: string): string | undefined {
  const value = data[key];
  return typeof value === "string" && value ? value : undefined;
}

function readNumber(data: Record<string, unknown>, key: string): number | undefined {
  const value = data[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function extractErrorMessage(data: Record<string, unknown>, fallback: string): string {
  return (
    readString(data, "message") ??
    readString(data, "error_description") ??
    readString(data, "error") ??
    fallback
  );
}
