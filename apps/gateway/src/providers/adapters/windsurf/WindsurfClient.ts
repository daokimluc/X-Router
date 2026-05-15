/**
 * Windsurf provider client.
 *
 * Talks to a local Windsurf language server subprocess instead of the
 * cloud chat endpoint, because the cloud `GetChatMessage` endpoint does
 * not accept JSON Connect frames from external clients (returns
 * `invalid_argument`). The protocol used here — gRPC binary protobuf
 * over HTTP/2 to localhost:42100 — is the same one the official
 * Windsurf IDE speaks to its bundled language server.
 *
 * The actual gRPC + protobuf logic is in {@link ./internal/} and is
 * derived from dwgx/WindsurfAPI (MIT). See
 * `./internal/LICENSE-WindsurfAPI.md` for attribution.
 */

import { ProviderError } from "../../base/ProviderErrors.js";
import type { ProviderStream } from "../../base/types.js";
import type {
  WindsurfChatRequest,
  WindsurfChatResponse,
  WindsurfCredentialPayload,
  WindsurfProviderConfig
} from "./windsurfTypes.js";
import {
  LangServerManager,
  detectLanguageServerBinary
} from "./internal/langServerManager.js";
import { LsClient, type LsCascadeChunk } from "./internal/lsClient.js";
import type { WindsurfMessage } from "./internal/windsurfProto.js";

const DEFAULT_MODEL = "claude-sonnet-4-6-thinking";

let sharedManager: LangServerManager | null = null;

function getManager(): LangServerManager {
  if (sharedManager) {
    return sharedManager;
  }
  const binary = detectLanguageServerBinary();
  if (!binary) {
    throw new ProviderError({
      code: "provider_config_error",
      message:
        "Windsurf language-server binary not found. Install Windsurf desktop or set WINDSURF_LS_BINARY_PATH.",
      retryable: false,
      statusCode: 500
    });
  }
  sharedManager = new LangServerManager({
    binaryPath: binary,
    port: parsePort(process.env.WINDSURF_LS_PORT) ?? 42_100,
    apiServerUrl:
      process.env.WINDSURF_LS_API_SERVER_URL ??
      "https://server.self-serve.windsurf.com",
    dataRoot: process.env.WINDSURF_LS_DATA_DIR,
    csrfToken:
      process.env.WINDSURF_LS_CSRF_TOKEN ?? "windsurf-api-csrf-fixed-token",
    logger: {
      info: (msg) => console.log(`[Windsurf LS] ${msg}`),
      warn: (msg) => console.warn(`[Windsurf LS] ${msg}`),
      error: (msg) => console.error(`[Windsurf LS] ${msg}`),
      debug: () =>
        process.env.WINDSURF_LS_DEBUG === "1"
          ? undefined
          : undefined
    }
  });
  return sharedManager;
}

