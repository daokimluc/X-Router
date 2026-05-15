import type { AIProviderAdapter } from "../../base/AIProviderAdapter.js";
import { UnsupportedCapabilityError } from "../../base/ProviderErrors.js";
import type { ProviderCapabilities } from "../../base/ProviderCapabilities.js";
import type {
  AnthropicMessagesRequest,
  NormalizedAnthropicResponse,
  NormalizedOpenAIResponse,
  OpenAIChatCompletionRequest,
  ProviderContext,
  ProviderHealth,
  ProviderModel,
  ProviderRequestContext
} from "../../base/types.js";

export class MockProviderAdapter implements AIProviderAdapter {
  readonly type = "mock";

  getCapabilities(): ProviderCapabilities {
    return {
      protocols: ["openai_chat_completions", "anthropic_messages"],
      flags: ["chat", "messages", "streaming"],
      maxInputTokens: 200000,
      maxOutputTokens: 8192
    };
  }

  async validateConfig(config: Record<string, unknown>): Promise<void> {
    if (config.mode && typeof config.mode !== "string") {
      throw new Error("mock provider config mode must be a string");
    }
  }

  async validateCredential(payload: Record<string, unknown>): Promise<void> {
    if (payload.apiKey && typeof payload.apiKey !== "string") {
      throw new Error("mock provider credential apiKey must be a string");
    }
  }

  async listModels(_context: ProviderContext): Promise<ProviderModel[]> {
    return [
      {
        id: "mock-fast",
        displayName: "Mock Fast",
        upstreamModel: "mock-fast",
        capabilities: ["chat", "messages"]
      },
      {
        id: "mock-stream",
        displayName: "Mock Stream",
        upstreamModel: "mock-stream",
        capabilities: ["chat", "messages", "streaming"]
      }
    ];
  }

  async chatCompletions(
    request: OpenAIChatCompletionRequest,
    _context: ProviderRequestContext
  ): Promise<NormalizedOpenAIResponse> {
    return {
      id: "chatcmpl_mock",
      object: "chat.completion",
      created: 0,
      model: request.model,
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: "mock response"
          },
          finish_reason: "stop"
        }
      ],
      usage: {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0
      }
    };
  }

  async messages(
    request: AnthropicMessagesRequest,
    _context: ProviderRequestContext
  ): Promise<NormalizedAnthropicResponse> {
    return {
      id: "msg_mock",
      type: "message",
      role: "assistant",
      model: request.model,
      content: [
        {
          type: "text",
          text: "mock response"
        }
      ],
      stop_reason: "end_turn",
      usage: {
        input_tokens: 0,
        output_tokens: 0
      }
    };
  }

  async healthCheck(_context: ProviderContext): Promise<ProviderHealth> {
    return {
      status: "ok"
    };
  }

  async unsupportedCapability(): Promise<never> {
    throw new UnsupportedCapabilityError("Mock unsupported capability");
  }
}

