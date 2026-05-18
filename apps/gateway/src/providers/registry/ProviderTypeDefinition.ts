import type {
  ProviderCapabilities,
  ProviderProtocol
} from "../base/ProviderCapabilities.js";

export type ProviderAuthMethod =
  | "api_key"
  | "bearer_token"
  | "oauth"
  | "refresh_token"
  | "session_cookie"
  | "custom_json"
  | "service_account"
  | "none";

export type ProviderCategory =
  | "free"
  | "oauth_subscription"
  | "api_key_cheap"
  | "api_key_premium"
  | "cloud_platform"
  | "custom";

export type OAuthProviderConfig = {
  authorizationEndpoint: string;
  tokenEndpoint: string;
  clientId: string;
  clientSecret?: string;
  scope: string;
  redirectUri: string;
  extraParams?: Record<string, string>;
};

export type ProviderTypeDefinition = {
  type: string;
  displayName: string;
  adapterName: string;
  authMethods: ProviderAuthMethod[];
  supportedProtocols: ProviderProtocol[];
  capabilities: ProviderCapabilities;
  configSchema: Record<string, unknown>;
  credentialSchema: Record<string, unknown>;
  category?: ProviderCategory;
  logoUrl?: string;
  defaultBaseUrl?: string;
  oauthConfig?: OAuthProviderConfig;
};

