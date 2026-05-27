import { randomUUID } from "node:crypto";
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
import type { ProviderInstance } from "../../base/ProviderInstance.js";
import { applyChannelOverrides, interpretStatusCode } from "../../../utils/channelOverride.js";

// ─── Types ─────────────────────────────────────────────────

export type GitHubCopilotCredential = {
  accessToken: string;       // GitHub OAuth access token
  refreshToken?: string;     // GitHub OAuth refresh token
  copilotToken?: string;     // Short-lived Copilot API token
  copilotTokenExpiresAt?: string | number;
};

// ─── Constants ─────────────────────────────────────────────

const COPILOT_CHAT_URL = "https://api.githubcopilot.com/chat/completions";
const COPILOT_TOKEN_URL = "https://api.github.com/copilot_internal/v2/token";
const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
const GITHUB_CLIENT_ID = "Iv1.b507a08c87ecfe98";
const GITHUB_DEVICE_CODE_URL = "https://github.com/login/device/code";

const VSCODE_VERSION = "1.99.0";
const COPILOT_CHAT_VERSION = "0.26.2025042801";
const USER_AGENT = `GitHubCopilotChat/${COPILOT_CHAT_VERSION}`;
const API_VERSION = "2025-04-28";

const DEFAULT_TIMEOUT_MS = 60_000;

// ─── Adapter ───────────────────────────────────────────────

export class GitHubCopilotAdapter implements AIProviderAdapter {
  readonly type = "github_copilot";

  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  getCapabilities(): ProviderCapabilities {
    return {
      protocols: ["openai_chat_completions"],
      flags: ["chat", "streaming", "tool_calling"]
    };
  }

  async validateConfig(_config: Record<string, unknown>): Promise<void> {
    // No special config needed
  }

  async validateCredential(payload: Record<string, unknown>): Promise<void> {
    if (!payload.accessToken || typeof payload.accessToken !== "string") {
      throw new ProviderConfigError(
        "GitHub Copilot credential requires a valid accessToken string"
      );
    }
  }

  async listModels(_context: ProviderContext): Promise<ProviderModel[]> {
    return [
      { id: "gpt-4o", displayName: "GPT-4o", upstreamModel: "gpt-4o" },
      { id: "gpt-4.1", displayName: "GPT-4.1", upstreamModel: "gpt-4.1" },
      { id: "claude-sonnet-4", displayName: "Claude Sonnet 4", upstreamModel: "claude-sonnet-4" },
      { id: "claude-sonnet-4-thinking", displayName: "Claude Sonnet 4 Thinking", upstreamModel: "claude-sonnet-4-thinking" },
      { id: "gemini-2.5-pro", displayName: "Gemini 2.5 Pro", upstreamModel: "gemini-2.5-pro" },
      { id: "o4-mini", displayName: "o4-mini", upstreamModel: "o4-mini" },
    ];
  }

  async chatCompletions(
    request: OpenAIChatCompletionRequest,
    context: ProviderRequestContext
  ): Promise<NormalizedOpenAIResponse | ProviderStream> {
    const credential = (context.credentialPayload ?? {}) as GitHubCopilotCredential;

    // Ensure we have a valid copilot token
    const copilotToken = credential.copilotToken ?? await this.fetchCopilotToken(credential.accessToken);
    if (!copilotToken) {
      throw new ProviderAuthError(this.type, "Failed to obtain Copilot token");
    }

    const headers = this.buildHeaders(copilotToken, request.stream ?? false);
    const body = this.sanitizeRequest(request);

    const { body: finalBody, headers: finalHeaders } = applyChannelOverrides(
      body as unknown as Record<string, unknown>,
      headers,
      context.providerInstance
    );

    const abortController = new AbortController();
    const timeoutMs = context.providerInstance.defaultTimeoutMs || DEFAULT_TIMEOUT_MS;
    const timeout = setTimeout(() => abortController.abort(), timeoutMs);

    try {
      const response = await this.fetchImpl(COPILOT_CHAT_URL, {
        method: "POST",
        headers: finalHeaders,
        body: JSON.stringify(finalBody),
        signal: abortController.signal
      });

      if (!response.ok) {
        throw await this.classifyHttpError(response, COPILOT_CHAT_URL, timeoutMs, context.providerInstance);
      }

      if (request.stream) {
        if (!response.body) {
          throw new ProviderUnavailableError(this.type, 502);
        }
        clearTimeout(timeout);
        return this.createSSEStream(response.body);
      }

      const responseBody = (await response.json()) as NormalizedOpenAIResponse;
      return responseBody;
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
        throw new ProviderTimeoutError(this.type, COPILOT_CHAT_URL, timeoutMs);
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
      "GitHub Copilot adapter does not support Anthropic Messages protocol"
    );
  }

