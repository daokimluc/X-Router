import { describe, it, expect, beforeEach } from "vitest";
import {
  startOAuthPKCEFlow,
  clearPendingOAuthStates,
  getPendingOAuthStates,
  isGenericOAuthPKCEState,
} from "../providers/adapters/oauth-pkce/OAuthPKCECallbackHandler.js";
import {
  getOAuthProviderConfig,
  oauthProviderConfigMap,
  claudeCodeOAuthConfig,
  githubCopilotOAuthConfig,
  cursorOAuthConfig,
  codexOAuthConfig,
  antigravityOAuthConfig,
} from "../providers/adapters/oauth-pkce/oauthProviderConfigs.js";
import type { OAuthProviderConfig } from "../providers/registry/ProviderTypeDefinition.js";

describe("OAuthPKCECallbackHandler", () => {
  beforeEach(() => {
    clearPendingOAuthStates();
  });

  describe("startOAuthPKCEFlow", () => {
    it("generates authorization URL and stores pending state for claude_code", () => {
      const result = startOAuthPKCEFlow("claude_code");

      expect(result.authorizationUrl).toContain("https://claude.ai/oauth/authorize");
      expect(result.authorizationUrl).toContain("response_type=code");
      expect(result.authorizationUrl).toContain("code_challenge_method=S256");
      expect(result.state).toBeTruthy();
      expect(result.state.length).toBeGreaterThan(0);

      // Verify pending state is stored
      const pending = getPendingOAuthStates().get(result.state);
      expect(pending).toBeDefined();
      expect(pending!.providerType).toBe("claude_code");
      expect(pending!.codeVerifier).toBeTruthy();
      expect(pending!.redirectUri).toBe("http://127.0.0.1:3100/oauth/callback");
    });

    it("generates authorization URL for github_copilot", () => {
      const result = startOAuthPKCEFlow("github_copilot");

      expect(result.authorizationUrl).toContain("https://github.com/login/oauth/authorize");
      expect(result.authorizationUrl).toContain("scope=read%3Auser");
      expect(result.state).toBeTruthy();
    });

    it("generates authorization URL for cursor", () => {
      const result = startOAuthPKCEFlow("cursor");

      expect(result.authorizationUrl).toContain("https://www.cursor.com/loginDeepControl");
      expect(result.state).toBeTruthy();
    });

    it("generates authorization URL for codex", () => {
      const result = startOAuthPKCEFlow("codex");

      expect(result.authorizationUrl).toContain("https://auth.openai.com/oauth/authorize");
      expect(result.state).toBeTruthy();
    });

    it("generates authorization URL for antigravity", () => {
      const result = startOAuthPKCEFlow("antigravity");

      expect(result.authorizationUrl).toContain("https://accounts.google.com/o/oauth2/v2/auth");
      expect(result.state).toBeTruthy();
    });

    it("throws error for unknown provider type", () => {
      expect(() => startOAuthPKCEFlow("unknown_provider")).toThrow(
        /No OAuth configuration found for provider type "unknown_provider"/
      );
    });

    it("accepts custom oauthConfig override", () => {
      const customConfig: OAuthProviderConfig = {
        authorizationEndpoint: "https://custom.example.com/authorize",
        tokenEndpoint: "https://custom.example.com/token",
        clientId: "custom-client",
        scope: "custom-scope",
        redirectUri: "http://localhost:9999/callback",
      };

      const result = startOAuthPKCEFlow("custom_provider", customConfig);

      expect(result.authorizationUrl).toContain("https://custom.example.com/authorize");
      expect(result.authorizationUrl).toContain("client_id=custom-client");
      expect(result.authorizationUrl).toContain("scope=custom-scope");

      const pending = getPendingOAuthStates().get(result.state);
      expect(pending!.redirectUri).toBe("http://localhost:9999/callback");
    });

    it("stores account draft info when provided", () => {
      const draft = {
        displayName: "My Claude Code",
        owner: "user@example.com",
        maxConcurrency: 3,
        weight: 2,
        allowedModels: ["claude-3-opus"],
        tags: ["premium"],
      };

      const result = startOAuthPKCEFlow("claude_code", undefined, draft);

      const pending = getPendingOAuthStates().get(result.state);
      expect(pending!.accountDraft).toEqual(draft);
    });

    it("generates unique states for multiple flows", () => {
      const result1 = startOAuthPKCEFlow("claude_code");
      const result2 = startOAuthPKCEFlow("github_copilot");
      const result3 = startOAuthPKCEFlow("cursor");

      expect(result1.state).not.toBe(result2.state);
      expect(result2.state).not.toBe(result3.state);
      expect(result1.state).not.toBe(result3.state);

      expect(getPendingOAuthStates().size).toBe(3);
    });
  });

  describe("isGenericOAuthPKCEState", () => {
    it("returns true for a pending state", () => {
      const result = startOAuthPKCEFlow("claude_code");
      expect(isGenericOAuthPKCEState(result.state)).toBe(true);
    });

    it("returns false for unknown state", () => {
      expect(isGenericOAuthPKCEState("unknown-state-value")).toBe(false);
    });
  });

  describe("clearPendingOAuthStates", () => {
    it("removes all pending states", () => {
      startOAuthPKCEFlow("claude_code");
      startOAuthPKCEFlow("github_copilot");
      expect(getPendingOAuthStates().size).toBe(2);

      clearPendingOAuthStates();
      expect(getPendingOAuthStates().size).toBe(0);
    });
  });
});

