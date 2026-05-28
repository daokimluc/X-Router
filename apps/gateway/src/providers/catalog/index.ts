import type { ProviderTypeDefinition } from "../registry/ProviderTypeDefinition.js";

/**
 * Provider Catalog - Pre-defined ProviderTypeDefinitions for all supported providers.
 *
 * Categories:
 * - api_key_premium: High-tier providers with API key auth
 * - api_key_cheap: Budget-friendly providers with API key auth
 * - cloud_platform: Cloud-specific providers (Azure, Vertex AI)
 * - oauth_subscription: Providers requiring OAuth PKCE flow
 * - free: No-auth providers
 * - custom: User-defined providers
 */

// ============================================================================
// API Key Premium Providers
// ============================================================================

const openai: ProviderTypeDefinition = {
  type: "openai",
  displayName: "OpenAI",
  adapterName: "GenericOpenAIAdapter",
  authMethods: ["api_key"],
  supportedProtocols: ["openai_chat_completions"],
  capabilities: { protocols: ["openai_chat_completions"], flags: ["chat", "streaming", "tool_calling", "json_mode", "image_input"] },
  configSchema: {
    type: "object",
    properties: {
      baseUrl: { type: "string", default: "https://api.openai.com" },
      chatCompletionsPath: { type: "string", default: "/v1/chat/completions" },
      modelsPath: { type: "string", default: "/v1/models" },
    },
  },
  credentialSchema: {
    type: "object",
    properties: {
      apiKey: { type: "string" },
    },
    required: ["apiKey"],
  },
  category: "api_key_premium",
  defaultBaseUrl: "https://api.openai.com",
};

const anthropic: ProviderTypeDefinition = {
  type: "anthropic",
  displayName: "Anthropic",
  adapterName: "AnthropicMessagesAdapter",
  authMethods: ["api_key"],
  supportedProtocols: ["anthropic_messages"],
  capabilities: { protocols: ["anthropic_messages"], flags: ["messages", "streaming", "tool_calling", "image_input"] },
  configSchema: {
    type: "object",
    properties: {
      baseUrl: { type: "string", default: "https://api.anthropic.com" },
    },
  },
  credentialSchema: {
    type: "object",
    properties: {
      apiKey: { type: "string" },
    },
    required: ["apiKey"],
  },
  category: "api_key_premium",
  defaultBaseUrl: "https://api.anthropic.com",
};

const xai: ProviderTypeDefinition = {
  type: "xai",
  displayName: "xAI",
  adapterName: "GenericOpenAIAdapter",
  authMethods: ["api_key"],
  supportedProtocols: ["openai_chat_completions"],
  capabilities: { protocols: ["openai_chat_completions"], flags: ["chat", "streaming"] },
  configSchema: {
    type: "object",
    properties: {
      baseUrl: { type: "string", default: "https://api.x.ai" },
      chatCompletionsPath: { type: "string", default: "/v1/chat/completions" },
      modelsPath: { type: "string", default: "/v1/models" },
    },
  },
  credentialSchema: {
    type: "object",
    properties: {
      apiKey: { type: "string" },
    },
    required: ["apiKey"],
  },
  category: "api_key_premium",
  defaultBaseUrl: "https://api.x.ai",
};

const mistral: ProviderTypeDefinition = {
  type: "mistral",
  displayName: "Mistral",
  adapterName: "GenericOpenAIAdapter",
  authMethods: ["api_key"],
  supportedProtocols: ["openai_chat_completions"],
  capabilities: { protocols: ["openai_chat_completions"], flags: ["chat", "streaming", "tool_calling", "json_mode"] },
  configSchema: {
    type: "object",
    properties: {
      baseUrl: { type: "string", default: "https://api.mistral.ai" },
      chatCompletionsPath: { type: "string", default: "/v1/chat/completions" },
      modelsPath: { type: "string", default: "/v1/models" },
    },
  },
  credentialSchema: {
    type: "object",
    properties: {
      apiKey: { type: "string" },
    },
    required: ["apiKey"],
  },
  category: "api_key_premium",
  defaultBaseUrl: "https://api.mistral.ai",
};

const cohere: ProviderTypeDefinition = {
  type: "cohere",
  displayName: "Cohere",
  adapterName: "GenericOpenAIAdapter",
  authMethods: ["api_key"],
  supportedProtocols: ["openai_chat_completions"],
  capabilities: { protocols: ["openai_chat_completions"], flags: ["chat", "streaming", "tool_calling"] },
  configSchema: {
    type: "object",
    properties: {
      baseUrl: { type: "string", default: "https://api.cohere.ai" },
      chatCompletionsPath: { type: "string", default: "/v1/chat/completions" },
      modelsPath: { type: "string", default: "/v1/models" },
    },
  },
  credentialSchema: {
    type: "object",
    properties: {
      apiKey: { type: "string" },
    },
    required: ["apiKey"],
  },
  category: "api_key_premium",
  defaultBaseUrl: "https://api.cohere.com",
};

const perplexity: ProviderTypeDefinition = {
  type: "perplexity",
  displayName: "Perplexity",
  adapterName: "GenericOpenAIAdapter",
  authMethods: ["api_key"],
  supportedProtocols: ["openai_chat_completions"],
  capabilities: { protocols: ["openai_chat_completions"], flags: ["chat", "streaming"] },
  configSchema: {
    type: "object",
    properties: {
      baseUrl: { type: "string", default: "https://api.perplexity.ai" },
      chatCompletionsPath: { type: "string", default: "/v1/chat/completions" },
      modelsPath: { type: "string", default: "/v1/models" },
    },
  },
  credentialSchema: {
    type: "object",
    properties: {
      apiKey: { type: "string" },
    },
    required: ["apiKey"],
  },
  category: "api_key_premium",
  defaultBaseUrl: "https://api.perplexity.ai",
};

