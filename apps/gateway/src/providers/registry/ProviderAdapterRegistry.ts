import type { AIProviderAdapter } from "../base/AIProviderAdapter.js";
import type { ProviderProtocol } from "../base/ProviderCapabilities.js";
import { ProviderConfigError } from "../base/ProviderErrors.js";
import type {
  ProviderAuthMethod,
  ProviderTypeDefinition
} from "./ProviderTypeDefinition.js";

const VALID_TYPE_PATTERN = /^[a-z0-9_]+$/;

const VALID_AUTH_METHODS: readonly ProviderAuthMethod[] = [
  "api_key",
  "bearer_token",
  "oauth",
  "refresh_token",
  "session_cookie",
  "custom_json",
  "service_account",
  "none"
] as const;

const VALID_PROTOCOLS: readonly ProviderProtocol[] = [
  "openai_chat_completions",
  "anthropic_messages",
  "custom"
] as const;

export class ProviderAdapterRegistry {
  private readonly entries = new Map<
    string,
    {
      definition: ProviderTypeDefinition;
      adapter: AIProviderAdapter;
    }
  >();

  register(definition: ProviderTypeDefinition, adapter: AIProviderAdapter): void {
    this.validateDefinition(definition);

    if (definition.type !== adapter.type) {
      throw new ProviderConfigError(
        `Provider definition type "${definition.type}" does not match adapter type "${adapter.type}"`
      );
    }

    if (this.entries.has(definition.type)) {
      throw new ProviderConfigError(
        `Provider type "${definition.type}" is already registered. Each provider type must be unique in the registry.`
      );
    }

    this.entries.set(definition.type, {
      definition: structuredClone(definition),
      adapter
    });
  }

  /**
   * Register a catalog entry where the adapter serves multiple provider types.
   * Unlike `register()`, this does NOT enforce adapter.type === definition.type,
   * because generic adapters (e.g., GenericOpenAIAdapter) handle many provider types.
   */
  registerCatalogEntry(definition: ProviderTypeDefinition, adapter: AIProviderAdapter): void {
    this.validateDefinition(definition);

    if (this.entries.has(definition.type)) {
      throw new ProviderConfigError(
        `Provider type "${definition.type}" is already registered. Each provider type must be unique in the registry.`
      );
    }

    this.entries.set(definition.type, {
      definition: structuredClone(definition),
      adapter
    });
  }

  private validateDefinition(definition: ProviderTypeDefinition): void {
    // Validate type field: non-empty, lowercase alphanumeric + underscore only
    if (!definition.type || !VALID_TYPE_PATTERN.test(definition.type)) {
      throw new ProviderConfigError(
        `Invalid provider type "${definition.type}". Type must be a non-empty string containing only lowercase alphanumeric characters and underscores (pattern: /^[a-z0-9_]+$/).`
      );
    }

    // Validate authMethods: at least one valid ProviderAuthMethod value
    if (
      !Array.isArray(definition.authMethods) ||
      definition.authMethods.length === 0
    ) {
      throw new ProviderConfigError(
        `Provider "${definition.type}" must have at least one authMethod. Valid values: ${VALID_AUTH_METHODS.join(", ")}.`
      );
    }

    const invalidAuthMethods = definition.authMethods.filter(
      (method) => !VALID_AUTH_METHODS.includes(method)
    );
    if (invalidAuthMethods.length > 0) {
      throw new ProviderConfigError(
        `Provider "${definition.type}" has invalid authMethods: ${invalidAuthMethods.join(", ")}. Valid values: ${VALID_AUTH_METHODS.join(", ")}.`
      );
    }

    // Validate supportedProtocols: at least one valid ProviderProtocol value
    if (
      !Array.isArray(definition.supportedProtocols) ||
      definition.supportedProtocols.length === 0
    ) {
      throw new ProviderConfigError(
        `Provider "${definition.type}" must have at least one supportedProtocol. Valid values: ${VALID_PROTOCOLS.join(", ")}.`
      );
    }

    const invalidProtocols = definition.supportedProtocols.filter(
      (protocol) => !VALID_PROTOCOLS.includes(protocol)
    );
    if (invalidProtocols.length > 0) {
      throw new ProviderConfigError(
        `Provider "${definition.type}" has invalid supportedProtocols: ${invalidProtocols.join(", ")}. Valid values: ${VALID_PROTOCOLS.join(", ")}.`
      );
    }
  }

  getAdapter(providerType: string): AIProviderAdapter {
    const entry = this.entries.get(providerType);

    if (!entry) {
      throw new ProviderConfigError(
        `Provider adapter not registered for type ${providerType}`
      );
    }

    return entry.adapter;
  }

  getDefinition(providerType: string): ProviderTypeDefinition | undefined {
    const entry = this.entries.get(providerType);
    return entry ? structuredClone(entry.definition) : undefined;
  }

  listProviderTypes(): ProviderTypeDefinition[] {
    return Array.from(this.entries.values()).map((entry) =>
      structuredClone(entry.definition)
    );
  }
}

