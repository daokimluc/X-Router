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
export const DEFAULT_OAUTH_REDIRECT_URI = "http://127.0.0.1:8080/oauth/callback";

/**
 * OAuth configuration for Claude Code (Anthropic subscription).
 */
export const claudeCodeOAuthConfig: OAuthProviderConfig = {
  authorizationEndpoint: "https://console.anthropic.com/oauth/authorize",
  tokenEndpoint: "https://console.anthropic.com/oauth/token",
  clientId: "claude-code-placeholder",
  scope: "openid profile",
  redirectUri: DEFAULT_OAUTH_REDIRECT_URI,
};

/**
 * OAuth configuration for GitHub Copilot.
 */
export const githubCopilotOAuthConfig: OAuthProviderConfig = {
  authorizationEndpoint: "https://github.com/login/oauth/authorize",
  tokenEndpoint: "https://github.com/login/oauth/access_token",
  clientId: "github-copilot-placeholder",
  scope: "copilot",
  redirectUri: DEFAULT_OAUTH_REDIRECT_URI,
};

/**
 * OAuth configuration for Cursor.
 */
export const cursorOAuthConfig: OAuthProviderConfig = {
  authorizationEndpoint: "https://cursor.sh/oauth/authorize",
  tokenEndpoint: "https://cursor.sh/oauth/token",
  clientId: "cursor-placeholder",
  scope: "openid profile",
  redirectUri: DEFAULT_OAUTH_REDIRECT_URI,
};

/**
 * OAuth configuration for Codex (OpenAI).
 */
export const codexOAuthConfig: OAuthProviderConfig = {
  authorizationEndpoint: "https://auth.openai.com/authorize",
  tokenEndpoint: "https://auth.openai.com/oauth/token",
  clientId: "codex-placeholder",
  scope: "openid profile",
  redirectUri: DEFAULT_OAUTH_REDIRECT_URI,
};

/**
 * OAuth configuration for Antigravity.
 */
export const antigravityOAuthConfig: OAuthProviderConfig = {
  authorizationEndpoint: "https://antigravity.dev/oauth/authorize",
  tokenEndpoint: "https://antigravity.dev/oauth/token",
  clientId: "antigravity-placeholder",
  scope: "openid profile",
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
};

/**
 * Get OAuth provider config by provider type.
 * Returns undefined if the provider type is not an OAuth PKCE provider.
 */
export function getOAuthProviderConfig(providerType: string): OAuthProviderConfig | undefined {
  return oauthProviderConfigMap[providerType];
}
