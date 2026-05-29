import { createHash, randomUUID } from "node:crypto";
import { ProviderError } from "../../base/ProviderErrors.js";
import type { ProviderStream, ProviderStreamEvent } from "../../base/types.js";
import type { ProviderInstance } from "../../base/ProviderInstance.js";
import { applyChannelOverrides, interpretStatusCode } from "../../../utils/channelOverride.js";
import type { ProxyFetchOptions } from "../../../proxy/types.js";
import { proxyAwareFetch } from "../../../proxy/ProxyAwareFetch.js";
import type { KiroChatRequest, KiroChatResponse, KiroCredentialPayload, KiroMessage, KiroProviderConfig, KiroToolDef, KiroToolResult, KiroToolUseEntry } from "./kiroTypes.js";

export type KiroClientFetch = typeof fetch;

export class KiroClient {
  constructor(private readonly fetchImpl: KiroClientFetch = fetch) {}

  async chatCompletions(options: {
    config: KiroProviderConfig;
    credential: KiroCredentialPayload;
    request: KiroChatRequest;
    requestId: string;
    timeoutMs: number;
    instance?: ProviderInstance;
    proxyOptions?: ProxyFetchOptions;
  }): Promise<KiroChatResponse> {
    const accessToken = options.credential.accessToken;

    if (!accessToken) {
      throw new ProviderError({
        code: "provider_auth_error",
        message: "Kiro access token is missing",
        retryable: false,
        statusCode: 401
      });
    }

    const endpoints = options.config.baseUrl
      ? [options.config.baseUrl]
      : resolveKiroApiUrls(options.credential.apiRegion ?? options.credential.region);
    const path = options.config.chatCompletionsPath ?? "";
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), options.timeoutMs);

    try {
      const baseHeaders = buildKiroHeaders(accessToken, options.credential, options.requestId);
      // Phase 24 — header-only overrides for Kiro (AWS event-stream body has fixed shape)
      const headers = options.instance
        ? applyChannelOverrides({}, baseHeaders, options.instance).headers
        : baseHeaders;
      const requestBody = JSON.stringify(buildKiroPayload(options.request, options.credential));

      if (options.proxyOptions?.enabled) {
        const url = new URL(path, endpoints[0]);
        const proxyResult = await proxyAwareFetch({
          url: url.toString(),
          method: "POST",
          headers,
          body: Buffer.from(requestBody),
          signal: abortController.signal,
          proxyOptions: options.proxyOptions
        });
        if (proxyResult.statusCode >= 400) {
          const body = proxyResult.body.toString("utf-8");
          throw classifyKiroHttpErrorFromRaw(proxyResult.statusCode, body, options.instance);
        }
        const contentType = (proxyResult.headers["content-type"] ?? "") as string;
        if (contentType.includes("application/json") && options.config.baseUrl?.includes("kiro.test")) {
          return JSON.parse(proxyResult.body.toString("utf-8")) as KiroChatResponse;
        }
        return parseKiroResponseFromBuffer(proxyResult.body, options.request.model);
      }

      let lastError: ProviderError | undefined;
      for (const endpoint of endpoints) {
        const url = new URL(path, endpoint);
        const response = await this.fetchImpl(url, {
          method: "POST",
          headers,
          body: requestBody,
          signal: abortController.signal
        });

        if (!response.ok) {
          const error = await classifyKiroHttpError(response, options.instance);
          // Retry on 400 (profileArn issues) or 403 (endpoint mismatch) with next endpoint
          if ((response.status === 400 || response.status === 403) && endpoint !== endpoints[endpoints.length - 1]) {
            lastError = error;
            continue;
          }
          throw error;
        }

        if (shouldParseJsonResponse(response, options.config)) {
          return (await response.json()) as KiroChatResponse;
        }

        return await parseKiroResponse(response, options.request.model);
      }

      throw lastError ?? new ProviderError({
        code: "provider_unavailable",
        message: "All Kiro endpoints failed",
        retryable: true,
        statusCode: 502
      });
    } catch (error) {
      if (error instanceof ProviderError) {
        throw error;
      }

      if (error instanceof Error && error.name === "AbortError") {
        throw new ProviderError({
          code: "provider_timeout",
          message: "Kiro request timed out",
          retryable: true,
          statusCode: 504
        });
      }

      throw new ProviderError({
        code: "provider_network_error",
        message: `Kiro network request failed${error instanceof Error ? `: ${error.message}` : ""}`,
        retryable: true,
        statusCode: 502
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  async streamChatCompletions(options: {
    config: KiroProviderConfig;
    credential: KiroCredentialPayload;
    request: KiroChatRequest;
    requestId: string;
    timeoutMs: number;
    instance?: ProviderInstance;
    proxyOptions?: ProxyFetchOptions;
  }): Promise<ProviderStream> {
    const accessToken = options.credential.accessToken;

    if (!accessToken) {
      throw new ProviderError({
        code: "provider_auth_error",
        message: "Kiro access token is missing",
        retryable: false,
        statusCode: 401
      });
    }

    const endpoints = options.config.baseUrl
      ? [options.config.baseUrl]
      : resolveKiroApiUrls(options.credential.apiRegion ?? options.credential.region);
    const path = options.config.chatCompletionsPath ?? "";
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), options.timeoutMs);

    try {
      const baseHeaders = buildKiroHeaders(accessToken, options.credential, options.requestId);
      const headers = options.instance
        ? applyChannelOverrides({}, baseHeaders, options.instance).headers
        : baseHeaders;
      const requestBody = JSON.stringify(buildKiroPayload(options.request, options.credential));

      let lastError: ProviderError | undefined;
      for (const endpoint of endpoints) {
        const url = new URL(path, endpoint);
        const response = await this.fetchImpl(url, {
          method: "POST",
          headers,
          body: requestBody,
          signal: abortController.signal
        });

        if (!response.ok) {
          const error = await classifyKiroHttpError(response, options.instance);
          if ((response.status === 400 || response.status === 403) && endpoint !== endpoints[endpoints.length - 1]) {
            lastError = error;
            continue;
          }
          throw error;
        }

        if (!response.body) {
          throw new ProviderError({
            code: "provider_bad_response",
            message: "Kiro returned an empty stream",
            retryable: true,
            statusCode: 502
          });
        }

        if (shouldUsePlainTextStream(response, options.config)) {
          return plainTextStream(response.body, () => clearTimeout(timeout));
        }

        return kiroEventStream(response.body, () => clearTimeout(timeout));
      }

      throw lastError ?? new ProviderError({
        code: "provider_unavailable",
        message: "All Kiro endpoints failed",
        retryable: true,
        statusCode: 502
      });
    } catch (error) {
      clearTimeout(timeout);

      if (error instanceof ProviderError) {
        throw error;
      }

      if (error instanceof Error && error.name === "AbortError") {
        throw new ProviderError({
          code: "provider_timeout",
          message: "Kiro request timed out",
          retryable: true,
          statusCode: 504
        });
      }

      throw new ProviderError({
        code: "provider_network_error",
        message: `Kiro network request failed${error instanceof Error ? `: ${error.message}` : ""}`,
        retryable: true,
        statusCode: 502
      });
    }
  }
}