const nvidiaNim: ProviderTypeDefinition = {
  type: "nvidia_nim",
  displayName: "NVIDIA NIM",
  adapterName: "GenericOpenAIAdapter",
  authMethods: ["api_key"],
  supportedProtocols: ["openai_chat_completions"],
  capabilities: { protocols: ["openai_chat_completions"], flags: ["chat", "streaming"] },
  configSchema: {
    type: "object",
    properties: {
      baseUrl: { type: "string", default: "https://integrate.api.nvidia.com" },
      chatCompletionsPath: { type: "string", default: "/v1/chat/completions" },
      modelsPath: { type: "string", default: "/v1/models" },
    },
  },
  credentialSchema: {
    type: "object",
    properties: {
      apiKey: { type: "string" },
    },
    required: ["apiKey"],
  },
  category: "api_key_premium",
  defaultBaseUrl: "https://integrate.api.nvidia.com",
};

const openrouter: ProviderTypeDefinition = {
  type: "openrouter",
  displayName: "OpenRouter",
  adapterName: "GenericOpenAIAdapter",
  authMethods: ["api_key"],
  supportedProtocols: ["openai_chat_completions"],
  capabilities: { protocols: ["openai_chat_completions"], flags: ["chat", "streaming", "tool_calling"] },
  configSchema: {
    type: "object",
    properties: {
      baseUrl: { type: "string", default: "https://openrouter.ai/api" },
      chatCompletionsPath: { type: "string", default: "/v1/chat/completions" },
      modelsPath: { type: "string", default: "/v1/models" },
    },
  },
  credentialSchema: {
    type: "object",
    properties: {
      apiKey: { type: "string" },
    },
    required: ["apiKey"],
  },
  category: "api_key_premium",
  defaultBaseUrl: "https://openrouter.ai/api",
};

// ============================================================================
// API Key Cheap Providers
// ============================================================================

const deepseek: ProviderTypeDefinition = {
  type: "deepseek",
  displayName: "DeepSeek",
  adapterName: "GenericOpenAIAdapter",
  authMethods: ["api_key"],
  supportedProtocols: ["openai_chat_completions"],
  capabilities: { protocols: ["openai_chat_completions"], flags: ["chat", "streaming", "tool_calling"] },
  configSchema: {
    type: "object",
    properties: {
      baseUrl: { type: "string", default: "https://api.deepseek.com" },
      chatCompletionsPath: { type: "string", default: "/chat/completions" },
      modelsPath: { type: "string", default: "/models" },
    },
  },
  credentialSchema: {
    type: "object",
    properties: {
      apiKey: { type: "string" },
    },
    required: ["apiKey"],
  },
  category: "api_key_cheap",
  defaultBaseUrl: "https://api.deepseek.com",
};

const groq: ProviderTypeDefinition = {
  type: "groq",
  displayName: "Groq",
  adapterName: "GenericOpenAIAdapter",
  authMethods: ["api_key"],
  supportedProtocols: ["openai_chat_completions"],
  capabilities: { protocols: ["openai_chat_completions"], flags: ["chat", "streaming", "tool_calling", "json_mode"] },
  configSchema: {
    type: "object",
    properties: {
      baseUrl: { type: "string", default: "https://api.groq.com" },
      chatCompletionsPath: { type: "string", default: "/openai/v1/chat/completions" },
      modelsPath: { type: "string", default: "/openai/v1/models" },
    },
  },
  credentialSchema: {
    type: "object",
    properties: {
      apiKey: { type: "string" },
    },
    required: ["apiKey"],
  },
  category: "api_key_cheap",
  defaultBaseUrl: "https://api.groq.com",
};

const togetherAi: ProviderTypeDefinition = {
  type: "together_ai",
  displayName: "Together AI",
  adapterName: "GenericOpenAIAdapter",
  authMethods: ["api_key"],
  supportedProtocols: ["openai_chat_completions"],
  capabilities: { protocols: ["openai_chat_completions"], flags: ["chat", "streaming", "tool_calling", "json_mode"] },
  configSchema: {
    type: "object",
    properties: {
      baseUrl: { type: "string", default: "https://api.together.xyz" },
      chatCompletionsPath: { type: "string", default: "/v1/chat/completions" },
      modelsPath: { type: "string", default: "/v1/models" },
    },
  },
  credentialSchema: {
    type: "object",
    properties: {
      apiKey: { type: "string" },
    },
    required: ["apiKey"],
  },
  category: "api_key_cheap",
  defaultBaseUrl: "https://api.together.xyz",
};

const siliconflow: ProviderTypeDefinition = {
  type: "siliconflow",
  displayName: "SiliconFlow",
  adapterName: "GenericOpenAIAdapter",
  authMethods: ["api_key"],
  supportedProtocols: ["openai_chat_completions"],
  capabilities: { protocols: ["openai_chat_completions"], flags: ["chat", "streaming"] },
  configSchema: {
    type: "object",
    properties: {
      baseUrl: { type: "string", default: "https://api.siliconflow.cn" },
      chatCompletionsPath: { type: "string", default: "/v1/chat/completions" },
      modelsPath: { type: "string", default: "/v1/models" },
    },
  },
  credentialSchema: {
    type: "object",
    properties: {
      apiKey: { type: "string" },
    },
    required: ["apiKey"],
  },
  category: "api_key_cheap",
  defaultBaseUrl: "https://api.siliconflow.cn",
};

const fireworks: ProviderTypeDefinition = {
  type: "fireworks",
  displayName: "Fireworks",
  adapterName: "GenericOpenAIAdapter",
  authMethods: ["api_key"],
  supportedProtocols: ["openai_chat_completions"],
  capabilities: { protocols: ["openai_chat_completions"], flags: ["chat", "streaming", "tool_calling", "json_mode"] },
  configSchema: {
    type: "object",
    properties: {
      baseUrl: { type: "string", default: "https://api.fireworks.ai" },
      chatCompletionsPath: { type: "string", default: "/inference/v1/chat/completions" },
      modelsPath: { type: "string", default: "/inference/v1/models" },
    },
  },
  credentialSchema: {
    type: "object",
    properties: {
      apiKey: { type: "string" },
    },
    required: ["apiKey"],
  },
  category: "api_key_cheap",
  defaultBaseUrl: "https://api.fireworks.ai",
};

