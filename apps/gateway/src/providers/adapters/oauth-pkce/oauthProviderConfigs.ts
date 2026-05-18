/**
 * OAuth Provider Configurations for PKCE-based providers.
 * Defines authorization and token endpoints for each OAuth provider.
 *
 * Note: clientId values are placeholders — real values will be configured
 * per deployment via environment variables or config files.
 *
 * @module providers/adapters/oauth-pkce/oauthProviderConfigs
 */

import type { OAuthProviderConfig } from "../../registry/ProviderTypeDefinition.js";

/**
 * Default redirect URI for OAuth callbacks.
 * This should match the registered redirect URI with each OAuth provider.
 */
export const DEFAULT_OAUTH_REDIRECT_URI = "http://127.0.0.1:3100/oauth/callback";

/**
 * OAuth configuration for Claude Code (Anthropic subscription).
 * Uses real client ID from 9router's CLAUDE_CONFIG.
 */
export const claudeCodeOAuthConfig: OAuthProviderConfig = {
  authorizationEndpoint: "https://claude.ai/oauth/authorize",
  tokenEndpoint: "https://api.anthropic.com/v1/oauth/token",
  clientId: "9d1c250a-e61b-44d9-88ed-5944d1962f5e",
  scope: "org:create_api_key user:profile user:inference",
  redirectUri: DEFAULT_OAUTH_REDIRECT_URI,
};

/**
 * OAuth configuration for GitHub Copilot.
 * Uses real client ID from 9router's GITHUB_CONFIG.
 * Note: GitHub actually uses device_code flow, but we store the config
 * for authorization code as fallback. Device code is handled separately.
 */
export const githubCopilotOAuthConfig: OAuthProviderConfig = {
  authorizationEndpoint: "https://github.com/login/oauth/authorize",
  tokenEndpoint: "https://github.com/login/oauth/access_token",
  clientId: "Iv1.b507a08c87ecfe98",
  scope: "read:user",
  redirectUri: DEFAULT_OAUTH_REDIRECT_URI,
};

/**
 * OAuth configuration for Cursor.
 * Cursor uses import token flow — tokens are extracted from local SQLite database.
 * This config is for authorization code fallback.
 */
export const cursorOAuthConfig: OAuthProviderConfig = {
  authorizationEndpoint: "https://www.cursor.com/loginDeepControl",
  tokenEndpoint: "https://api2.cursor.sh/auth/full_stripe_profile",
  clientId: "cursor-client",
  scope: "openid profile",
  redirectUri: DEFAULT_OAUTH_REDIRECT_URI,
};

/**
 * OAuth configuration for Codex (OpenAI).
 * Uses real client ID from 9router's CODEX_CONFIG.
 */
export const codexOAuthConfig: OAuthProviderConfig = {
  authorizationEndpoint: "https://auth.openai.com/oauth/authorize",
  tokenEndpoint: "https://auth.openai.com/oauth/token",
  clientId: "app_EMoamEEZ73f0CkXaXp7hrann",
  scope: "openid profile email offline_access",
  redirectUri: "http://localhost:1455/auth/callback",
  extraParams: {
    id_token_add_organizations: "true",
    codex_cli_simplified_flow: "true",
    originator: "codex_cli_rs"
  }
};

/**
 * OAuth configuration for Antigravity (Google Cloud Code Assist).
 * Uses Google OAuth2 with Cloud Platform scopes.
 */
export const antigravityOAuthConfig: OAuthProviderConfig = {
  authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenEndpoint: "https://oauth2.googleapis.com/token",
  clientId: "1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com",
  clientSecret: "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",
  scope: "https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile",
  redirectUri: DEFAULT_OAUTH_REDIRECT_URI,
};

/**
 * OAuth configuration for Kilocode (custom device auth flow).
 */
export const kilocodeOAuthConfig: OAuthProviderConfig = {
  authorizationEndpoint: "https://api.kilo.ai/api/device-auth/codes",
  tokenEndpoint: "https://api.kilo.ai/api/device-auth/codes",
  clientId: "kilocode-client",
  scope: "openid",
  redirectUri: DEFAULT_OAUTH_REDIRECT_URI,
};

/**
 * OAuth configuration for Cline (authorization code, no PKCE).
 */
export const clineOAuthConfig: OAuthProviderConfig = {
  authorizationEndpoint: "https://api.cline.bot/api/v1/auth/authorize",
  tokenEndpoint: "https://api.cline.bot/api/v1/auth/token",
  clientId: "cline-client",
  scope: "openid",
  redirectUri: DEFAULT_OAUTH_REDIRECT_URI,
};

/**
 * Map of provider type to OAuth configuration.
 * Used by the generic OAuth PKCE callback handler to look up
 * the correct token endpoint for code exchange.
 */
export const oauthProviderConfigMap: Record<string, OAuthProviderConfig> = {
  claude_code: claudeCodeOAuthConfig,
  github_copilot: githubCopilotOAuthConfig,
  cursor: cursorOAuthConfig,
  codex: codexOAuthConfig,
  antigravity: antigravityOAuthConfig,
  kilocode: kilocodeOAuthConfig,
  cline: clineOAuthConfig,
};

/**
 * Get OAuth provider config by provider type.
 * Returns undefined if the provider type is not an OAuth PKCE provider.
 */
export function getOAuthProviderConfig(providerType: string): OAuthProviderConfig | undefined {
  return oauthProviderConfigMap[providerType];
}