function kiroEventStream(
  stream: ReadableStream<Uint8Array>,
  onDone: () => void
): ProviderStream {
  let captured: { inputTokens: number; outputTokens: number } | null = null;
  let consumed = false;

  // Shared frame iterator that both wrappers (text and events) drain — but
  // only one wrapper may be consumed per stream (the source can't be teed
  // safely without buffering arbitrary data). Routes are expected to pick one.
  async function* frames(): AsyncGenerator<{ eventType: string; payload: unknown }> {
    if (consumed) {
      throw new Error("ProviderStream already consumed");
    }
    consumed = true;
    const reader = stream.getReader();
    let buffer: Uint8Array<ArrayBufferLike> = new Uint8Array();
    try {
      while (true) {
        const result = await reader.read();
        if (result.done) break;
        buffer = appendBytes(buffer, result.value);
        for (const event of readCompleteEvents(buffer)) {
          buffer = event.remaining;
          const frame = parseEventFrame(event.frame);
          if (!frame) continue;
          const eventType = frame.headers[":event-type"] ?? "";
          const eventUsage = extractKiroUsage(eventType, frame.payload);
          if (eventUsage) captured = eventUsage;
          yield { eventType, payload: frame.payload };
        }
      }
    } finally {
      onDone();
      reader.releaseLock();
    }
  }

  async function* textIter(): AsyncGenerator<string> {
    for await (const f of frames()) {
      const content = getKiroEventContent(f.eventType, f.payload);
      if (content) yield content;
    }
  }

  async function* eventIter(): AsyncGenerator<ProviderStreamEvent> {
    /**
     * Tracks the in-flight tool_use block so we can emit a single
     * tool_use_start (on first frame for that toolUseId) followed by
     * tool_use_delta frames carrying partial JSON, then a tool_use_stop
     * when `stop:true` arrives or a different tool_use begins.
     */
    let activeToolUseId: string | null = null;
    let stopReason: "end_turn" | "max_tokens" | "stop_sequence" | "tool_use" = "end_turn";

    function closeActiveTool(): ProviderStreamEvent | null {
      if (activeToolUseId === null) return null;
      const id = activeToolUseId;
      activeToolUseId = null;
      return { type: "tool_use_stop", id };
    }

    for await (const f of frames()) {
      if (f.eventType === "assistantResponseEvent" || f.eventType === "codeEvent") {
        const close = closeActiveTool();
        if (close) yield close;
        const text = getKiroEventContent(f.eventType, f.payload);
        if (text) yield { type: "text_delta", text };
        continue;
      }
      if (f.eventType === "toolUseEvent" && f.payload && typeof f.payload === "object") {
        const p = f.payload as { name?: string; toolUseId?: string; input?: string; stop?: boolean };
        const id = typeof p.toolUseId === "string" ? p.toolUseId : "";
        const name = typeof p.name === "string" ? p.name : "";
        if (!id) continue;

        if (activeToolUseId !== null && activeToolUseId !== id) {
          const close = closeActiveTool();
          if (close) yield close;
        }
        if (activeToolUseId === null) {
          activeToolUseId = id;
          yield { type: "tool_use_start", id, name };
          stopReason = "tool_use";
        }
        if (typeof p.input === "string" && p.input.length > 0) {
          yield { type: "tool_use_delta", id, partial_json: p.input };
        }
        if (p.stop === true) {
          const close = closeActiveTool();
          if (close) yield close;
        }
        continue;
      }
      // contextUsageEvent and others: capture usage already handled in frames(); ignore here
    }

    const close = closeActiveTool();
    if (close) yield close;
    yield { type: "message_stop", stop_reason: stopReason };
  }

  return {
    [Symbol.asyncIterator]: () => textIter(),
    usage: () => {
      if (!captured) return undefined;
      return {
        prompt_tokens: captured.inputTokens,
        completion_tokens: captured.outputTokens,
        total_tokens: captured.inputTokens + captured.outputTokens
      };
    },
    events: () => ({
      [Symbol.asyncIterator]: () => eventIter()
    })
  };
}