const cerebras: ProviderTypeDefinition = {
  type: "cerebras",
  displayName: "Cerebras",
  adapterName: "GenericOpenAIAdapter",
  authMethods: ["api_key"],
  supportedProtocols: ["openai_chat_completions"],
  capabilities: { protocols: ["openai_chat_completions"], flags: ["chat", "streaming"] },
  configSchema: {
    type: "object",
    properties: {
      baseUrl: { type: "string", default: "https://api.cerebras.ai" },
      chatCompletionsPath: { type: "string", default: "/v1/chat/completions" },
      modelsPath: { type: "string", default: "/v1/models" },
    },
  },
  credentialSchema: {
    type: "object",
    properties: {
      apiKey: { type: "string" },
    },
    required: ["apiKey"],
  },
  category: "api_key_cheap",
  defaultBaseUrl: "https://api.cerebras.ai",
};

const nebius: ProviderTypeDefinition = {
  type: "nebius",
  displayName: "Nebius",
  adapterName: "GenericOpenAIAdapter",
  authMethods: ["api_key"],
  supportedProtocols: ["openai_chat_completions"],
  capabilities: { protocols: ["openai_chat_completions"], flags: ["chat", "streaming"] },
  configSchema: {
    type: "object",
    properties: {
      baseUrl: { type: "string", default: "https://api.studio.nebius.ai" },
      chatCompletionsPath: { type: "string", default: "/v1/chat/completions" },
      modelsPath: { type: "string", default: "/v1/models" },
    },
  },
  credentialSchema: {
    type: "object",
    properties: {
      apiKey: { type: "string" },
    },
    required: ["apiKey"],
  },
  category: "api_key_cheap",
  defaultBaseUrl: "https://api.studio.nebius.ai",
};

const glmZhipu: ProviderTypeDefinition = {
  type: "glm_zhipu",
  displayName: "GLM/Zhipu AI",
  adapterName: "GenericOpenAIAdapter",
  authMethods: ["api_key"],
  supportedProtocols: ["openai_chat_completions"],
  capabilities: { protocols: ["openai_chat_completions"], flags: ["chat", "streaming", "tool_calling"] },
  configSchema: {
    type: "object",
    properties: {
      baseUrl: { type: "string", default: "https://open.bigmodel.cn" },
      chatCompletionsPath: { type: "string", default: "/v1/chat/completions" },
      modelsPath: { type: "string", default: "/v1/models" },
    },
  },
  credentialSchema: {
    type: "object",
    properties: {
      apiKey: { type: "string" },
    },
    required: ["apiKey"],
  },
  category: "api_key_cheap",
  defaultBaseUrl: "https://open.bigmodel.cn",
};

const minimax: ProviderTypeDefinition = {
  type: "minimax",
  displayName: "MiniMax",
  adapterName: "GenericOpenAIAdapter",
  authMethods: ["api_key"],
  supportedProtocols: ["openai_chat_completions"],
  capabilities: { protocols: ["openai_chat_completions"], flags: ["chat", "streaming"] },
  configSchema: {
    type: "object",
    properties: {
      baseUrl: { type: "string", default: "https://api.minimax.chat" },
      chatCompletionsPath: { type: "string", default: "/v1/chat/completions" },
      modelsPath: { type: "string", default: "/v1/models" },
    },
  },
  credentialSchema: {
    type: "object",
    properties: {
      apiKey: { type: "string" },
    },
    required: ["apiKey"],
  },
  category: "api_key_cheap",
  defaultBaseUrl: "https://api.minimax.chat",
};

const kimiMoonshot: ProviderTypeDefinition = {
  type: "kimi_moonshot",
  displayName: "Kimi/Moonshot",
  adapterName: "GenericOpenAIAdapter",
  authMethods: ["api_key"],
  supportedProtocols: ["openai_chat_completions"],
  capabilities: { protocols: ["openai_chat_completions"], flags: ["chat", "streaming", "tool_calling"] },
  configSchema: {
    type: "object",
    properties: {
      baseUrl: { type: "string", default: "https://api.moonshot.cn" },
      chatCompletionsPath: { type: "string", default: "/v1/chat/completions" },
      modelsPath: { type: "string", default: "/v1/models" },
    },
  },
  credentialSchema: {
    type: "object",
    properties: {
      apiKey: { type: "string" },
    },
    required: ["apiKey"],
  },
  category: "api_key_cheap",
  defaultBaseUrl: "https://api.moonshot.cn",
};

// ============================================================================
// Google Gemini (API Key with apiVersion)
// ============================================================================

const gemini: ProviderTypeDefinition = {
  type: "gemini",
  displayName: "Google Gemini",
  adapterName: "GenericOpenAIAdapter",
  authMethods: ["api_key"],
  supportedProtocols: ["openai_chat_completions"],
  capabilities: { protocols: ["openai_chat_completions"], flags: ["chat", "streaming", "tool_calling", "json_mode", "image_input"] },
  configSchema: {
    type: "object",
    properties: {
      baseUrl: { type: "string", default: "https://generativelanguage.googleapis.com" },
      chatCompletionsPath: { type: "string", default: "/v1/chat/completions" },
      modelsPath: { type: "string", default: "/v1/models" },
      apiVersion: { type: "string", default: "v1beta", description: "Gemini API version (e.g. v1beta, v1)" },
    },
  },
  credentialSchema: {
    type: "object",
    properties: {
      apiKey: { type: "string" },
    },
    required: ["apiKey"],
  },
  category: "api_key_premium",
  defaultBaseUrl: "https://generativelanguage.googleapis.com",
};

// ============================================================================
// Cloud Platform Providers
// ============================================================================

const azureOpenai: ProviderTypeDefinition = {
  type: "azure_openai",
  displayName: "Azure OpenAI",
  adapterName: "AzureOpenAIAdapter",
  authMethods: ["api_key"],
  supportedProtocols: ["openai_chat_completions"],
  capabilities: { protocols: ["openai_chat_completions"], flags: ["chat", "streaming", "tool_calling", "json_mode"] },
  configSchema: {
    type: "object",
    properties: {
      resourceName: { type: "string", description: "Azure resource name" },
      deploymentName: { type: "string", description: "Model deployment name" },
      apiVersion: { type: "string", default: "2024-02-01", description: "Azure OpenAI API version" },
    },
    required: ["resourceName", "deploymentName"],
  },
  credentialSchema: {
    type: "object",
    properties: {
      apiKey: { type: "string" },
    },
    required: ["apiKey"],
  },
  category: "cloud_platform",
};

