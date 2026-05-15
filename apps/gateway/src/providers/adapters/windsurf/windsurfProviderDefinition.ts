import type { ProviderTypeDefinition } from "../../registry/ProviderTypeDefinition.js";

export const windsurfProviderDefinition: ProviderTypeDefinition = {
  type: "windsurf",
  displayName: "Windsurf",
  adapterName: "WindsurfProviderAdapter",
  authMethods: ["oauth", "bearer_token", "refresh_token", "custom_json"],
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
      defaultModel: {
        type: "string"
      }
    }
  },
  credentialSchema: {
    type: "object",
    properties: {
      token: {
        type: "string"
      },
      accessToken: {
        type: "string"
      },
      refreshToken: {
        type: "string"
      },
      apiKey: {
        type: "string"
      },
      apiServerUrl: {
        type: "string"
      },
      email: {
        type: "string"
      },
      expiresAt: {
        type: "string"
      }
    }
  }
};
