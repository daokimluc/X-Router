export type KiroProviderConfig = {
  baseUrl?: string;
  chatCompletionsPath?: string;
  region?: string;
  defaultModel?: string;
};

export type KiroAuthMethod = "social" | "idc";

export type KiroCredentialPayload = {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: string;
  region?: string;
  authRegion?: string;
  apiRegion?: string;
  profileArn?: string;
  clientId?: string;
  clientSecret?: string;
  code?: string;
  codeVerifier?: string;
  codeChallenge?: string;
  redirectUri?: string;
  tokenType?: string;
  authMethod?: KiroAuthMethod;
  machineId?: string;
  suspendedAt?: string;
  suspensionReason?: string;
};

export type KiroChatRequest = {
  model: string;
  messages: Array<{
    role: string;
    content: unknown;
    name?: string;
  }>;
  stream: false;
  temperature?: number;
  max_tokens?: number;
};

export type KiroChatResponse = {
  id?: string;
  content?: string;
  text?: string;
  model?: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  choices?: Array<{
    index?: number;
    message?: {
      role?: string;
      content?: string;
    };
    finish_reason?: "stop" | "length" | "tool_calls" | "content_filter" | null;
  }>;
};

export type KiroContextUsageEvent = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
};