  async healthCheck(context: ProviderContext): Promise<ProviderHealth> {
    const credential = (context.credentialPayload ?? {}) as GitHubCopilotCredential;
    if (!credential.accessToken) {
      return { status: "down", message: "No access token" };
    }

    try {
      const copilotToken = await this.fetchCopilotToken(credential.accessToken);
      if (!copilotToken) {
        return { status: "down", message: "Failed to obtain Copilot token" };
      }
      return { status: "ok" };
    } catch {
      return { status: "down", message: "Token validation failed" };
    }
  }

  async refreshSession(
    _account: ProviderAccount,
    context: ProviderContext
  ): Promise<SessionRefreshResult> {
    const credential = (context.credentialPayload ?? {}) as GitHubCopilotCredential;

    // Step 1: Try to refresh the Copilot token using existing GitHub access token
    let copilotResult = await this.fetchCopilotTokenFull(credential.accessToken);

    // Step 2: If that fails and we have a refresh token, refresh the GitHub token first
    if (!copilotResult && credential.refreshToken) {
      const githubTokens = await this.refreshGitHubToken(credential.refreshToken);
      if (githubTokens) {
        copilotResult = await this.fetchCopilotTokenFull(githubTokens.accessToken);
        if (copilotResult) {
          return {
            refreshed: true,
            credentialPayload: {
              accessToken: githubTokens.accessToken,
              refreshToken: githubTokens.refreshToken ?? credential.refreshToken,
              copilotToken: copilotResult.token,
              copilotTokenExpiresAt: copilotResult.expiresAt
            },
            expiresAt: copilotResult.expiresAt ? new Date(copilotResult.expiresAt) : undefined
          };
        }
      }
      return { refreshed: false, disabled: true, message: "GitHub token refresh failed", authError: true };
    }

    if (copilotResult) {
      return {
        refreshed: true,
        credentialPayload: {
          accessToken: credential.accessToken,
          refreshToken: credential.refreshToken,
          copilotToken: copilotResult.token,
          copilotTokenExpiresAt: copilotResult.expiresAt
        },
        expiresAt: copilotResult.expiresAt ? new Date(copilotResult.expiresAt) : undefined
      };
    }

    return { refreshed: false, message: "Copilot token refresh failed" };
  }

  /**
   * Start device code flow for GitHub Copilot authentication.
   * Returns device_code, user_code, and verification_uri for the user.
   */
  async startDeviceCodeFlow(): Promise<{
    deviceCode: string;
    userCode: string;
    verificationUri: string;
    expiresIn: number;
    interval: number;
  } | null> {
    try {
      const response = await this.fetchImpl(GITHUB_DEVICE_CODE_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json"
        },
        body: JSON.stringify({
          client_id: GITHUB_CLIENT_ID,
          scope: "read:user"
        })
      });

      if (!response.ok) return null;

      const data = (await response.json()) as {
        device_code: string;
        user_code: string;
        verification_uri: string;
        expires_in: number;
        interval: number;
      };