const vertexAi: ProviderTypeDefinition = {
  type: "vertex_ai",
  displayName: "Vertex AI",
  adapterName: "VertexAIAdapter",
  authMethods: ["service_account"],
  supportedProtocols: ["openai_chat_completions"],
  capabilities: { protocols: ["openai_chat_completions"], flags: ["chat", "streaming", "tool_calling", "json_mode", "image_input"] },
  configSchema: {
    type: "object",
    properties: {
      projectId: { type: "string", description: "Google Cloud project ID" },
      region: { type: "string", default: "us-central1", description: "GCP region" },
    },
    required: ["projectId"],
  },
  credentialSchema: {
    type: "object",
    properties: {
      serviceAccountJson: { type: "string", description: "Service account JSON key" },
    },
    required: ["serviceAccountJson"],
  },
  category: "cloud_platform",
};

// ============================================================================
// OAuth Subscription Providers
// ============================================================================

const claudeCode: ProviderTypeDefinition = {
  type: "claude_code",
  displayName: "Claude Code",
  adapterName: "OAuthPKCEAdapter",
  authMethods: ["oauth"],
  supportedProtocols: ["openai_chat_completions"],
  capabilities: { protocols: ["openai_chat_completions"], flags: ["chat", "streaming", "tool_calling"] },
  configSchema: {
    type: "object",
    properties: {},
  },
  credentialSchema: {
    type: "object",
    properties: {
      accessToken: { type: "string" },
      refreshToken: { type: "string" },
    },
    required: ["accessToken"],
  },
  category: "oauth_subscription",
  oauthConfig: {
    authorizationEndpoint: "https://claude.ai/oauth/authorize",
    tokenEndpoint: "https://api.anthropic.com/v1/oauth/token",
    clientId: "9d1c250a-e61b-44d9-88ed-5944d1962f5e",
    scope: "org:create_api_key user:profile user:inference",
    redirectUri: "/oauth/callback",
  },
};

const githubCopilot: ProviderTypeDefinition = {
  type: "github_copilot",
  displayName: "GitHub Copilot",
  adapterName: "GitHubCopilotAdapter",
  authMethods: ["oauth"],
  supportedProtocols: ["openai_chat_completions"],
  capabilities: { protocols: ["openai_chat_completions"], flags: ["chat", "streaming", "tool_calling"] },
  configSchema: {
    type: "object",
    properties: {},
  },
  credentialSchema: {
    type: "object",
    properties: {
      accessToken: { type: "string" },
      refreshToken: { type: "string" },
    },
    required: ["accessToken"],
  },
  category: "oauth_subscription",
  oauthConfig: {
    authorizationEndpoint: "https://github.com/login/oauth/authorize",
    tokenEndpoint: "https://github.com/login/oauth/access_token",
    clientId: "Iv1.b507a08c87ecfe98",
    scope: "read:user",
    redirectUri: "/oauth/callback",
  },
};

const cursor: ProviderTypeDefinition = {
  type: "cursor",
  displayName: "Cursor",
  adapterName: "OAuthPKCEAdapter",
  authMethods: ["oauth"],
  supportedProtocols: ["openai_chat_completions"],
  capabilities: { protocols: ["openai_chat_completions"], flags: ["chat", "streaming"] },
  configSchema: {
    type: "object",
    properties: {},
  },
  credentialSchema: {
    type: "object",
    properties: {
      accessToken: { type: "string" },
      refreshToken: { type: "string" },
    },
    required: ["accessToken"],
  },
  category: "oauth_subscription",
  oauthConfig: {
    authorizationEndpoint: "https://www.cursor.com/loginDeepControl",
    tokenEndpoint: "https://api2.cursor.sh/auth/full_stripe_profile",
    clientId: "cursor-client",
    scope: "openid profile",
    redirectUri: "/oauth/callback",
  },
};

const codex: ProviderTypeDefinition = {
  type: "codex",
  displayName: "Codex",
  adapterName: "CodexAdapter",
  authMethods: ["oauth"],
  supportedProtocols: ["openai_chat_completions"],
  capabilities: { protocols: ["openai_chat_completions"], flags: ["chat", "streaming", "tool_calling"] },
  configSchema: {
    type: "object",
    properties: {
      baseUrl: { type: "string", default: "https://chatgpt.com/backend-api/codex" },
      chatCompletionsPath: { type: "string", default: "/responses" },
    },
  },
  credentialSchema: {
    type: "object",
    properties: {
      accessToken: { type: "string" },
      refreshToken: { type: "string" },
    },
    required: ["accessToken"],
  },
  category: "oauth_subscription",
  defaultBaseUrl: "https://chatgpt.com/backend-api/codex",
  oauthConfig: {
    authorizationEndpoint: "https://auth.openai.com/oauth/authorize",
    tokenEndpoint: "https://auth.openai.com/oauth/token",
    clientId: "app_EMoamEEZ73f0CkXaXp7hrann",
    scope: "openid profile email offline_access",
    redirectUri: "http://127.0.0.1:1455/auth/callback",
    extraParams: {
      id_token_add_organizations: "true",
      codex_cli_simplified_flow: "true",
      originator: "codex_cli_rs"
    }
  },
};

const antigravity: ProviderTypeDefinition = {
  type: "antigravity",
  displayName: "Antigravity",
  adapterName: "AntigravityAdapter",
  authMethods: ["oauth"],
  supportedProtocols: ["openai_chat_completions"],
  capabilities: { protocols: ["openai_chat_completions"], flags: ["chat", "streaming"] },
  configSchema: {
    type: "object",
    properties: {},
  },
  credentialSchema: {
    type: "object",
    properties: {
      accessToken: { type: "string" },
      refreshToken: { type: "string" },
    },
    required: ["accessToken"],
  },
  category: "oauth_subscription",
  oauthConfig: {
    authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenEndpoint: "https://oauth2.googleapis.com/token",
    clientId: "1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com",
    clientSecret: "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",
    scope: "https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile",
    redirectUri: "/oauth/callback",
  },
};

