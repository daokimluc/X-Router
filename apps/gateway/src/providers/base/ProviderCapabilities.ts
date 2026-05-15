export type ProviderProtocol =
  | "openai_chat_completions"
  | "anthropic_messages"
  | "custom";

export type ProviderCapabilityFlag =
  | "chat"
  | "messages"
  | "streaming"
  | "tool_calling"
  | "json_mode"
  | "image_input";

export type ProviderCapabilities = {
  protocols: ProviderProtocol[];
  flags: ProviderCapabilityFlag[];
  maxInputTokens?: number;
  maxOutputTokens?: number;
};