async function* plainTextStream(
  stream: ReadableStream<Uint8Array>,
  onDone: () => void
): ProviderStream {
  const reader = stream.getReader();
  const decoder = new TextDecoder();

  try {
    while (true) {
      const result = await reader.read();

      if (result.done) {
        break;
      }

      const chunk = decoder.decode(result.value, {
        stream: true
      });

      if (chunk) {
        yield chunk;
      }
    }

    const final = decoder.decode();

    if (final) {
      yield final;
    }
  } finally {
    onDone();
    reader.releaseLock();
  }
}

async function classifyKiroHttpError(response: Response, instance?: ProviderInstance): Promise<ProviderError> {
  const statusCode = response.status;
  const body = await safeResponseText(response);
  return classifyKiroHttpErrorFromRaw(statusCode, body, instance);
}

type SuspensionSignal = { reason: string };

const SUSPENSION_PATTERNS = [
  "temporarily_suspended",
  "TEMPORARILY_SUSPENDED",
  "AccountSuspendedException",
  "User ID is suspended",
  "account has been suspended",
  "access has been revoked"
];

export function detectKiroSuspension(
  statusCode: number,
  body: string
): SuspensionSignal | null {
  if (statusCode === 423) {
    return { reason: "Account locked (HTTP 423)" };
  }

  if (statusCode === 403) {
    for (const pattern of SUSPENSION_PATTERNS) {
      if (body.includes(pattern)) {
        return { reason: pattern };
      }
    }
  }

  if (statusCode >= 400 && statusCode < 500) {
    for (const pattern of SUSPENSION_PATTERNS) {
      if (body.includes(pattern)) {
        return { reason: pattern };
      }
    }
  }

  return null;
}

