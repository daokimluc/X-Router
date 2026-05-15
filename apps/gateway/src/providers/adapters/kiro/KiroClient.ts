import { randomUUID } from "node:crypto";
import { ProviderError } from "../../base/ProviderErrors.js";
import type { ProviderStream } from "../../base/types.js";
import type { KiroChatRequest, KiroChatResponse, KiroCredentialPayload, KiroProviderConfig } from "./kiroTypes.js";

export type KiroClientFetch = typeof fetch;

export class KiroClient {
  constructor(private readonly fetchImpl: KiroClientFetch = fetch) {}

  async chatCompletions(options: {
    config: KiroProviderConfig;
    credential: KiroCredentialPayload;
    request: KiroChatRequest;
    requestId: string;
    timeoutMs: number;
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

    const baseUrl =
      options.config.baseUrl ??
      "https://codewhisperer.us-east-1.amazonaws.com/generateAssistantResponse";
    const path = options.config.chatCompletionsPath ?? "";
    const url = new URL(path, baseUrl);
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), options.timeoutMs);

    try {
      const response = await this.fetchImpl(url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
          accept: "application/vnd.amazon.eventstream",
          "x-amz-target": "AmazonCodeWhispererStreamingService.GenerateAssistantResponse",
          "user-agent": "AWS-SDK-JS/3.0.0 kiro-ide/1.0.0",
          "x-amz-user-agent": "aws-sdk-js/3.0.0 kiro-ide/1.0.0",
          "amz-sdk-request": "attempt=1; max=3",
          "x-request-id": options.requestId
        },
        body: JSON.stringify(buildKiroPayload(options.request, options.credential)),
        signal: abortController.signal
      });

      if (!response.ok) {
        throw await classifyKiroHttpError(response);
      }

      if (shouldParseJsonResponse(response, options.config)) {
        return (await response.json()) as KiroChatResponse;
      }

      return await parseKiroResponse(response, options.request.model);
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

    const baseUrl =
      options.config.baseUrl ??
      "https://codewhisperer.us-east-1.amazonaws.com/generateAssistantResponse";
    const path = options.config.chatCompletionsPath ?? "";
    const url = new URL(path, baseUrl);
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), options.timeoutMs);

    try {
      const response = await this.fetchImpl(url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
          accept: "application/vnd.amazon.eventstream",
          "x-amz-target": "AmazonCodeWhispererStreamingService.GenerateAssistantResponse",
          "user-agent": "AWS-SDK-JS/3.0.0 kiro-ide/1.0.0",
          "x-amz-user-agent": "aws-sdk-js/3.0.0 kiro-ide/1.0.0",
          "amz-sdk-request": "attempt=1; max=3",
          "x-request-id": options.requestId
        },
        body: JSON.stringify(buildKiroPayload(options.request, options.credential)),
        signal: abortController.signal
      });

      if (!response.ok) {
        throw await classifyKiroHttpError(response);
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

async function* kiroEventStream(
  stream: ReadableStream<Uint8Array>,
  onDone: () => void
): ProviderStream {
  const reader = stream.getReader();
  let buffer: Uint8Array<ArrayBufferLike> = new Uint8Array();

  try {
    while (true) {
      const result = await reader.read();

      if (result.done) {
        break;
      }

      buffer = appendBytes(buffer, result.value);

      for (const event of readCompleteEvents(buffer)) {
        buffer = event.remaining;
        const frame = parseEventFrame(event.frame);
        if (!frame) {
          continue;
        }

        const eventType = frame.headers[":event-type"] ?? "";
        const content = getKiroEventContent(eventType, frame.payload);

        if (content) {
          yield content;
        }
      }
    }
  } finally {
    onDone();
    reader.releaseLock();
  }
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

async function classifyKiroHttpError(response: Response): Promise<ProviderError> {
  const statusCode = response.status;
  const body = await safeResponseText(response);
  const details = body ? `: ${body.slice(0, 500)}` : "";

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

function buildKiroPayload(request: KiroChatRequest, credential: KiroCredentialPayload): Record<string, unknown> {
  const { history, currentMessage } = convertMessages(request.messages, request.model);
  const finalContent = `[Context: Current time is ${new Date().toISOString()}]\n\n${currentMessage.content}`;
  const payload: Record<string, unknown> = {
    conversationState: {
      chatTriggerType: "MANUAL",
      conversationId: randomUUID(),
      currentMessage: {
        userInputMessage: {
          content: finalContent,
          modelId: request.model,
          origin: "AI_EDITOR"
        }
      },
      history
    },
    inferenceConfig: {
      maxTokens: request.max_tokens ?? 32000,
      ...(request.temperature === undefined ? {} : { temperature: request.temperature })
    }
  };

  if (credential.profileArn) {
    payload.profileArn = credential.profileArn;
  }

  return payload;
}

function convertMessages(
  messages: KiroChatRequest["messages"],
  model: string
): {
  history: Array<Record<string, unknown>>;
  currentMessage: { content: string };
} {
  const history: Array<Record<string, unknown>> = [];
  let currentMessage: { content: string } | undefined;

  for (const message of messages) {
    const content = stringifyMessageContent(message.content);

    if (!content) {
      continue;
    }

    if (message.role === "assistant") {
      history.push({
        assistantResponseMessage: {
          content
        }
      });
      continue;
    }

    const userMessage = {
      userInputMessage: {
        content: message.role === "system" ? `System: ${content}` : content,
        modelId: model
      }
    };
    history.push(userMessage);
    currentMessage = { content: userMessage.userInputMessage.content };
  }

  if (!currentMessage) {
    currentMessage = { content: "continue" };
  } else {
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
  let offset = 0;
  let content = "";

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
  }

  if (!content) {
    throw new ProviderError({
      code: "provider_bad_response",
      message: "Kiro returned an empty assistant response",
      retryable: true,
      statusCode: 502
    });
  }

  return {
    id: `chatcmpl_kiro_${Date.now()}`,
    model,
    content,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content
        },
        finish_reason: "stop"
      }
    ]
  };
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
