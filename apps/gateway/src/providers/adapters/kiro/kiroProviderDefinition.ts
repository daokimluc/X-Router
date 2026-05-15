import type { ProviderTypeDefinition } from "../../registry/ProviderTypeDefinition.js";

export const kiroProviderDefinition: ProviderTypeDefinition = {
  type: "kiro",
  displayName: "Kiro",
  adapterName: "KiroProviderAdapter",
  authMethods: ["oauth", "refresh_token", "bearer_token", "custom_json"],
  supportedProtocols: ["openai_chat_completions"],
  capabilities: {
    protocols: ["openai_chat_completions"],
    flags: ["chat"],
    maxInputTokens: 200000,
    maxOutputTokens: 8192
  },
  configSchema: {
    type: "object",
    properties: {
      baseUrl: {
        type: "string"
      },
      chatCompletionsPath: {
        type: "string"
      },
      region: {
        type: "string"
      },
      defaultModel: {
        type: "string"
      }
    }
  },
  credentialSchema: {
    type: "object",
    properties: {
      accessToken: {
        type: "string"
      },
      refreshToken: {
        type: "string"
      },
      expiresAt: {
        type: "string"
      },
      region: {
        type: "string"
      }
    }
  }
};
