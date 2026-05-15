import type { ProviderCapabilities } from "./ProviderCapabilities.js";
import type { ProviderAccount } from "./ProviderAccount.js";
import type {
  AnthropicMessagesRequest,
  NormalizedAnthropicResponse,
  NormalizedOpenAIResponse,
  OpenAIChatCompletionRequest,
  ProviderContext,
  ProviderHealth,
  ProviderModel,
  ProviderRequestContext,
  ProviderStream,
  SessionRefreshResult
} from "./types.js";

export type AIProviderAdapter = {
  type: string;

  getCapabilities(): ProviderCapabilities;

  validateConfig(config: Record<string, unknown>): Promise<void>;

  validateCredential(payload: Record<string, unknown>): Promise<void>;

  listModels(context: ProviderContext): Promise<ProviderModel[]>;

  chatCompletions(
    request: OpenAIChatCompletionRequest,
    context: ProviderRequestContext
  ): Promise<NormalizedOpenAIResponse | ProviderStream>;

  messages(
    request: AnthropicMessagesRequest,
    context: ProviderRequestContext
  ): Promise<NormalizedAnthropicResponse | ProviderStream>;

  healthCheck(context: ProviderContext): Promise<ProviderHealth>;

  refreshSession?(
    account: ProviderAccount,
    context: ProviderContext
  ): Promise<SessionRefreshResult>;
};