const kilocode: ProviderTypeDefinition = {
  type: "kilocode",
  displayName: "Kilo Code",
  adapterName: "OAuthPKCEAdapter",
  authMethods: ["oauth"],
  supportedProtocols: ["openai_chat_completions"],
  capabilities: { protocols: ["openai_chat_completions"], flags: ["chat", "streaming"] },
  configSchema: { type: "object", properties: {} },
  credentialSchema: { type: "object", properties: { accessToken: { type: "string" }, refreshToken: { type: "string" } }, required: ["accessToken"] },
  category: "oauth_subscription",
  oauthConfig: { authorizationEndpoint: "https://api.kilo.ai/api/device-auth/codes", tokenEndpoint: "https://api.kilo.ai/api/device-auth/codes", clientId: "kilocode-client", scope: "openid", redirectUri: "/oauth/callback" },
};

const cline: ProviderTypeDefinition = {
  type: "cline",
  displayName: "Cline",
  adapterName: "OAuthPKCEAdapter",
  authMethods: ["oauth"],
  supportedProtocols: ["openai_chat_completions"],
  capabilities: { protocols: ["openai_chat_completions"], flags: ["chat", "streaming"] },
  configSchema: { type: "object", properties: {} },
  credentialSchema: { type: "object", properties: { accessToken: { type: "string" }, refreshToken: { type: "string" } }, required: ["accessToken"] },
  category: "oauth_subscription",
  oauthConfig: { authorizationEndpoint: "https://api.cline.bot/api/v1/auth/authorize", tokenEndpoint: "https://api.cline.bot/api/v1/auth/token", clientId: "cline-client", scope: "openid", redirectUri: "/oauth/callback" },
};

// ============================================================================
// Free Providers
// ============================================================================

const opencodeFree: ProviderTypeDefinition = {
  type: "opencode_free",
  displayName: "OpenCode Free",
  adapterName: "NoAuthAdapter",
  authMethods: ["none"],
  supportedProtocols: ["openai_chat_completions"],
  capabilities: { protocols: ["openai_chat_completions"], flags: ["chat", "streaming"] },
  configSchema: {
    type: "object",
    properties: {
      baseUrl: { type: "string", description: "OpenCode Free API base URL" },
    },
    required: ["baseUrl"],
  },
  credentialSchema: {
    type: "object",
    properties: {},
  },
  category: "free",
  defaultBaseUrl: "https://opencode.ai",
};

// ============================================================================
// Phase 2: Missing API Key Providers (from 9router)
// ============================================================================

const alibaba: ProviderTypeDefinition = {
  type: "alibaba",
  displayName: "Alibaba (Qwen)",
  adapterName: "GenericOpenAIAdapter",
  authMethods: ["api_key"],
  supportedProtocols: ["openai_chat_completions"],
  capabilities: { protocols: ["openai_chat_completions"], flags: ["chat", "streaming", "tool_calling"] },
  configSchema: { type: "object", properties: { baseUrl: { type: "string", default: "https://coding.dashscope.aliyuncs.com" }, chatCompletionsPath: { type: "string", default: "/v1/chat/completions" }, modelsPath: { type: "string", default: "/v1/models" } } },
  credentialSchema: { type: "object", properties: { apiKey: { type: "string" } }, required: ["apiKey"] },
  category: "api_key_cheap",
  defaultBaseUrl: "https://coding.dashscope.aliyuncs.com",
};

const alibabaIntl: ProviderTypeDefinition = {
  type: "alibaba_intl",
  displayName: "Alibaba Intl",
  adapterName: "GenericOpenAIAdapter",
  authMethods: ["api_key"],
  supportedProtocols: ["openai_chat_completions"],
  capabilities: { protocols: ["openai_chat_completions"], flags: ["chat", "streaming", "tool_calling"] },
  configSchema: { type: "object", properties: { baseUrl: { type: "string", default: "https://coding-intl.dashscope.aliyuncs.com" }, chatCompletionsPath: { type: "string", default: "/v1/chat/completions" }, modelsPath: { type: "string", default: "/v1/models" } } },
  credentialSchema: { type: "object", properties: { apiKey: { type: "string" } }, required: ["apiKey"] },
  category: "api_key_cheap",
  defaultBaseUrl: "https://coding-intl.dashscope.aliyuncs.com",
};

const volcengineArk: ProviderTypeDefinition = {
  type: "volcengine_ark",
  displayName: "Volcengine Ark",
  adapterName: "GenericOpenAIAdapter",
  authMethods: ["api_key"],
  supportedProtocols: ["openai_chat_completions"],
  capabilities: { protocols: ["openai_chat_completions"], flags: ["chat", "streaming"] },
  configSchema: { type: "object", properties: { baseUrl: { type: "string", default: "https://ark.cn-beijing.volces.com" }, chatCompletionsPath: { type: "string", default: "/api/coding/v3/chat/completions" }, modelsPath: { type: "string", default: "/api/v3/models" } } },
  credentialSchema: { type: "object", properties: { apiKey: { type: "string" } }, required: ["apiKey"] },
  category: "api_key_cheap",
  defaultBaseUrl: "https://ark.cn-beijing.volces.com",
};

const byteplus: ProviderTypeDefinition = {
  type: "byteplus",
  displayName: "BytePlus ModelArk",
  adapterName: "GenericOpenAIAdapter",
  authMethods: ["api_key"],
  supportedProtocols: ["openai_chat_completions"],
  capabilities: { protocols: ["openai_chat_completions"], flags: ["chat", "streaming"] },
  configSchema: { type: "object", properties: { baseUrl: { type: "string", default: "https://ark.ap-southeast.bytepluses.com" }, chatCompletionsPath: { type: "string", default: "/api/coding/v3/chat/completions" }, modelsPath: { type: "string", default: "/api/v3/models" } } },
  credentialSchema: { type: "object", properties: { apiKey: { type: "string" } }, required: ["apiKey"] },
  category: "api_key_cheap",
  defaultBaseUrl: "https://ark.ap-southeast.bytepluses.com",
};

const blackbox: ProviderTypeDefinition = {
  type: "blackbox",
  displayName: "Blackbox AI",
  adapterName: "GenericOpenAIAdapter",
  authMethods: ["api_key"],
  supportedProtocols: ["openai_chat_completions"],
  capabilities: { protocols: ["openai_chat_completions"], flags: ["chat", "streaming"] },
  configSchema: { type: "object", properties: { baseUrl: { type: "string", default: "https://api.blackbox.ai" }, chatCompletionsPath: { type: "string", default: "/v1/chat/completions" }, modelsPath: { type: "string", default: "/v1/models" } } },
  credentialSchema: { type: "object", properties: { apiKey: { type: "string" } }, required: ["apiKey"] },
  category: "api_key_cheap",
  defaultBaseUrl: "https://api.blackbox.ai",
};