export class WindsurfClient {
  /**
   * @param _legacyFetch — Legacy compat: older tests inject a fake
   *   `fetch` into this constructor. The new flow goes through the
   *   local language server (no HTTP), so this argument is ignored.
   *   Kept as a parameter so existing test files type-check while
   *   they remain `describe.skip`-ed.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(_legacyFetch?: unknown) {
    // ignore — local LS path takes no per-request transport
  }

  async chatCompletions(options: {
    config: WindsurfProviderConfig;
    credential: WindsurfCredentialPayload;
    request: WindsurfChatRequest;
    requestId: string;
    timeoutMs: number;
  }): Promise<WindsurfChatResponse> {
    const apiKey = pickApiKey(options.credential);
    const modelUid = pickModelUid(options.config, options.request);
    const manager = getManager();
    const entry = await manager.ensure();
    const client = new LsClient(entry, {
      info: (msg) => console.log(`[Windsurf LS] ${msg}`),
      warn: (msg) => console.warn(`[Windsurf LS] ${msg}`),
      error: (msg) => console.error(`[Windsurf LS] ${msg}`),
      debug: () => undefined
    });

    try {
      const result = await client.cascadeChat(
        toMessages(options.request),
        {
          apiKey,
          modelUid,
          chatTimeoutMs: options.timeoutMs,
          rpcTimeoutMs: Math.max(options.timeoutMs, 30_000)
        }
      );
      return {
        id: `chatcmpl_windsurf_${Date.now()}`,
        model: modelUid,
        content: result.text,
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: result.text },
            finish_reason: "stop"
          }
        ],
        usage: result.usage
          ? {
              prompt_tokens: result.usage.inputTokens,
              completion_tokens: result.usage.outputTokens,
              total_tokens:
                result.usage.inputTokens + result.usage.outputTokens
            }
          : undefined
      };
    } catch (err) {
      throw classifyError(err);
    }
  }

  async streamChatCompletions(options: {
    config: WindsurfProviderConfig;
    credential: WindsurfCredentialPayload;
    request: WindsurfChatRequest;
    requestId: string;
    timeoutMs: number;
  }): Promise<ProviderStream> {
    const apiKey = pickApiKey(options.credential);
    const modelUid = pickModelUid(options.config, options.request);
    const manager = getManager();
    const entry = await manager.ensure();
    const client = new LsClient(entry, {
      info: (msg) => console.log(`[Windsurf LS] ${msg}`),
      warn: (msg) => console.warn(`[Windsurf LS] ${msg}`),
      error: (msg) => console.error(`[Windsurf LS] ${msg}`),
      debug: () => undefined
    });

    return cascadeStream(
      client,
      toMessages(options.request),
      apiKey,
      modelUid,
      options.timeoutMs
    );
  }
}

async function* cascadeStream(
  client: LsClient,
  messages: WindsurfMessage[],
  apiKey: string,
  modelUid: string,
  timeoutMs: number
): AsyncGenerator<string, void, unknown> {
  const queue: LsCascadeChunk[] = [];
  let resolveWaiter: (() => void) | null = null;
  let done = false;
  let error: unknown = null;

  const onChunk = (chunk: LsCascadeChunk): void => {
    queue.push(chunk);
    if (resolveWaiter) {
      const r = resolveWaiter;
      resolveWaiter = null;
      r();
    }
  };

  const promise = client
    .cascadeChat(
      messages,
      {
        apiKey,
        modelUid,
        chatTimeoutMs: timeoutMs,
        rpcTimeoutMs: Math.max(timeoutMs, 30_000)
      },
      onChunk
    )
    .then(() => {
      done = true;
      if (resolveWaiter) {
        const r = resolveWaiter;
        resolveWaiter = null;
        r();
      }
    })
    .catch((err) => {
      error = classifyError(err);
      done = true;
      if (resolveWaiter) {
        const r = resolveWaiter;
        resolveWaiter = null;
        r();
      }
    });

  while (!done || queue.length > 0) {
    if (queue.length === 0) {
      await new Promise<void>((res) => {
        resolveWaiter = res;
      });
      continue;
    }
    const chunk = queue.shift();
    if (chunk && chunk.delta) {
      yield chunk.delta;
    }
  }
  await promise;
  if (error) {
    throw error;
  }
}

function pickApiKey(credential: WindsurfCredentialPayload): string {
  const apiKey =
    credential.apiKey ??
    credential.accessToken ??
    credential.token ??
    "";
  if (!apiKey) {
    throw new ProviderError({
      code: "provider_auth_error",
      message: "Windsurf credential is missing api key / access token",
      retryable: false,
      statusCode: 401
    });
  }
  return apiKey;
}

function pickModelUid(
  config: WindsurfProviderConfig,
  request: WindsurfChatRequest
): string {
  const fromConfig = config.defaultModel?.trim();
  const fromRequest = request.model?.trim();
  return (
    (fromRequest && fromRequest !== "default" && fromRequest) ||
    fromConfig ||
    DEFAULT_MODEL
  );
}

function toMessages(request: WindsurfChatRequest): WindsurfMessage[] {
  return request.messages.map((m) => ({
    role: m.role,
    content: m.content
  }));
}

function classifyError(err: unknown): ProviderError {
  if (err instanceof ProviderError) {
    return err;
  }
  const message = err instanceof Error ? err.message : String(err);
  if (/timeout/i.test(message)) {
    return new ProviderError({
      code: "provider_timeout",
      message: `Windsurf request timed out: ${message}`,
      retryable: true,
      statusCode: 504
    });
  }
  if (/auth|unauthenticated|permission/i.test(message)) {
    return new ProviderError({
      code: "provider_auth_error",
      message: `Windsurf authentication failed: ${message}`,
      retryable: false,
      statusCode: 401
    });
  }
  if (/binary not found|WINDSURF_LS_BINARY_PATH/i.test(message)) {
    return new ProviderError({
      code: "provider_config_error",
      message,
      retryable: false,
      statusCode: 500
    });
  }
  return new ProviderError({
    code: "provider_bad_response",
    message: `Windsurf chat failed: ${message}`,
    retryable: false,
    statusCode: 502
  });
}

function parsePort(value: string | undefined): number | null {
  if (!value) {
    return null;
  }
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Test helper: stop the shared LS subprocess. */
export async function stopWindsurfLanguageServer(): Promise<void> {
  if (sharedManager) {
    await sharedManager.stop();
    sharedManager = null;
  }
}