describe("oauthProviderConfigs", () => {
  it("defines configs for all 7 OAuth providers", () => {
    expect(Object.keys(oauthProviderConfigMap)).toHaveLength(7);
    expect(oauthProviderConfigMap).toHaveProperty("claude_code");
    expect(oauthProviderConfigMap).toHaveProperty("github_copilot");
    expect(oauthProviderConfigMap).toHaveProperty("cursor");
    expect(oauthProviderConfigMap).toHaveProperty("codex");
    expect(oauthProviderConfigMap).toHaveProperty("antigravity");
  });

  it("claude_code has correct endpoints", () => {
    expect(claudeCodeOAuthConfig.authorizationEndpoint).toBe(
      "https://claude.ai/oauth/authorize"
    );
    expect(claudeCodeOAuthConfig.tokenEndpoint).toBe(
      "https://api.anthropic.com/v1/oauth/token"
    );
  });

  it("github_copilot has correct endpoints", () => {
    expect(githubCopilotOAuthConfig.authorizationEndpoint).toBe(
      "https://github.com/login/oauth/authorize"
    );
    expect(githubCopilotOAuthConfig.tokenEndpoint).toBe(
      "https://github.com/login/oauth/access_token"
    );
  });

  it("cursor has correct endpoints", () => {
    expect(cursorOAuthConfig.authorizationEndpoint).toBe(
      "https://www.cursor.com/loginDeepControl"
    );
    expect(cursorOAuthConfig.tokenEndpoint).toBe(
      "https://api2.cursor.sh/auth/full_stripe_profile"
    );
  });

  it("codex has correct endpoints", () => {
    expect(codexOAuthConfig.authorizationEndpoint).toBe(
      "https://auth.openai.com/oauth/authorize"
    );
    expect(codexOAuthConfig.tokenEndpoint).toBe(
      "https://auth.openai.com/oauth/token"
    );
  });

  it("antigravity has correct endpoints", () => {
    expect(antigravityOAuthConfig.authorizationEndpoint).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth"
    );
    expect(antigravityOAuthConfig.tokenEndpoint).toBe(
      "https://oauth2.googleapis.com/token"
    );
  });

  it("all configs have required fields", () => {
    for (const [providerType, config] of Object.entries(oauthProviderConfigMap)) {
      expect(config.authorizationEndpoint, `${providerType} authorizationEndpoint`).toBeTruthy();
      expect(config.tokenEndpoint, `${providerType} tokenEndpoint`).toBeTruthy();
      expect(config.clientId, `${providerType} clientId`).toBeTruthy();
      expect(config.scope, `${providerType} scope`).toBeTruthy();
      expect(config.redirectUri, `${providerType} redirectUri`).toBeTruthy();
    }
  });

  describe("getOAuthProviderConfig", () => {
    it("returns config for known provider types", () => {
      expect(getOAuthProviderConfig("claude_code")).toBe(claudeCodeOAuthConfig);
      expect(getOAuthProviderConfig("github_copilot")).toBe(githubCopilotOAuthConfig);
      expect(getOAuthProviderConfig("cursor")).toBe(cursorOAuthConfig);
      expect(getOAuthProviderConfig("codex")).toBe(codexOAuthConfig);
      expect(getOAuthProviderConfig("antigravity")).toBe(antigravityOAuthConfig);
    });

    it("returns undefined for unknown provider types", () => {
      expect(getOAuthProviderConfig("unknown")).toBeUndefined();
      expect(getOAuthProviderConfig("openai")).toBeUndefined();
      expect(getOAuthProviderConfig("kiro")).toBeUndefined();
    });
  });
});
