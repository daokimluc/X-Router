import { createHash, randomBytes } from "node:crypto";
import type { AIProviderAdapter } from "../../base/AIProviderAdapter.js";
import type { ProviderCapabilities } from "../../base/ProviderCapabilities.js";
import type { ProviderAccount } from "../../base/ProviderAccount.js";
import {
  ProviderAuthError,
  ProviderConfigError,
  ProviderRateLimitError,
  ProviderTimeoutError,
  ProviderUnavailableError,
  UnsupportedCapabilityError
} from "../../base/ProviderErrors.js";
import type {
  AnthropicMessagesRequest,
  NormalizedAnthropicResponse,
  NormalizedOpenAIResponse,
  OpenAIChatCompletionRequest,
  ProviderContext,
  ProviderHealth,
  ProviderModel,
  ProviderRequestContext,
  ProviderStream,
  SessionRefreshResult
} from "../../base/types.js";
import type { OAuthProviderConfig } from "../../registry/ProviderTypeDefinition.js";

export type OAuthPKCECredential = {
  accessToken: string;
  refreshToken?: string;
  tokenType: string;
  expiresAt?: string;
  scope?: string;
  codeVerifier?: string;
  state?: string;
};

export type OAuthStartResult = {
  authorizationUrl: string;
  state: string;
  codeVerifier: string;
};

export type OAuthTokenResponse = {
  access_token: string;
  refresh_token?: string;
  token_type: string;
  expires_in?: number;
  scope?: string;
};

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Generate a cryptographically random code_verifier for PKCE.
 * Returns a base64url-encoded string of 43-128 characters.
 */
export function generateCodeVerifier(length = 64): string {
  // Each byte produces ~1.33 base64url chars, so we need ceil(length * 3/4) bytes
  const byteLength = Math.ceil((length * 3) / 4);
  const buffer = randomBytes(byteLength);
  const encoded = buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
  // Trim to desired length (between 43 and 128)
  return encoded.slice(0, length);
}

/**
 * Compute the code_challenge from a code_verifier using S256 method.
 * code_challenge = base64url(SHA256(code_verifier))
 */