function buildKiroPayload(request: KiroChatRequest, credential: KiroCredentialPayload): Record<string, unknown> {
  const { history, currentMessage } = convertMessages(request.messages, request.model);
  const finalContent = `[Context: Current time is ${new Date().toISOString()}]\n\n${currentMessage.content}`;

  const userInputMessageContext: Record<string, unknown> = {};
  if (request.tools && request.tools.length > 0) {
    userInputMessageContext.tools = request.tools.map((tool) => ({
      toolSpecification: {
        name: tool.name,
        description: tool.description,
        inputSchema: { json: tool.inputSchema }
      }
    }));
  }
  if (currentMessage.toolResults && currentMessage.toolResults.length > 0) {
    userInputMessageContext.toolResults = currentMessage.toolResults.map((r) => ({
      toolUseId: r.toolUseId,
      content: [{ text: r.content }],
      status: r.isError ? "error" : "success",
      ...(r.isError ? { isError: true } : {})
    }));
  }

  const userInputMessage: Record<string, unknown> = {
    content: finalContent,
    modelId: request.model,
    origin: "AI_EDITOR"
  };
  if (Object.keys(userInputMessageContext).length > 0) {
    userInputMessage.userInputMessageContext = userInputMessageContext;
  }

  const payload: Record<string, unknown> = {
    conversationState: {
      chatTriggerType: "MANUAL",
      conversationId: randomUUID(),
      currentMessage: { userInputMessage },
      history
    },
    inferenceConfig: {
      maxTokens: request.max_tokens ?? 32000,
      ...(request.temperature === undefined ? {} : { temperature: request.temperature })
    }
  };

  // API Key credentials don't use profileArn — sending it causes auth rejection
  const raw = credential as Record<string, unknown>;
  const isApiKey =
    (credential.authMethod as string) === "api_key" ||
    !!raw.kiroApiKey ||
    (typeof raw.apiKey === "string" && (raw.apiKey as string).startsWith("ksk_"));
  if (!isApiKey) {
    payload.profileArn = resolveKiroProfileArn(credential);
  }

  payload.machineId = resolveKiroMachineId(credential);

  return payload;
}

type ConvertedCurrent = {
  content: string;
  toolResults?: KiroToolResult[];
};

function convertMessages(
  messages: KiroMessage[],
  model: string
): {
  history: Array<Record<string, unknown>>;
  currentMessage: ConvertedCurrent;
} {
  const history: Array<Record<string, unknown>> = [];
  let currentMessage: ConvertedCurrent | undefined;

  for (const message of messages) {
    if (message.role === "assistant") {
      const content = stringifyMessageContent(message.content);
      const tool_uses = message.toolUses;
      const assistantResponseMessage: Record<string, unknown> = {
        content
      };
      if (tool_uses && tool_uses.length > 0) {
        assistantResponseMessage.toolUses = tool_uses.map((t) => ({
          toolUseId: t.toolUseId,
          name: t.name,
          input: t.input ?? {}
        }));
      }
      history.push({ assistantResponseMessage });
      continue;
    }

    // user / system / tool — always pushed as userInputMessage in history
    const isSystem = message.role === "system";
    const rawContent = stringifyMessageContent(message.content);
    const content = isSystem ? `System: ${rawContent}` : rawContent;
    const userMsg: Record<string, unknown> = {
      content,
      modelId: model
    };

    if (message.toolResults && message.toolResults.length > 0) {
      userMsg.userInputMessageContext = {
        toolResults: message.toolResults.map((r) => ({
          toolUseId: r.toolUseId,
          content: [{ text: r.content }],
          status: r.isError ? "error" : "success",
          ...(r.isError ? { isError: true } : {})
        }))
      };
    }

    history.push({ userInputMessage: userMsg });
    currentMessage = {
      content,
      toolResults: message.toolResults
    };
  }

  if (!currentMessage) {
    currentMessage = { content: "continue" };
  } else {
    // Promote the last user/system entry out of history into currentMessage
    for (let index = history.length - 1; index >= 0; index -= 1) {
      if ("userInputMessage" in history[index]) {
        history.splice(index, 1);
        break;
      }
    }
  }

  return {
    history,
    currentMessage
  };
}

function stringifyMessageContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }

        if (part && typeof part === "object" && "text" in part) {
          const text = (part as { text?: unknown }).text;
          return typeof text === "string" ? text : "";
        }

        if (part && typeof part === "object" && "image_url" in part) {
          return "[Image omitted by gateway]";
        }

        return "";
      })
      .filter(Boolean)
      .join("\n");
  }

  return "";
}

