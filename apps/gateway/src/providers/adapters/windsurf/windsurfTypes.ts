export type WindsurfProviderConfig = {
  baseUrl?: string;
  chatCompletionsPath?: string;
  defaultModel?: string;
};

export type DevinInfo = {
  accountDisplayName?: string;
  apiUrl?: string;
  canUseCascade?: boolean;
  canUseCli?: boolean;
  devinReviewEnabled?: boolean;
  isAdmin?: boolean;
  orgId?: string;
  webappHost?: string;
};

export type WindsurfCredentialPayload = {
  token?: string;
  accessToken?: string;
  refreshToken?: string;
  apiKey?: string;
  apiServerUrl?: string;
  email?: string;
  expiresAt?: string;
  // Devin-specific fields
  isDevin?: boolean;
  devinInfo?: DevinInfo;
  teamId?: string;
};

export type WindsurfChatRequest = {
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

export type WindsurfChatResponse = {
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

export type WindsurfCascadeModelConfig = {
  label?: string;
  modelUid?: string;
  provider?: string;
  maxTokens?: number;
  supportsImages?: boolean;
  isRecommended?: boolean;
  isNew?: boolean;
};

export type WindsurfCascadeModelConfigResponse = {
  clientModelConfigs?: WindsurfCascadeModelConfig[];
};
