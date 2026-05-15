import type { ProviderTypeDefinition } from "../../registry/ProviderTypeDefinition.js";

export const mockProviderDefinition: ProviderTypeDefinition = {
  type: "mock",
  displayName: "Mock Provider",
  adapterName: "MockProviderAdapter",
  authMethods: ["api_key"],
  supportedProtocols: ["openai_chat_completions", "anthropic_messages"],
  capabilities: {
    protocols: ["openai_chat_completions", "anthropic_messages"],
    flags: ["chat", "messages", "streaming"],
    maxInputTokens: 200000,
    maxOutputTokens: 8192
  },
  configSchema: {
    type: "object",
    properties: {
      mode: {
        type: "string"
      }
    }
  },
  credentialSchema: {
    type: "object",
    properties: {
      apiKey: {
        type: "string"
      }
    }
  }
};