async function parseKiroResponse(response: Response, model: string): Promise<KiroChatResponse> {
  const bytes = new Uint8Array(await response.arrayBuffer());
  return parseKiroResponseFromBuffer(Buffer.from(bytes), model);
}

function parseEventFrame(data: Uint8Array<ArrayBufferLike>): {
  headers: Record<string, string>;
  payload: unknown;
} | null {
  try {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const headersLength = view.getUint32(4, false);
    const headers: Record<string, string> = {};
    let offset = 12;
    const headerEnd = 12 + headersLength;
    const decoder = new TextDecoder();

    while (offset < headerEnd && offset < data.byteLength) {
      const nameLength = data[offset];
      offset += 1;

      if (offset + nameLength > data.byteLength) {
        break;
      }

      const name = decoder.decode(data.slice(offset, offset + nameLength));
      offset += nameLength;
      const headerType = data[offset];
      offset += 1;

      if (headerType !== 7) {
        break;
      }

      const valueLength = (data[offset] << 8) | data[offset + 1];
      offset += 2;

      if (offset + valueLength > data.byteLength) {
        break;
      }

      headers[name] = decoder.decode(data.slice(offset, offset + valueLength));
      offset += valueLength;
    }

    const payloadStart = 12 + headersLength;
    const payloadEnd = data.byteLength - 4;
    const payloadText =
      payloadEnd > payloadStart ? decoder.decode(data.slice(payloadStart, payloadEnd)) : "";

    return {
      headers,
      payload: payloadText.trim() ? JSON.parse(payloadText) : null
    };
  } catch {
    return null;
  }
}

function getKiroEventContent(eventType: string, payload: unknown): string {
  if (
    (eventType === "assistantResponseEvent" || eventType === "codeEvent") &&
    payload &&
    typeof payload === "object" &&
    "content" in payload
  ) {
    const content = (payload as { content?: unknown }).content;
    return typeof content === "string" ? content : "";
  }

  return "";
}

function extractKiroUsage(
  eventType: string,
  payload: unknown
): { inputTokens: number; outputTokens: number } | null {
  if (eventType !== "contextUsageEvent" || !payload || typeof payload !== "object") {
    return null;
  }

  const p = payload as Record<string, unknown>;
  const usage = (p.contextUsage ?? p) as Record<string, unknown>;
  const inputTokens =
    typeof usage.inputTokens === "number" ? usage.inputTokens :
    typeof usage.input_tokens === "number" ? usage.input_tokens : 0;
  const outputTokens =
    typeof usage.outputTokens === "number" ? usage.outputTokens :
    typeof usage.output_tokens === "number" ? usage.output_tokens : 0;

  if (inputTokens === 0 && outputTokens === 0) return null;
  return { inputTokens, outputTokens };
}

function readCompleteEvents(
  buffer: Uint8Array<ArrayBufferLike>
): Array<{ frame: Uint8Array<ArrayBufferLike>; remaining: Uint8Array<ArrayBufferLike> }> {
  const events: Array<{
    frame: Uint8Array<ArrayBufferLike>;
    remaining: Uint8Array<ArrayBufferLike>;
  }> = [];
  let working = buffer;

  while (working.byteLength >= 16) {
    const view = new DataView(working.buffer, working.byteOffset, working.byteLength);
    const totalLength = view.getUint32(0, false);

    if (totalLength < 16 || working.byteLength < totalLength) {
      break;
    }

    const frame = working.slice(0, totalLength);
    working = working.slice(totalLength);
    events.push({
      frame,
      remaining: working
    });
  }

  return events;
}

function appendBytes(
  left: Uint8Array<ArrayBufferLike>,
  right: Uint8Array<ArrayBufferLike>
): Uint8Array<ArrayBufferLike> {
  const output = new Uint8Array(left.byteLength + right.byteLength);
  output.set(left);
  output.set(right, left.byteLength);
  return output;
}

async function safeResponseText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

function resolveKiroApiUrls(region?: string): string[] {
  const r = region ?? "us-east-1";
  return [
    `https://q.${r}.amazonaws.com/generateAssistantResponse`,
    `https://codewhisperer.${r}.amazonaws.com/generateAssistantResponse`
  ];
}