export function computeCodeChallenge(codeVerifier: string): string {
  const hash = createHash("sha256").update(codeVerifier).digest();
  return hash
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

export class OAuthPKCEAdapter implements AIProviderAdapter {
  readonly type = "oauth_pkce";

  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  getCapabilities(): ProviderCapabilities {
    return {
      protocols: ["openai_chat_completions"],
      flags: ["chat", "streaming"]
    };
  }

  async validateConfig(config: Record<string, unknown>): Promise<void> {
    if (!config.baseUrl || typeof config.baseUrl !== "string") {
      throw new ProviderConfigError(
        "OAuth PKCE config requires a valid baseUrl string"
      );
    }
  }

  async validateCredential(payload: Record<string, unknown>): Promise<void> {
    if (!payload.accessToken || typeof payload.accessToken !== "string") {
      throw new ProviderConfigError(
        "OAuth PKCE credential requires a valid accessToken string"
      );
    }
  }

  /**
   * Start the OAuth PKCE authorization flow.
   * Generates code_verifier, code_challenge, state, and builds the authorization URL.
   */
  startOAuthFlow(oauthConfig: OAuthProviderConfig): OAuthStartResult {
    const codeVerifier = generateCodeVerifier(64);
    const codeChallenge = computeCodeChallenge(codeVerifier);
    const state = randomBytes(32).toString("hex");

    const params = new URLSearchParams({
      client_id: oauthConfig.clientId,
      redirect_uri: oauthConfig.redirectUri,
      response_type: "code",
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      scope: oauthConfig.scope,
      state
    });

    const authorizationUrl = `${oauthConfig.authorizationEndpoint}?${params.toString()}`;

    return {
      authorizationUrl,
      state,
      codeVerifier
    };
  }

  /**
   * Exchange an authorization code for tokens using the PKCE code_verifier.
   */
  async exchangeCode(
    code: string,
    codeVerifier: string,
    redirectUri: string,
    oauthConfig: OAuthProviderConfig
  ): Promise<OAuthTokenResponse> {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      code_verifier: codeVerifier,
      redirect_uri: redirectUri,
      client_id: oauthConfig.clientId
    });

    const response = await this.fetchImpl(oauthConfig.tokenEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: body.toString()
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      throw new ProviderAuthError(
        this.type,
        `Token exchange failed (HTTP ${response.status}): ${errorBody}`
      );
    }

    const tokenResponse = (await response.json()) as OAuthTokenResponse;
    return tokenResponse;
  }

  /**
   * Refresh the access_token using the refresh_token.
   * Returns SessionRefreshResult indicating success or failure.
   * On 400/401 from the token endpoint, marks the account as expired.
   */
  async refreshSession(
    account: ProviderAccount,
    context: ProviderContext
  ): Promise<SessionRefreshResult> {
    const credential = (context.credentialPayload ?? {}) as OAuthPKCECredential;
    const oauthConfig = context.providerInstance.config as Record<string, unknown>;
    const tokenEndpoint = oauthConfig.tokenEndpoint as string | undefined;
    const clientId = oauthConfig.clientId as string | undefined;

    if (!credential.refreshToken) {
      return {
        refreshed: false,
        disabled: true,
        message: "No refresh token available",
        authError: true
      };
    }

    if (!tokenEndpoint || !clientId) {
      return {
        refreshed: false,
        disabled: true,
        message: "Missing tokenEndpoint or clientId in provider config",
        authError: true
      };
    }

    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: credential.refreshToken,
      client_id: clientId
    });

    try {
      const response = await this.fetchImpl(tokenEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: body.toString()
      });

      // 400/401 means refresh token is expired or revoked
      if (response.status === 400 || response.status === 401) {
        return {
          refreshed: false,
          disabled: true,
          message: "Refresh token expired or revoked. Please re-authenticate.",
          authError: true
        };
      }

      if (!response.ok) {
        return {
          refreshed: false,
          message: `Token refresh failed (HTTP ${response.status})`
        };
      }

      const tokenResponse = (await response.json()) as OAuthTokenResponse;

      const expiresAt = tokenResponse.expires_in
        ? new Date(Date.now() + tokenResponse.expires_in * 1000)
        : undefined;

      return {
        refreshed: true,
        credentialPayload: {
          accessToken: tokenResponse.access_token,
          refreshToken: tokenResponse.refresh_token ?? credential.refreshToken,
          tokenType: tokenResponse.token_type ?? "Bearer",
          expiresAt: expiresAt?.toISOString(),
          scope: tokenResponse.scope ?? credential.scope
        },
        expiresAt
      };
    } catch (error) {
      return {
        refreshed: false,
        message: `Token refresh error: ${error instanceof Error ? error.message : "unknown"}`
      };
    }
  }

  async listModels(context: ProviderContext): Promise<ProviderModel[]> {
    const config = context.providerInstance.config as Record<string, unknown>;
    const credential = (context.credentialPayload ?? {}) as OAuthPKCECredential;
    const baseUrl = (config.baseUrl as string) ?? "";
    const url = `${baseUrl.replace(/\/$/, "")}/v1/models`;

    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), DEFAULT_TIMEOUT_MS);

    try {
      const response = await this.fetchImpl(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${credential.accessToken}`,
          "Content-Type": "application/json"
        },
        signal: abortController.signal
      });

      if (response.status === 404) {
        return [];
      }

      if (response.status === 401 || response.status === 403) {
        throw new ProviderAuthError(
          this.type,
          "Access token is invalid or expired"
        );
      }

      if (!response.ok) {
        return [];
      }

      const body = (await response.json()) as {
        data?: Array<{ id: string; created?: number; owned_by?: string }>;
      };

      if (!body.data || !Array.isArray(body.data)) {
        return [];
      }

      return body.data.map((model) => ({
        id: model.id,
        displayName: model.id,
        upstreamModel: model.id
      }));
    } catch (error) {
      if (error instanceof ProviderAuthError) {
        throw error;
      }
      if (error instanceof Error && error.name === "AbortError") {
        throw new ProviderTimeoutError(this.type, baseUrl, DEFAULT_TIMEOUT_MS);
      }
      return [];
    } finally {
      clearTimeout(timeout);
    }
  }

  async chatCompletions(
    request: OpenAIChatCompletionRequest,
    context: ProviderRequestContext
  ): Promise<NormalizedOpenAIResponse | ProviderStream> {
    const config = context.providerInstance.config as Record<string, unknown>;
    const credential = (context.credentialPayload ?? {}) as OAuthPKCECredential;
    const baseUrl = (config.baseUrl as string) ?? "";
    const url = `${baseUrl.replace(/\/$/, "")}/v1/chat/completions`;

    const abortController = new AbortController();
    const timeoutMs =
      context.providerInstance.defaultTimeoutMs || DEFAULT_TIMEOUT_MS;
    const timeout = setTimeout(() => abortController.abort(), timeoutMs);

    try {
      const response = await this.fetchImpl(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${credential.accessToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(request),
        signal: abortController.signal
      });

      if (!response.ok) {
        throw await this.classifyHttpError(response, baseUrl, timeoutMs);
      }

      // Streaming response
      if (request.stream) {
        if (!response.body) {
          throw new ProviderUnavailableError(this.type, 502);
        }
        clearTimeout(timeout);
        return this.createSSEStream(response.body);
      }

      // Non-streaming response
      const body = (await response.json()) as NormalizedOpenAIResponse;
      return body;
    } catch (error) {
      if (
        error instanceof ProviderAuthError ||
        error instanceof ProviderRateLimitError ||
        error instanceof ProviderTimeoutError ||
        error instanceof ProviderUnavailableError
      ) {
        throw error;
      }

      if (error instanceof Error && error.name === "AbortError") {
        throw new ProviderTimeoutError(this.type, baseUrl, timeoutMs);
      }

      throw new ProviderUnavailableError(this.type, 502);
    } finally {
      clearTimeout(timeout);
    }
  }

  async messages(
    _request: AnthropicMessagesRequest,
    _context: ProviderRequestContext
  ): Promise<NormalizedAnthropicResponse | ProviderStream> {
    throw new UnsupportedCapabilityError(
      "OAuth PKCE adapter does not support Anthropic Messages protocol"
    );
  }

  async healthCheck(context: ProviderContext): Promise<ProviderHealth> {
    const config = context.providerInstance.config as Record<string, unknown>;
    const credential = (context.credentialPayload ?? {}) as OAuthPKCECredential;
    const baseUrl = (config.baseUrl as string) ?? "";
    const url = `${baseUrl.replace(/\/$/, "")}/v1/models`;

    const abortController = new AbortController();
    const healthTimeout = 10_000;
    const timeout = setTimeout(() => abortController.abort(), healthTimeout);

    try {
      const response = await this.fetchImpl(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${credential.accessToken}`,
          "Content-Type": "application/json"
        },
        signal: abortController.signal
      });

      if (response.status === 200) {
        return { status: "ok" };
      }

      if (response.status === 401 || response.status === 403) {
        return {
          status: "down",
          message: "Access token is invalid or expired"
        };
      }

      return {
        status: "degraded",
        message: `Provider returned HTTP ${response.status}`
      };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return {
          status: "degraded",
          message: `Health check timed out after ${healthTimeout}ms`
        };
      }
      return {
        status: "down",
        message: `Connection failed: ${error instanceof Error ? error.message : "unknown error"}`
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  private async classifyHttpError(
    response: Response,
    baseUrl: string,
    timeoutMs: number
  ): Promise<
    | ProviderAuthError
    | ProviderRateLimitError
    | ProviderTimeoutError
    | ProviderUnavailableError
  > {
    const status = response.status;

    if (status === 401 || status === 403) {
      return new ProviderAuthError(
        this.type,
        "Access token is invalid or expired"
      );
    }

    if (status === 429) {
      const retryAfterHeader = response.headers.get("retry-after");
      const retryAfterSeconds = retryAfterHeader
        ? parseInt(retryAfterHeader, 10)
        : undefined;
      return new ProviderRateLimitError(
        this.type,
        Number.isNaN(retryAfterSeconds) ? undefined : retryAfterSeconds
      );
    }

    if (status >= 500) {
      return new ProviderUnavailableError(this.type, status);
    }

    return new ProviderUnavailableError(this.type, status);
  }

  private async *createSSEStream(
    body: ReadableStream<Uint8Array>
  ): ProviderStream {
    const reader = body.getReader();
    const decoder = new TextDecoder();

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        const chunk = decoder.decode(value, { stream: true });
        if (chunk) {
          yield chunk;
        }
      }

      const final = decoder.decode();
      if (final) {
        yield final;
      }
    } finally {
      reader.releaseLock();
    }
  }
}
