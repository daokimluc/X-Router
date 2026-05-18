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
      baseUrl: { type: "string", default: "https://api.cohere.com" },
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
    tokenEndpoint: "https://claude.ai/oauth/token",
    clientId: "claude-code-client",
    scope: "openid profile",
    redirectUri: "/oauth/callback",
  },
};

const githubCopilot: ProviderTypeDefinition = {
  type: "github_copilot",
  displayName: "GitHub Copilot",
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
    authorizationEndpoint: "https://github.com/login/oauth/authorize",
    tokenEndpoint: "https://github.com/login/oauth/access_token",
    clientId: "github-copilot-client",
    scope: "copilot",
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
    authorizationEndpoint: "https://cursor.com/oauth/authorize",
    tokenEndpoint: "https://cursor.com/oauth/token",
    clientId: "cursor-client",
    scope: "openid",
    redirectUri: "/oauth/callback",
  },
};

const codex: ProviderTypeDefinition = {
  type: "codex",
  displayName: "Codex",
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
    authorizationEndpoint: "https://auth.openai.com/authorize",
    tokenEndpoint: "https://auth.openai.com/oauth/token",
    clientId: "codex-client",
    scope: "openid profile",
    redirectUri: "/oauth/callback",
  },
};

const antigravity: ProviderTypeDefinition = {
  type: "antigravity",
  displayName: "Antigravity",
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
    authorizationEndpoint: "https://antigravity.dev/oauth/authorize",
    tokenEndpoint: "https://antigravity.dev/oauth/token",
    clientId: "antigravity-client",
    scope: "openid",
    redirectUri: "/oauth/callback",
  },
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

  // Free
  opencodeFree,

  // Custom
  customProvider,
];

export default providerCatalog;