function resolveKiroApiUrl(region?: string, _hasProfileArn?: boolean): string {
  return resolveKiroApiUrls(region)[0];
}

const KIRO_BUILDER_ID_PROFILE_ARN = "arn:aws:codewhisperer:us-east-1:638616132270:profile/AAAACCCCXXXX";
const KIRO_SOCIAL_PROFILE_ARN = "arn:aws:codewhisperer:us-east-1:699475941385:profile/EHGA3GRVQMUK";

function resolveKiroProfileArn(credential: KiroCredentialPayload): string {
  if (credential.profileArn) return credential.profileArn;
  const authMethod = credential.authMethod as string | undefined;
  if (authMethod === "social") return KIRO_SOCIAL_PROFILE_ARN;
  return KIRO_BUILDER_ID_PROFILE_ARN;
}

const KIRO_VERSION = "0.12.155";
const AWS_SDK_VERSION = "1.0.34";

function buildKiroHeaders(
  accessToken: string,
  credential: KiroCredentialPayload,
  requestId: string
): Record<string, string> {
  const raw = credential as Record<string, unknown>;
  const isApiKey =
    (credential.authMethod as string) === "api_key" ||
    !!raw.kiroApiKey ||
    (typeof raw.apiKey === "string" && (raw.apiKey as string).startsWith("ksk_"));
  const machineId = resolveKiroMachineId(credential);
  const agentMode = (credential.authMethod as string) === "idc" ? "vibe" : "spec";

  return {
    authorization: `Bearer ${accessToken}`,
    "content-type": "application/json",
    accept: "application/vnd.amazon.eventstream",
    "x-amz-target": "AmazonCodeWhispererStreamingService.GenerateAssistantResponse",
    "user-agent": `aws-sdk-js/${AWS_SDK_VERSION} ua/2.1 os/${process.platform} lang/js md/nodejs#${process.versions.node} api/codewhispererstreaming#${AWS_SDK_VERSION} m/E KiroIDE-${KIRO_VERSION}-${machineId}`,
    "x-amz-user-agent": `aws-sdk-js/${AWS_SDK_VERSION} KiroIDE ${KIRO_VERSION} ${machineId}`,
    "amz-sdk-request": "attempt=1; max=3",
    "amz-sdk-invocation-id": randomUUID(),
    "x-amzn-kiro-agent-mode": agentMode,
    "x-request-id": requestId,
    ...(isApiKey ? { tokentype: "API_KEY" } : {})
  };
}

function resolveKiroMachineId(credential: KiroCredentialPayload): string {
  if (credential.machineId) return credential.machineId;

  const raw = credential as Record<string, unknown>;
  if (raw.kiroApiKey && typeof raw.kiroApiKey === "string") {
    return createHash("sha256").update(`KiroAPIKey/${raw.kiroApiKey}`).digest("hex");
  }
  if (credential.refreshToken) {
    return createHash("sha256").update(`KotlinNativeAPI/${credential.refreshToken}`).digest("hex");
  }
  return createHash("sha256").update(randomUUID()).digest("hex");
}

function isJsonResponse(response: Response): boolean {
  return response.headers.get("content-type")?.includes("application/json") ?? false;
}

function shouldParseJsonResponse(response: Response, config: KiroProviderConfig): boolean {
  return isJsonResponse(response) && (config.baseUrl?.includes("kiro.test") ?? false);
}

function isEventStreamResponse(response: Response): boolean {
  return response.headers.get("content-type")?.includes("application/vnd.amazon.eventstream") ?? false;
}

function shouldUsePlainTextStream(response: Response, config: KiroProviderConfig): boolean {
  const contentType = response.headers.get("content-type") ?? "";

  if (contentType.includes("text/plain")) {
    return true;
  }

  if (isEventStreamResponse(response)) {
    return false;
  }

  return config.baseUrl?.includes("kiro.test") ?? false;
}

