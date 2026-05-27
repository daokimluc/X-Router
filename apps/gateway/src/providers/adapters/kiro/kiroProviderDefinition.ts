import type { ProviderTypeDefinition } from "../../registry/ProviderTypeDefinition.js";

export const kiroProviderDefinition: ProviderTypeDefinition = {
  type: "kiro",
  displayName: "Kiro",
  adapterName: "KiroProviderAdapter",
  authMethods: ["oauth", "refresh_token", "bearer_token", "custom_json"],
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
      },
      authRegion: {
        type: "string"
      },
      apiRegion: {
        type: "string"
      },
      clientId: {
        type: "string"
      },
      clientSecret: {
        type: "string"
      },
      authMethod: {
        type: "string",
        enum: ["social", "idc"]
      },
      machineId: {
        type: "string"
      }
    }
  }
};