      return {
        deviceCode: data.device_code,
        userCode: data.user_code,
        verificationUri: data.verification_uri,
        expiresIn: data.expires_in,
        interval: data.interval
      };
    } catch {
      return null;
    }
  }

  /**
   * Poll for device code flow completion.
   * Returns access token when user completes authorization.
   */
  async pollDeviceCode(deviceCode: string): Promise<{
    accessToken: string;
    refreshToken?: string;
  } | null> {
    try {
      const response = await this.fetchImpl(GITHUB_TOKEN_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json"
        },
        body: JSON.stringify({
          client_id: GITHUB_CLIENT_ID,
          device_code: deviceCode,
          grant_type: "urn:ietf:params:oauth:grant-type:device_code"
        })
      });

      if (!response.ok) return null;

      const data = (await response.json()) as {
        access_token?: string;
        refresh_token?: string;
        error?: string;
      };

      if (data.error) return null; // authorization_pending, slow_down, etc.
      if (!data.access_token) return null;

      return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token
      };
    } catch {
      return null;
    }
  }

  // ─── Private Helpers ───────────────────────────────────────

  private buildHeaders(copilotToken: string, stream: boolean): Record<string, string> {
    return {
      "Authorization": `Bearer ${copilotToken}`,
      "Content-Type": "application/json",
      "copilot-integration-id": "vscode-chat",
      "editor-version": `vscode/${VSCODE_VERSION}`,
      "editor-plugin-version": `copilot-chat/${COPILOT_CHAT_VERSION}`,
      "user-agent": USER_AGENT,
      "openai-intent": "conversation-panel",
      "x-github-api-version": API_VERSION,
      "x-request-id": randomUUID(),
      "Accept": stream ? "text/event-stream" : "application/json"
    };
  }

  private sanitizeRequest(request: OpenAIChatCompletionRequest): Record<string, unknown> {
    const body: Record<string, unknown> = { ...request };

    // Sanitize messages: GitHub Copilot only accepts text and image_url content types
    if (request.messages) {
      body.messages = request.messages.map((msg) => {
        if (!msg.content || typeof msg.content === "string") return msg;
        if (Array.isArray(msg.content)) {
          const cleaned = msg.content
            .map((part) => {
              if (part.type === "text" || part.type === "image_url") return part;
              const text = (part as Record<string, unknown>).text ?? JSON.stringify(part);
              return { type: "text", text: typeof text === "string" ? text : JSON.stringify(text) };
            })
            .filter((part) => (part as Record<string, unknown>).text !== "");
          return { ...msg, content: cleaned.length > 0 ? cleaned : null };
        }
        return msg;
      });
    }

    return body;
  }

  private async fetchCopilotToken(githubAccessToken: string): Promise<string | null> {
    const result = await this.fetchCopilotTokenFull(githubAccessToken);
    return result?.token ?? null;
  }

  private async fetchCopilotTokenFull(
    githubAccessToken: string
  ): Promise<{ token: string; expiresAt?: string } | null> {
    try {
      const response = await this.fetchImpl(COPILOT_TOKEN_URL, {
        headers: {
          "Authorization": `token ${githubAccessToken}`,
          "User-Agent": USER_AGENT,
          "Editor-Version": `vscode/${VSCODE_VERSION}`,
          "Editor-Plugin-Version": `copilot-chat/${COPILOT_CHAT_VERSION}`,
          "Accept": "application/json",
          "x-github-api-version": API_VERSION
        }
      });

      if (!response.ok) return null;

      const data = (await response.json()) as { token: string; expires_at?: string };
      return { token: data.token, expiresAt: data.expires_at };
    } catch {
      return null;
    }
  }

  private async refreshGitHubToken(
    refreshToken: string
  ): Promise<{ accessToken: string; refreshToken?: string } | null> {
    try {
      const response = await this.fetchImpl(GITHUB_TOKEN_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Accept": "application/json"
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: refreshToken,
          client_id: GITHUB_CLIENT_ID
        }).toString()
      });

      if (!response.ok) return null;

      const data = (await response.json()) as {
        access_token: string;
        refresh_token?: string;
      };

      return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token
      };
    } catch {
      return null;
    }
  }

  private async classifyHttpError(response: Response, url: string, timeoutMs: number, instance?: ProviderInstance) {
    const status = response.status;
    if (instance) {
      const action = interpretStatusCode(instance, status);
      if (action === "disable") {
        return new ProviderAuthError(this.type, `Status ${status} mapped to disable`);
      }
      if (action === "retry") {
        return new ProviderRateLimitError(this.type, undefined);
      }
    }
    if (status === 401 || status === 403) {
      return new ProviderAuthError(this.type, "Copilot token expired or invalid");
    }
    if (status === 429) {
      const retryAfter = response.headers.get("retry-after");
      const seconds = retryAfter ? parseInt(retryAfter, 10) : undefined;
      return new ProviderRateLimitError(this.type, Number.isNaN(seconds) ? undefined : seconds);
    }
    if (status >= 500) {
      return new ProviderUnavailableError(this.type, status);
    }
    return new ProviderUnavailableError(this.type, status);
  }

  private async *createSSEStream(body: ReadableStream<Uint8Array>): ProviderStream {
    const reader = body.getReader();
    const decoder = new TextDecoder();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        if (chunk) yield chunk;
      }
      const final = decoder.decode();
      if (final) yield final;
    } finally {
      reader.releaseLock();
    }
  }
}