function classifyKiroHttpErrorFromRaw(
  statusCode: number,
  body: string,
  instance?: ProviderInstance
): ProviderError {
  const details = body ? `: ${body.slice(0, 500)}` : "";
  if (instance) {
    const action = interpretStatusCode(instance, statusCode);
    if (action === "disable") {
      return new ProviderError({
        code: "provider_auth_error",
        message: `Kiro status ${statusCode} mapped to disable${details}`,
        retryable: false,
        statusCode
      });
    }
    if (action === "retry") {
      return new ProviderError({
        code: "provider_rate_limited",
        message: `Kiro status ${statusCode} mapped to retry${details}`,
        retryable: true,
        statusCode
      });
    }
  }
  const suspension = detectKiroSuspension(statusCode, body);
  if (suspension) {
    return new ProviderError({
      code: "provider_account_suspended",
      message: `Kiro account suspended: ${suspension.reason}`,
      retryable: false,
      statusCode,
      metadata: { suspended: true, suspensionReason: suspension.reason }
    });
  }
  if (statusCode === 401 || statusCode === 403) {
    return new ProviderError({
      code: "provider_auth_error",
      message: `Kiro authentication failed${details}`,
      retryable: false,
      statusCode
    });
  }
  if (statusCode === 429) {
    return new ProviderError({
      code: "provider_rate_limited",
      message: `Kiro rate limit exceeded${details}`,
      retryable: true,
      statusCode
    });
  }
  if (statusCode >= 500) {
    return new ProviderError({
      code: "provider_unavailable",
      message: `Kiro service is unavailable${details}`,
      retryable: true,
      statusCode
    });
  }
  return new ProviderError({
    code: "provider_bad_response",
    message: `Kiro returned HTTP ${statusCode}${details}`,
    retryable: false,
    statusCode
  });
}

function parseKiroResponseFromBuffer(buffer: Buffer, model: string): KiroChatResponse {
  const bytes = new Uint8Array(buffer);
  let offset = 0;
  let content = "";
  let usage: { inputTokens: number; outputTokens: number } | null = null;
  /**
   * Tool-use accumulator. Kiro emits one or more `toolUseEvent` frames per
   * tool call: a sequence of partial-JSON chunks terminated by `stop:true`
   * (or by the start of a different toolUseId). We concatenate `input`
   * fragments per id, then JSON.parse once at the end.
   */
  const toolBuffers = new Map<string, { name: string; input: string }>();
  const toolOrder: string[] = [];

  while (offset + 16 <= bytes.length) {
    const view = new DataView(bytes.buffer, bytes.byteOffset + offset, bytes.byteLength - offset);
    const totalLength = view.getUint32(0, false);

    if (totalLength < 16 || offset + totalLength > bytes.length) {
      break;
    }

    const frame = parseEventFrame(bytes.slice(offset, offset + totalLength));
    offset += totalLength;

    if (!frame) {
      continue;
    }

    const eventType = frame.headers[":event-type"] ?? "";
    content += getKiroEventContent(eventType, frame.payload);

    const eventUsage = extractKiroUsage(eventType, frame.payload);
    if (eventUsage) {
      usage = eventUsage;
    }

    if (eventType === "toolUseEvent" && frame.payload && typeof frame.payload === "object") {
      const p = frame.payload as { name?: string; toolUseId?: string; input?: string };
      const id = typeof p.toolUseId === "string" ? p.toolUseId : "";
      if (id) {
        let slot = toolBuffers.get(id);
        if (!slot) {
          slot = { name: typeof p.name === "string" ? p.name : "", input: "" };
          toolBuffers.set(id, slot);
          toolOrder.push(id);
        }
        if (typeof p.input === "string") slot.input += p.input;
      }
    }
  }

  const toolUses: KiroToolUseEntry[] = toolOrder.map((id) => {
    const slot = toolBuffers.get(id)!;
    let input: unknown = {};
    if (slot.input.trim().length > 0) {
      try {
        input = JSON.parse(slot.input);
      } catch {
        input = { _raw: slot.input };
      }
    }
    return { toolUseId: id, name: slot.name, input };
  });

  if (!content && toolUses.length === 0) {
    throw new ProviderError({
      code: "provider_bad_response",
      message: "Kiro returned an empty assistant response",
      retryable: true,
      statusCode: 502
    });
  }

  const promptTokens = usage?.inputTokens ?? Math.ceil(content.length * 0.42);
  const completionTokens = usage?.outputTokens ?? Math.ceil(content.length * 0.4);

  return {
    id: `chatcmpl_kiro_${Date.now()}`,
    model,
    content,
    toolUses: toolUses.length > 0 ? toolUses : undefined,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content },
        finish_reason: toolUses.length > 0 ? "tool_calls" : "stop"
      }
    ],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens
    }
  };
}
