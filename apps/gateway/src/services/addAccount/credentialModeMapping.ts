/**
 * Credential mode mapping from ProviderAuthMethod to CredentialMode
 * @module services/addAccount/credentialModeMapping
 */

import type { ProviderAuthMethod, ProviderTypeDefinition } from "../../providers/registry/ProviderTypeDefinition.js";
import type { CredentialMode } from "./normalize.js";

/**
 * Maps existing authMethods to credentialMode.
 * null means the auth method is not supported in add-account flow.
 */
const AUTH_METHOD_TO_CREDENTIAL_MODE: Record<ProviderAuthMethod, CredentialMode | null> = {
  oauth: "oauth_pkce",
  refresh_token: "refresh_token",
  api_key: "api_key",
  bearer_token: "api_key", // bearer_token uses same flow as api_key
  session_cookie: null, // not supported in add-account flow
  custom_json: null, // not supported in add-account flow
};

/**
 * Get supported credential modes for a provider type definition.
 * Special case: mock provider includes mock_static.
 */
export function getSupportedCredentialModes(
  definition: ProviderTypeDefinition
): CredentialMode[] {
  const modes = new Set<CredentialMode>();

  for (const authMethod of definition.authMethods) {
    const mode = AUTH_METHOD_TO_CREDENTIAL_MODE[authMethod];
    if (mode !== null) {
      modes.add(mode);
    }
  }

  // Special case: mock provider supports mock_static
  if (definition.type === "mock") {
    modes.add("mock_static");
  }

  return Array.from(modes);
}

/**
 * Check if a credential mode is supported by a provider type definition.
 */
export function isCredentialModeSupported(
  definition: ProviderTypeDefinition,
  mode: CredentialMode
): boolean {
  return getSupportedCredentialModes(definition).includes(mode);
}
