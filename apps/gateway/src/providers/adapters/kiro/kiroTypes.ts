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

export type KiroToolDef = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

export type KiroToolResult = {
  toolUseId: string;
  content: string;
  isError?: boolean;
};

export type KiroToolUseEntry = {
  toolUseId: string;
  name: string;
  input: unknown;
};

/**
 * Generic message shape consumed by `KiroClient.buildKiroPayload`. The role
 * string is intentionally loose so OpenAI-protocol callers (chatCompletions
 * path) can keep passing "system"/"user"/"assistant"/"tool" with plain string
 * content. The Anthropic-protocol path (messages) populates `toolUses` /
 * `toolResults` to round-trip tool calling.
 */
export type KiroMessage = {
  role: string;
  content: unknown;
  name?: string;
  toolUses?: KiroToolUseEntry[];
  toolResults?: KiroToolResult[];
};

export type KiroChatRequest = {
  model: string;
  messages: KiroMessage[];
  stream: false;
  temperature?: number;
  max_tokens?: number;
  tools?: KiroToolDef[];
};

export type KiroChatResponse = {
  id?: string;
  content?: string;
  text?: string;
  model?: string;
  /** Tool-use entries collected from toolUseEvent frames (non-stream path). */
  toolUses?: KiroToolUseEntry[];
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