const vercelAiGateway: ProviderTypeDefinition = {
  type: "vercel_ai_gateway",
  displayName: "Vercel AI Gateway",
  adapterName: "GenericOpenAIAdapter",
  authMethods: ["api_key"],
  supportedProtocols: ["openai_chat_completions"],
  capabilities: { protocols: ["openai_chat_completions"], flags: ["chat", "streaming"] },
  configSchema: { type: "object", properties: { baseUrl: { type: "string", default: "https://ai-gateway.vercel.sh" }, chatCompletionsPath: { type: "string", default: "/v1/chat/completions" }, modelsPath: { type: "string", default: "/v1/models" } } },
  credentialSchema: { type: "object", properties: { apiKey: { type: "string" } }, required: ["apiKey"] },
  category: "api_key_premium",
  defaultBaseUrl: "https://ai-gateway.vercel.sh",
};

const chutes: ProviderTypeDefinition = {
  type: "chutes",
  displayName: "Chutes AI",
  adapterName: "GenericOpenAIAdapter",
  authMethods: ["api_key"],
  supportedProtocols: ["openai_chat_completions"],
  capabilities: { protocols: ["openai_chat_completions"], flags: ["chat", "streaming"] },
  configSchema: { type: "object", properties: { baseUrl: { type: "string", default: "https://llm.chutes.ai" }, chatCompletionsPath: { type: "string", default: "/v1/chat/completions" }, modelsPath: { type: "string", default: "/v1/models" } } },
  credentialSchema: { type: "object", properties: { apiKey: { type: "string" } }, required: ["apiKey"] },
  category: "api_key_cheap",
  defaultBaseUrl: "https://llm.chutes.ai",
};

const hyperbolic: ProviderTypeDefinition = {
  type: "hyperbolic",
  displayName: "Hyperbolic",
  adapterName: "GenericOpenAIAdapter",
  authMethods: ["api_key"],
  supportedProtocols: ["openai_chat_completions"],
  capabilities: { protocols: ["openai_chat_completions"], flags: ["chat", "streaming"] },
  configSchema: { type: "object", properties: { baseUrl: { type: "string", default: "https://api.hyperbolic.xyz" }, chatCompletionsPath: { type: "string", default: "/v1/chat/completions" }, modelsPath: { type: "string", default: "/v1/models" } } },
  credentialSchema: { type: "object", properties: { apiKey: { type: "string" } }, required: ["apiKey"] },
  category: "api_key_cheap",
  defaultBaseUrl: "https://api.hyperbolic.xyz",
};

const cloudflareAi: ProviderTypeDefinition = {
  type: "cloudflare_ai",
  displayName: "Cloudflare Workers AI",
  adapterName: "GenericOpenAIAdapter",
  authMethods: ["api_key"],
  supportedProtocols: ["openai_chat_completions"],
  capabilities: { protocols: ["openai_chat_completions"], flags: ["chat", "streaming"] },
  configSchema: {
    type: "object",
    properties: {
      accountId: { type: "string", description: "Cloudflare Account ID" },
      baseUrl: { type: "string", default: "https://api.cloudflare.com" },
      chatCompletionsPath: { type: "string", default: "/client/v4/accounts/{accountId}/ai/v1/chat/completions" },
      modelsPath: { type: "string", default: "/client/v4/accounts/{accountId}/ai/v1/models" },
    },
    required: ["accountId"],
  },
  credentialSchema: { type: "object", properties: { apiKey: { type: "string" } }, required: ["apiKey"] },
  category: "api_key_cheap",
  defaultBaseUrl: "https://api.cloudflare.com",
};

const ollamaLocal: ProviderTypeDefinition = {
  type: "ollama_local",
  displayName: "Ollama Local",
  adapterName: "GenericOpenAIAdapter",
  authMethods: ["none"],
  supportedProtocols: ["openai_chat_completions"],
  capabilities: { protocols: ["openai_chat_completions"], flags: ["chat", "streaming"] },
  configSchema: {
    type: "object",
    properties: {
      baseUrl: { type: "string", default: "http://localhost:11434", description: "Ollama host URL" },
      chatCompletionsPath: { type: "string", default: "/v1/chat/completions" },
      modelsPath: { type: "string", default: "/v1/tags" },
    },
  },
  credentialSchema: { type: "object", properties: {} },
  category: "free",
  defaultBaseUrl: "http://localhost:11434",
};

const commandcode: ProviderTypeDefinition = {
  type: "commandcode",
  displayName: "Command Code",
  adapterName: "GenericOpenAIAdapter",
  authMethods: ["api_key"],
  supportedProtocols: ["openai_chat_completions"],
  capabilities: { protocols: ["openai_chat_completions"], flags: ["chat", "streaming"] },
  configSchema: { type: "object", properties: { baseUrl: { type: "string", default: "https://api.commandcode.ai" }, chatCompletionsPath: { type: "string", default: "/v1/chat/completions" }, modelsPath: { type: "string", default: "/v1/models" } } },
  credentialSchema: { type: "object", properties: { apiKey: { type: "string" } }, required: ["apiKey"] },
  category: "api_key_cheap",
  defaultBaseUrl: "https://api.commandcode.ai",
};

const opencodeGo: ProviderTypeDefinition = {
  type: "opencode_go",
  displayName: "OpenCode Go",
  adapterName: "GenericOpenAIAdapter",
  authMethods: ["api_key"],
  supportedProtocols: ["openai_chat_completions"],
  capabilities: { protocols: ["openai_chat_completions"], flags: ["chat", "streaming"] },
  configSchema: { type: "object", properties: { baseUrl: { type: "string", default: "https://opencode.ai" }, chatCompletionsPath: { type: "string", default: "/zen/v1/chat/completions" }, modelsPath: { type: "string", default: "/zen/v1/models" } } },
  credentialSchema: { type: "object", properties: { apiKey: { type: "string" } }, required: ["apiKey"] },
  category: "api_key_cheap",
  defaultBaseUrl: "https://opencode.ai",
};

