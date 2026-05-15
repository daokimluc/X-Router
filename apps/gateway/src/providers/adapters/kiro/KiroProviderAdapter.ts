import type { AIProviderAdapter } from "../../base/AIProviderAdapter.js";
import type { ProviderAccount } from "../../base/ProviderAccount.js";
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
  ProviderStream,
  SessionRefreshResult
} from "../../base/types.js";
import { applyKiroToken, KiroAuthClient, shouldRefreshKiroCredential } from "./KiroAuthClient.js";
import { KiroClient } from "./KiroClient.js";
import { KiroSessionManager } from "./KiroSessionManager.js";
import type { KiroChatResponse, KiroCredentialPayload, KiroProviderConfig } from "./kiroTypes.js";

export class KiroProviderAdapter implements AIProviderAdapter {
  readonly type = "kiro";

  constructor(
    private readonly client = new KiroClient(),
    private readonly authClient = new KiroAuthClient()
  ) {}

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
      throw new ProviderConfigError("Kiro config baseUrl must be a string");
    }

    if (config.chatCompletionsPath && typeof config.chatCompletionsPath !== "string") {
      throw new ProviderConfigError("Kiro config chatCompletionsPath must be a string");
    }
  }

  async validateCredential(payload: Record<string, unknown>): Promise<void> {
    if (payload.accessToken && typeof payload.accessToken !== "string") {
      throw new ProviderConfigError("Kiro credential accessToken must be a string");
    }

    if (payload.refreshToken && typeof payload.refreshToken !== "string") {
      throw new ProviderConfigError("Kiro credential refreshToken must be a string");
    }

    if (!payload.accessToken && !payload.refreshToken) {
      throw new ProviderConfigError(
        "Kiro credential must include accessToken or refreshToken"
      );
    }
  }

  async listModels(_context: ProviderContext): Promise<ProviderModel[]> {
    return [
      {
        id: "kiro-sonnet",
        displayName: "Kiro Sonnet",
        upstreamModel: "claude-sonnet-4.5",
        capabilities: ["chat"]
      }
    ];
  }

  async chatCompletions(
    request: OpenAIChatCompletionRequest,
    context: ProviderRequestContext
  ): Promise<NormalizedOpenAIResponse | ProviderStream> {
    const config = context.providerInstance.config as KiroProviderConfig;
    const credential = await this.resolveCredential(
      (context.credentialPayload ?? {}) as KiroCredentialPayload
    );

    if (request.stream) {
      const upstreamModel = resolveKiroModel(config, request.model);
      return this.client.streamChatCompletions({
        config,
        credential,
        request: {
          model: upstreamModel,
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

    const upstreamModel = resolveKiroModel(config, request.model);
    const upstreamResponse = await this.client.chatCompletions({
      config,
      credential,
      request: {
        model: upstreamModel,
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

    return normalizeKiroOpenAIResponse(upstreamResponse, request.model);
  }

  async messages(
    _request: AnthropicMessagesRequest,
    _context: ProviderRequestContext
  ): Promise<NormalizedAnthropicResponse | ProviderStream> {
    throw new UnsupportedCapabilityError(
      "Kiro Anthropic messages API is implemented in a later phase"
    );
  }

  async healthCheck(_context: ProviderContext): Promise<ProviderHealth> {
    return {
      status: "ok"
    };
  }

  async refreshSession(
    account: ProviderAccount,
    context: ProviderContext
  ): Promise<SessionRefreshResult> {
    return new KiroSessionManager().refreshSession(account, context);
  }

  private async resolveCredential(
    credential: KiroCredentialPayload
  ): Promise<KiroCredentialPayload> {
    if (credential.accessToken && !shouldRefreshKiroCredential(credential)) {
      return credential;
    }

    if (credential.refreshToken) {
      const token = await this.authClient.refreshToken(credential);
      return applyKiroToken(credential, token);
    }

    if (credential.code && credential.codeVerifier) {
      const token = await this.authClient.exchangeAuthorizationCode({
        code: credential.code,
        codeVerifier: credential.codeVerifier,
        redirectUri: credential.redirectUri,
        region: credential.region
      });
      return applyKiroToken(credential, token);
    }

    return credential;
  }
}

function resolveKiroModel(config: KiroProviderConfig, requestedModel: string): string {
  const configuredModel = config.defaultModel?.trim();
  const model = configuredModel && configuredModel !== "sonnet" ? configuredModel : requestedModel;

  if (model === "sonnet" || model === "kiro-sonnet") {
    return "claude-sonnet-4.5";
  }

  return model;
}

function normalizeKiroOpenAIResponse(
  response: KiroChatResponse,
  requestedModel: string
): NormalizedOpenAIResponse {
  if (response.choices?.length) {
    return {
      id: response.id ?? "chatcmpl_kiro",
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
    id: response.id ?? "chatcmpl_kiro",
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
  usage: KiroChatResponse["usage"]
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
