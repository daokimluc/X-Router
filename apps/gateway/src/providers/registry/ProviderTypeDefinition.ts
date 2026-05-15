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
  | "custom_json";

export type ProviderTypeDefinition = {
  type: string;
  displayName: string;
  adapterName: string;
  authMethods: ProviderAuthMethod[];
  supportedProtocols: ProviderProtocol[];
  capabilities: ProviderCapabilities;
  configSchema: Record<string, unknown>;
  credentialSchema: Record<string, unknown>;
};