// ============================================================================
// Phase 4: Additional providers from 9router
// ============================================================================

const glmCoding: ProviderTypeDefinition = {
  type: "glm_coding",
  displayName: "GLM Coding (z.ai)",
  adapterName: "GenericOpenAIAdapter",
  authMethods: ["api_key"],
  supportedProtocols: ["openai_chat_completions"],
  capabilities: { protocols: ["openai_chat_completions"], flags: ["chat", "streaming"] },
  configSchema: { type: "object", properties: { baseUrl: { type: "string", default: "https://open.bigmodel.cn" }, chatCompletionsPath: { type: "string", default: "/api/coding/paas/v4/chat/completions" }, modelsPath: { type: "string", default: "/api/paas/v4/models" } } },
  credentialSchema: { type: "object", properties: { apiKey: { type: "string" } }, required: ["apiKey"] },
  category: "api_key_cheap",
  defaultBaseUrl: "https://open.bigmodel.cn",
};

const minimaxAnthropic: ProviderTypeDefinition = {
  type: "minimax_anthropic",
  displayName: "MiniMax (Anthropic)",
  adapterName: "GenericOpenAIAdapter",
  authMethods: ["api_key"],
  supportedProtocols: ["openai_chat_completions"],
  capabilities: { protocols: ["openai_chat_completions"], flags: ["chat", "streaming"] },
  configSchema: { type: "object", properties: { baseUrl: { type: "string", default: "https://api.minimax.io" }, chatCompletionsPath: { type: "string", default: "/anthropic/v1/messages" }, modelsPath: { type: "string", default: "/v1/models" } } },
  credentialSchema: { type: "object", properties: { apiKey: { type: "string" } }, required: ["apiKey"] },
  category: "api_key_cheap",
  defaultBaseUrl: "https://api.minimax.io",
};

const gitlab: ProviderTypeDefinition = {
  type: "gitlab",
  displayName: "GitLab Duo",
  adapterName: "GenericOpenAIAdapter",
  authMethods: ["api_key"],
  supportedProtocols: ["openai_chat_completions"],
  capabilities: { protocols: ["openai_chat_completions"], flags: ["chat", "streaming"] },
  configSchema: { type: "object", properties: { baseUrl: { type: "string", default: "https://gitlab.com" }, chatCompletionsPath: { type: "string", default: "/api/v4/chat/completions" }, modelsPath: { type: "string", default: "/api/v4/models" } } },
  credentialSchema: { type: "object", properties: { apiKey: { type: "string" } }, required: ["apiKey"] },
  category: "api_key_premium",
  defaultBaseUrl: "https://gitlab.com",
};

const codebuddy: ProviderTypeDefinition = {
  type: "codebuddy",
  displayName: "CodeBuddy (Tencent)",
  adapterName: "GenericOpenAIAdapter",
  authMethods: ["api_key"],
  supportedProtocols: ["openai_chat_completions"],
  capabilities: { protocols: ["openai_chat_completions"], flags: ["chat", "streaming"] },
  configSchema: { type: "object", properties: { baseUrl: { type: "string", default: "https://copilot.tencent.com" }, chatCompletionsPath: { type: "string", default: "/v1/chat/completions" }, modelsPath: { type: "string", default: "/v1/models" } } },
  credentialSchema: { type: "object", properties: { apiKey: { type: "string" } }, required: ["apiKey"] },
  category: "api_key_cheap",
  defaultBaseUrl: "https://copilot.tencent.com",
};

const xiaomiMimo: ProviderTypeDefinition = {
  type: "xiaomi_mimo",
  displayName: "Xiaomi MiMo",
  adapterName: "GenericOpenAIAdapter",
  authMethods: ["api_key"],
  supportedProtocols: ["openai_chat_completions"],
  capabilities: { protocols: ["openai_chat_completions"], flags: ["chat", "streaming"] },
  configSchema: { type: "object", properties: { baseUrl: { type: "string", default: "https://api.xiaomimimo.com" }, chatCompletionsPath: { type: "string", default: "/v1/chat/completions" }, modelsPath: { type: "string", default: "/v1/models" } } },
  credentialSchema: { type: "object", properties: { apiKey: { type: "string" } }, required: ["apiKey"] },
  category: "api_key_cheap",
  defaultBaseUrl: "https://api.xiaomimimo.com",
};

const nanobanana: ProviderTypeDefinition = {
  type: "nanobanana",
  displayName: "NanoBanana",
  adapterName: "GenericOpenAIAdapter",
  authMethods: ["api_key"],
  supportedProtocols: ["openai_chat_completions"],
  capabilities: { protocols: ["openai_chat_completions"], flags: ["chat", "streaming"] },
  configSchema: { type: "object", properties: { baseUrl: { type: "string", default: "https://api.nanobananaapi.ai" }, chatCompletionsPath: { type: "string", default: "/v1/chat/completions" }, modelsPath: { type: "string", default: "/v1/models" } } },
  credentialSchema: { type: "object", properties: { apiKey: { type: "string" } }, required: ["apiKey"] },
  category: "api_key_cheap",
  defaultBaseUrl: "https://api.nanobananaapi.ai",
};

const qwen: ProviderTypeDefinition = {
  type: "qwen",
  displayName: "Qwen (Tongyi)",
  adapterName: "GenericOpenAIAdapter",
  authMethods: ["api_key", "oauth"],
  supportedProtocols: ["openai_chat_completions"],
  capabilities: { protocols: ["openai_chat_completions"], flags: ["chat", "streaming", "tool_calling"] },
  configSchema: { type: "object", properties: { baseUrl: { type: "string", default: "https://portal.qwen.ai" }, chatCompletionsPath: { type: "string", default: "/v1/chat/completions" }, modelsPath: { type: "string", default: "/v1/models" } } },
  credentialSchema: { type: "object", properties: { apiKey: { type: "string" } }, required: ["apiKey"] },
  category: "api_key_cheap",
  defaultBaseUrl: "https://portal.qwen.ai",
};

