import type { AIProviderAdapter } from "../../base/AIProviderAdapter.js";
import type { ProviderCapabilities } from "../../base/ProviderCapabilities.js";
import { ProviderConfigError, UnsupportedCapabilityError } from "../../base/ProviderErrors.js";
import type {
  AnthropicMessagesRequest,
  NormalizedAnthropicResponse,
  NormalizedOpenAIResponse,
  OpenAIChatCompletionRequest,
  ProviderContext,
  ProviderHealth,
  ProviderModel,
  ProviderRequestContext,
  ProviderStream
} from "../../base/types.js";
import { WindsurfClient } from "./WindsurfClient.js";
import type {
  WindsurfChatResponse,
  WindsurfCredentialPayload,
  WindsurfProviderConfig
} from "./windsurfTypes.js";

export class WindsurfProviderAdapter implements AIProviderAdapter {
  readonly type = "windsurf";

  constructor(private readonly client = new WindsurfClient()) {}

  getCapabilities(): ProviderCapabilities {
    return {
      protocols: ["openai_chat_completions"],
      flags: ["chat", "streaming"],
      maxInputTokens: 200000,
      maxOutputTokens: 8192
    };
  }

  async validateConfig(config: Record<string, unknown>): Promise<void> {
    if (config.baseUrl && typeof config.baseUrl !== "string") {
      throw new ProviderConfigError("Windsurf config baseUrl must be a string");
    }

    if (config.chatCompletionsPath && typeof config.chatCompletionsPath !== "string") {
      throw new ProviderConfigError(
        "Windsurf config chatCompletionsPath must be a string"
      );
    }
  }

  async validateCredential(payload: Record<string, unknown>): Promise<void> {
    if (payload.token && typeof payload.token !== "string") {
      throw new ProviderConfigError("Windsurf credential token must be a string");
    }

    if (payload.accessToken && typeof payload.accessToken !== "string") {
      throw new ProviderConfigError(
        "Windsurf credential accessToken must be a string"
      );
    }

    if (!payload.token && !payload.accessToken && !payload.refreshToken) {
      throw new ProviderConfigError(
        "Windsurf credential must include token, accessToken or refreshToken"
      );
    }
  }

  async listModels(_context: ProviderContext): Promise<ProviderModel[]> {
    return [
      {
        id: "windsurf-sonnet",
        displayName: "Windsurf Sonnet",
        upstreamModel: "claude-sonnet-4-6-thinking",
        capabilities: ["chat"]
      }
    ];
  }

  async chatCompletions(
    request: OpenAIChatCompletionRequest,
    context: ProviderRequestContext
  ): Promise<NormalizedOpenAIResponse | ProviderStream> {
    const config = context.providerInstance.config as WindsurfProviderConfig;
    const credential = (context.credentialPayload ?? {}) as WindsurfCredentialPayload;

    if (request.stream) {
      return this.client.streamChatCompletions({
        config,
        credential,
        request: {
          model: config.defaultModel ?? request.model,
          messages: request.messages.map((message) => ({
            role: message.role,
            content: message.content,
            name: message.name
          })),
          stream: false,
          temperature: request.temperature,
          max_tokens: request.max_tokens
        },
        requestId: context.requestId,
        timeoutMs: context.providerInstance.defaultTimeoutMs
      });
    }

    const upstreamResponse = await this.client.chatCompletions({
      config,
      credential,
      request: {
        model: config.defaultModel ?? request.model,
        messages: request.messages.map((message) => ({
          role: message.role,
          content: message.content,
          name: message.name
        })),
        stream: false,
        temperature: request.temperature,
        max_tokens: request.max_tokens
      },
      requestId: context.requestId,
      timeoutMs: context.providerInstance.defaultTimeoutMs
    });

    return normalizeWindsurfOpenAIResponse(upstreamResponse, request.model);
  }

  async messages(
    _request: AnthropicMessagesRequest,
    _context: ProviderRequestContext
  ): Promise<NormalizedAnthropicResponse | ProviderStream> {
    throw new UnsupportedCapabilityError(
      "Windsurf Anthropic messages API is implemented in a later phase"
    );
  }

  async healthCheck(_context: ProviderContext): Promise<ProviderHealth> {
    return {
      status: "ok"
    };
  }
}

function normalizeWindsurfOpenAIResponse(
  response: WindsurfChatResponse,
  requestedModel: string
): NormalizedOpenAIResponse {
  if (response.choices?.length) {
    return {
      id: response.id ?? "chatcmpl_windsurf",
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: requestedModel,
      choices: response.choices.map((choice, index) => ({
        index: choice.index ?? index,
        message: {
          role: "assistant",
          content: choice.message?.content ?? ""
        },
        finish_reason: choice.finish_reason ?? "stop"
      })),
      usage: normalizeUsage(response.usage)
    };
  }

  return {
    id: response.id ?? "chatcmpl_windsurf",
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: requestedModel,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: response.content ?? response.text ?? ""
        },
        finish_reason: "stop"
      }
    ],
    usage: normalizeUsage(response.usage)
  };
}

function normalizeUsage(
  usage: WindsurfChatResponse["usage"]
): NormalizedOpenAIResponse["usage"] {
  if (!usage) {
    return {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0
    };
  }

  const promptTokens = usage.prompt_tokens ?? 0;
  const completionTokens = usage.completion_tokens ?? 0;

  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: usage.total_tokens ?? promptTokens + completionTokens
  };
}