const iflow: ProviderTypeDefinition = {
  type: "iflow",
  displayName: "iFlow",
  adapterName: "GenericOpenAIAdapter",
  authMethods: ["api_key", "oauth"],
  supportedProtocols: ["openai_chat_completions"],
  capabilities: { protocols: ["openai_chat_completions"], flags: ["chat", "streaming"] },
  configSchema: { type: "object", properties: { baseUrl: { type: "string", default: "https://apis.iflow.cn" }, chatCompletionsPath: { type: "string", default: "/v1/chat/completions" }, modelsPath: { type: "string", default: "/v1/models" } } },
  credentialSchema: { type: "object", properties: { apiKey: { type: "string" } }, required: ["apiKey"] },
  category: "api_key_cheap",
  defaultBaseUrl: "https://apis.iflow.cn",
};

const qoder: ProviderTypeDefinition = {
  type: "qoder",
  displayName: "Qoder",
  adapterName: "GenericOpenAIAdapter",
  authMethods: ["api_key", "oauth"],
  supportedProtocols: ["openai_chat_completions"],
  capabilities: { protocols: ["openai_chat_completions"], flags: ["chat", "streaming"] },
  configSchema: { type: "object", properties: { baseUrl: { type: "string", default: "https://api.qoder.com" }, chatCompletionsPath: { type: "string", default: "/v1/chat/completions" }, modelsPath: { type: "string", default: "/v1/models" } } },
  credentialSchema: { type: "object", properties: { apiKey: { type: "string" } }, required: ["apiKey"] },
  category: "api_key_cheap",
  defaultBaseUrl: "https://api.qoder.com",
};

const geminiCli: ProviderTypeDefinition = {
  type: "gemini_cli",
  displayName: "Gemini CLI",
  adapterName: "GenericOpenAIAdapter",
  authMethods: ["oauth"],
  supportedProtocols: ["openai_chat_completions"],
  capabilities: { protocols: ["openai_chat_completions"], flags: ["chat", "streaming"] },
  configSchema: { type: "object", properties: { baseUrl: { type: "string", default: "https://cloudcode-pa.googleapis.com" }, chatCompletionsPath: { type: "string", default: "/v1internal/chat/completions" }, modelsPath: { type: "string", default: "/v1internal/models" } } },
  credentialSchema: { type: "object", properties: { accessToken: { type: "string" }, refreshToken: { type: "string" }, clientId: { type: "string" }, clientSecret: { type: "string" } } },
  category: "oauth_subscription",
  defaultBaseUrl: "https://cloudcode-pa.googleapis.com",
};

const grokWeb: ProviderTypeDefinition = {
  type: "grok_web",
  displayName: "Grok Web",
  adapterName: "GenericOpenAIAdapter",
  authMethods: ["custom_json"],
  supportedProtocols: ["openai_chat_completions"],
  capabilities: { protocols: ["openai_chat_completions"], flags: ["chat", "streaming"] },
  configSchema: { type: "object", properties: { baseUrl: { type: "string", default: "https://grok.com" }, chatCompletionsPath: { type: "string", default: "/rest/app-chat/conversations/new" } } },
  credentialSchema: { type: "object", properties: { cookie: { type: "string" } }, required: ["cookie"] },
  category: "custom",
  defaultBaseUrl: "https://grok.com",
};

const perplexityWeb: ProviderTypeDefinition = {
  type: "perplexity_web",
  displayName: "Perplexity Web",
  adapterName: "GenericOpenAIAdapter",
  authMethods: ["custom_json"],
  supportedProtocols: ["openai_chat_completions"],
  capabilities: { protocols: ["openai_chat_completions"], flags: ["chat", "streaming"] },
  configSchema: { type: "object", properties: { baseUrl: { type: "string", default: "https://www.perplexity.ai" }, chatCompletionsPath: { type: "string", default: "/rest/sse/perplexity_ask" } } },
  credentialSchema: { type: "object", properties: { cookie: { type: "string" } }, required: ["cookie"] },
  category: "custom",
  defaultBaseUrl: "https://www.perplexity.ai",
};

// ============================================================================
// Custom Provider
// ============================================================================

const customProvider: ProviderTypeDefinition = {
  type: "custom_openai",
  displayName: "Custom Provider",
  adapterName: "GenericOpenAIAdapter",
  authMethods: ["api_key"],
  supportedProtocols: ["openai_chat_completions"],
  capabilities: { protocols: ["openai_chat_completions"], flags: ["chat", "streaming"] },
  configSchema: {
    type: "object",
    properties: {
      baseUrl: { type: "string", description: "Custom API base URL" },
      chatCompletionsPath: { type: "string", default: "/v1/chat/completions", description: "Chat completions endpoint path" },
      modelsPath: { type: "string", default: "/v1/models", description: "Models endpoint path" },
    },
    required: ["baseUrl"],
  },
  credentialSchema: {
    type: "object",
    properties: {
      apiKey: { type: "string" },
    },
    required: ["apiKey"],
  },
  category: "custom",
};

// ============================================================================
// Provider Catalog Export
// ============================================================================

export const providerCatalog: ProviderTypeDefinition[] = [
  // API Key Premium
  openai,
  anthropic,
  xai,
  mistral,
  cohere,
  perplexity,
  nvidiaNim,
  openrouter,
  gemini,

  // API Key Cheap
  deepseek,
  groq,
  togetherAi,
  siliconflow,
  fireworks,
  cerebras,
  nebius,
  glmZhipu,
  minimax,
  kimiMoonshot,

  // Cloud Platform
  azureOpenai,
  vertexAi,

  // OAuth Subscription
  claudeCode,
  githubCopilot,
  cursor,
  codex,
  antigravity,
  kilocode,
  cline,

  // Free
  opencodeFree,

  // Phase 2: Additional providers
  alibaba,
  alibabaIntl,
  volcengineArk,
  byteplus,
  blackbox,
  vercelAiGateway,
  chutes,
  hyperbolic,

  // Phase 3: Specialized
  cloudflareAi,
  ollamaLocal,
  commandcode,
  opencodeGo,

  // Phase 4: Additional from 9router
  glmCoding,
  minimaxAnthropic,
  gitlab,
  codebuddy,
  xiaomiMimo,
  nanobanana,
  qwen,
  iflow,
  qoder,
  geminiCli,

  // Cookie-based providers (user provides session cookie)
  grokWeb,
  perplexityWeb,

  // Custom
  customProvider,
];

export default providerCatalog;
