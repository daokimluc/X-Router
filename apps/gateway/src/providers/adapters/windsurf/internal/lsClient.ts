/**
 * High-level client that talks to a local Windsurf language server.
 *
 * Ported (subset, simplified) from dwgx/WindsurfAPI/src/client.js (MIT).
 * See LICENSE-WindsurfAPI.md in this directory for attribution.
 *
 * Scope of this port:
 *   - workspace warmup (InitializePanelState + AddTrackedWorkspace +
 *     UpdateWorkspaceTrust + Heartbeat)
 *   - Cascade chat flow (StartCascade → SendUserCascadeMessage → poll)
 *   - both non-streaming and streaming text output
 *
 * Out of scope (handle by upstream client.js but not ported here):
 *   - tool calling / cascade-native bridge
 *   - conversation pooling / cascade resume
 *   - generator-metadata RPC for token usage
 *   - image attachments
 */

import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { grpcFrame, grpcUnary } from "./grpc.js";
import type { LsEntry, LsLogger } from "./langServerManager.js";
import {
  buildAddTrackedWorkspaceRequest,
  buildGetTrajectoryRequest,
  buildGetTrajectoryStepsRequest,
  buildHeartbeatRequest,
  buildInitializePanelStateRequest,
  buildSendCascadeMessageRequest,
  buildStartCascadeRequest,
  buildUpdateWorkspaceTrustRequest,
  parseStartCascadeResponse,
  parseTrajectorySteps,
  parseTrajectoryStatus,
  type WindsurfMessage,
} from "./windsurfProto.js";

const LS_SERVICE = "/exa.language_server_pb.LanguageServerService";

const noopLogger: Required<LsLogger> = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

export type LsClientOptions = {
  apiKey: string;
  modelEnum?: number;
  modelUid?: string | null;
  /** Timeout for each unary gRPC call (default 30s). */
  rpcTimeoutMs?: number;
  /** Max wait for the polling loop to find a final response (default 600s). */
  maxWaitMs?: number;
  /** Polling interval in ms (default 500). */
  pollIntervalMs?: number;
  /** Per-stream chat timeout (default 600s). */
  chatTimeoutMs?: number;
  /** Optional AbortSignal — when triggered the poll loop bails. */
  signal?: AbortSignal;
  logger?: LsLogger;
};

export type LsCascadeResult = {
  /** Concatenated streamed text. */
  text: string;
  /** Final cascade id, useful for diagnostics. */
  cascadeId: string;
  /** Reason the poll loop exited. */
  endReason:
    | "idle_done"
    | "idle_empty"
    | "stall_warm"
    | "stall_cold"
    | "stall_warm_retry"
    | "max_wait"
    | "aborted";
  /** Number of polls performed. */
  pollCount: number;
  /** Aggregated server-reported usage if any step exposed it. */
  usage:
    | {
        inputTokens: number;
        outputTokens: number;
        cacheReadTokens: number;
        cacheWriteTokens: number;
      }
    | null;
};

export type LsCascadeChunk = {
  delta: string;
  thinking: string;
};

export class LsClient {
  private readonly logger: Required<LsLogger>;

  constructor(
    private readonly entry: LsEntry,
    logger?: LsLogger
  ) {
    this.logger = { ...noopLogger, ...(logger ?? {}) };
  }

  /**
   * Run the one-shot Cascade workspace init for this LS. Idempotent —
   * concurrent callers share the same in-flight Promise.
   */
  async warmupCascade(apiKey: string, force = false): Promise<void> {
    if (force) {
      this.entry.workspaceInit = null;
      this.entry.sessionId = randomUUID();
    }
    if (!this.entry.sessionId) {
      this.entry.sessionId = randomUUID();
    }
    if (this.entry.workspaceInit) {
      return this.entry.workspaceInit;
    }

    const sessionId = this.entry.sessionId;
    const wsId = createHash("sha256").update(apiKey).digest("hex").slice(0, 16);
    const workspacePath = join(tmpdir(), "windsurf-gateway-ws", wsId);
    const init = (async () => {
      try {
        await this.unary(
          "InitializeCascadePanelState",
          buildInitializePanelStateRequest(apiKey, sessionId, true),
          5_000
        );
      } catch (err) {
        this.logger.warn(
          `InitializeCascadePanelState failed: ${asMsg(err)}`
        );
        throw err;
      }
      try {
        ensureWorkspaceDir(workspacePath, this.logger);
        await this.unary(
          "AddTrackedWorkspace",
          buildAddTrackedWorkspaceRequest(workspacePath),
          5_000
        );
      } catch (err) {
        this.logger.warn(`AddTrackedWorkspace failed: ${asMsg(err)}`);
        throw err;
      }
      try {
        await this.unary(
          "UpdateWorkspaceTrust",
          buildUpdateWorkspaceTrustRequest(apiKey, "", true, sessionId),
          5_000
        );
      } catch (err) {
        // Non-fatal: SendUserCascadeMessage may then return "untrusted
        // workspace", which we recover from below.
        this.logger.warn(`UpdateWorkspaceTrust failed: ${asMsg(err)}`);
      }
      try {
        await this.unary(
          "Heartbeat",
          buildHeartbeatRequest(apiKey, sessionId),
          5_000
        );
      } catch (err) {
        this.logger.warn(`Heartbeat failed: ${asMsg(err)}`);
      }
      this.logger.info(
        `Cascade workspace init complete on port ${this.entry.port}`
      );
    })();

    this.entry.workspaceInit = init.catch((err) => {
      this.entry.workspaceInit = null;
      throw err;
    });
    return this.entry.workspaceInit;
  }

  /**
   * Single-shot Cascade chat. Optionally streams text deltas via `onChunk`.
   * Returns the concatenated text plus diagnostic metadata.
   */
  async cascadeChat(
    messages: WindsurfMessage[],
    options: LsClientOptions,
    onChunk?: (chunk: LsCascadeChunk) => void
  ): Promise<LsCascadeResult> {
    const {
      apiKey,
      modelEnum = 0,
      modelUid = null,
      rpcTimeoutMs = 30_000,
      maxWaitMs = 600_000,
      pollIntervalMs = 500,
      signal,
    } = options;

    if (!modelEnum && !modelUid) {
      throw new Error(
        "cascadeChat: at least one of modelEnum or modelUid must be set"
      );
    }
    this.entry.apiKey = apiKey;

    const aborted = (): boolean => signal?.aborted === true;

    await this.warmupCascade(apiKey);
    let sessionId =
      this.entry.sessionId ?? (this.entry.sessionId = randomUUID());

    // Step 1 — StartCascade. Retry once on panel-missing.
    let cascadeId = "";
    const open = async (): Promise<string> => {
      const resp = await this.unary(
        "StartCascade",
        buildStartCascadeRequest(apiKey, sessionId),
        rpcTimeoutMs
      );
      const id = parseStartCascadeResponse(resp);
      if (!id) {
        throw new Error("StartCascade returned empty cascade_id");
      }
      return id;
    };
    try {
      cascadeId = await open();
    } catch (err) {
      if (!isPanelMissing(err)) {
        throw err;
      }
      this.logger.warn(
        `Panel state missing, re-warming Windsurf LS: ${asMsg(err)}`
      );
      await this.warmupCascade(apiKey, true);
      sessionId = this.entry.sessionId ?? (this.entry.sessionId = randomUUID());
      cascadeId = await open();
    }

    // Step 2 — SendUserCascadeMessage with composed history. Retry up to
    // 3 times on panel-missing / untrusted workspace.
    const text = composeCascadeText(messages);
    const send = async (): Promise<void> => {
      await this.unary(
        "SendUserCascadeMessage",
        buildSendCascadeMessageRequest(
          apiKey,
          cascadeId,
          text,
          { modelEnum, modelUid },
          sessionId
        ),
        rpcTimeoutMs
      );
    };

    let panelRetry = 0;
    const MAX_PANEL_RETRIES = 3;
    while (true) {
      try {
        await send();
        break;
      } catch (err) {
        const panel = isPanelMissing(err);
        const untrusted = isUntrustedWorkspace(err);
        const expired = isExpiredCascade(err);
        if (!panel && !untrusted && !expired) {
          throw err;
        }
        panelRetry++;
        if (panelRetry > MAX_PANEL_RETRIES) {
          throw new Error(
            `Cascade send failed after ${MAX_PANEL_RETRIES} retries (last cause: ${asMsg(
              err
            )})`
          );
        }
        this.logger.warn(
          `Cascade send retry ${panelRetry}/${MAX_PANEL_RETRIES}: ${asMsg(err)}`
        );
        await this.warmupCascade(apiKey, true);
        sessionId =
          this.entry.sessionId ?? (this.entry.sessionId = randomUUID());
        cascadeId = await open();
        await sleep(250 * panelRetry);
      }
    }

    // Step 3 — Poll trajectory until idle / stalled / max-wait.
    const yieldedByStep = new Map<number, number>();
    const thinkingByStep = new Map<number, number>();
    const usageByStep = new Map<number, NonNullable<LsCascadeResult["usage"]>>();
    let totalText = "";
    let totalThinking = 0;
    let pollCount = 0;
    let sawActive = false;
    let sawText = false;
    let lastStatus = -1;
    let lastGrowthAt = Date.now();
    let lastStepCount = 0;
    let endReason: LsCascadeResult["endReason"] = "max_wait";
    const startTime = Date.now();
    const COLD_STALL_BASE_MS = 30_000;
    const COLD_STALL_PER_KB_MS = 5_000;
    const WARM_STALL_TEXT_MS = 45_000;
    const WARM_STALL_THINK_MS = 120_000;
    const IDLE_GRACE_MS = 8_000;

    while (Date.now() - startTime < maxWaitMs) {
      if (aborted()) {
        endReason = "aborted";
        break;
      }
      await sleep(pollIntervalMs);
      if (aborted()) {
        endReason = "aborted";
        break;
      }
      pollCount++;

      const stepsResp = await this.unary(
        "GetCascadeTrajectorySteps",
        buildGetTrajectoryStepsRequest(cascadeId, 0),
        rpcTimeoutMs
      );
      const steps = parseTrajectorySteps(stepsResp);

      // Surface explicit error steps (CORTEX_STEP_TYPE_ERROR_MESSAGE = 17).
      for (const step of steps) {
        if (step.type === 17 && step.errorText) {
          throw new Error(step.errorText.trim());
        }
      }

      const elapsed = Date.now() - startTime;
      const promptKb = Math.floor(text.length / 1024);
      const coldStallMs = Math.min(
        maxWaitMs,
        COLD_STALL_BASE_MS + promptKb * COLD_STALL_PER_KB_MS
      );
      if (
        elapsed > coldStallMs &&
        sawActive &&
        !sawText &&
        totalThinking === 0
      ) {
        endReason = "stall_cold";
        throw new Error(
          `Cascade planner stalled — no output after ${Math.round(
            coldStallMs / 1_000
          )}s`
        );
      }

      if (steps.length > lastStepCount) {
        lastStepCount = steps.length;
        lastGrowthAt = Date.now();
      }

      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        if (step.usage) {
          usageByStep.set(i, step.usage);
        }

        if (step.thinking) {
          const prevThink = thinkingByStep.get(i) ?? 0;
          if (step.thinking.length > prevThink) {
            const delta = step.thinking.slice(prevThink);
            thinkingByStep.set(i, step.thinking.length);
            totalThinking += delta.length;
            lastGrowthAt = Date.now();
            onChunk?.({ delta: "", thinking: delta });
          }
        }

        const live = step.responseText || step.text || "";
        if (!live) {
          continue;
        }
        const prev = yieldedByStep.get(i) ?? 0;
        if (live.length > prev) {
          const delta = live.slice(prev);
          yieldedByStep.set(i, live.length);
          totalText += delta;
          lastGrowthAt = Date.now();
          sawText = true;
          onChunk?.({ delta, thinking: "" });
        }
      }

      const msSinceGrowth = Date.now() - lastGrowthAt;
      const warmStallCeiling =
        totalThinking > 0 ? WARM_STALL_THINK_MS : WARM_STALL_TEXT_MS;
      if (sawText && lastStatus !== 1 && msSinceGrowth > warmStallCeiling) {
        if (totalText.length < 300) {
          endReason = "stall_warm_retry";
          throw new Error(
            `Cascade planner stalled after preamble — no progress for ${Math.round(
              warmStallCeiling / 1_000
            )}s`
          );
        }
        endReason = "stall_warm";
        break;
      }

      const statusResp = await this.unary(
        "GetCascadeTrajectory",
        buildGetTrajectoryRequest(cascadeId),
        rpcTimeoutMs
      );
      const status = parseTrajectoryStatus(statusResp);
      lastStatus = status;
      if (status !== 1) {
        sawActive = true;
      }

      if (status === 1) {
        const totalElapsed = Date.now() - startTime;
        const graceOver = totalElapsed > IDLE_GRACE_MS;
        if (!sawActive && !graceOver) {
          continue;
        }
        // 'Done' if we've seen text and growth has settled, or if we've been
        // idle for a while with no text.
        const growthSettled = Date.now() - lastGrowthAt > pollIntervalMs * 2;
        const canBreak = sawText ? growthSettled : msSinceGrowth > 4_000;
        if (canBreak) {
          // Final sweep: pull modified responses if they extend what we already
          // streamed.
          const finalResp = await this.unary(
            "GetCascadeTrajectorySteps",
            buildGetTrajectoryStepsRequest(cascadeId, 0),
            rpcTimeoutMs
          );
          const finalSteps = parseTrajectorySteps(finalResp);
          for (let i = 0; i < finalSteps.length; i++) {
            const step = finalSteps[i];
            const responseText = step.responseText || "";
            const modifiedText = step.modifiedText || "";
            const cursor = yieldedByStep.get(i) ?? 0;
            if (responseText.length > cursor) {
              const delta = responseText.slice(cursor);
              yieldedByStep.set(i, responseText.length);
              totalText += delta;
              onChunk?.({ delta, thinking: "" });
            }
            const cursor2 = yieldedByStep.get(i) ?? 0;
            if (
              modifiedText.length > cursor2 &&
              modifiedText.startsWith(responseText)
            ) {
              const delta = modifiedText.slice(cursor2);
              yieldedByStep.set(i, modifiedText.length);
              totalText += delta;
              onChunk?.({ delta, thinking: "" });
            }
          }
          endReason = sawText ? "idle_done" : "idle_empty";
          break;
        }
      }
    }

    let usage: LsCascadeResult["usage"] = null;
    if (usageByStep.size > 0) {
      let inT = 0;
      let outT = 0;
      let cacheR = 0;
      let cacheW = 0;
      for (const u of usageByStep.values()) {
        inT += u.inputTokens || 0;
        outT += u.outputTokens || 0;
        cacheR += u.cacheReadTokens || 0;
        cacheW += u.cacheWriteTokens || 0;
      }
      if (inT || outT || cacheR || cacheW) {
        usage = {
          inputTokens: inT,
          outputTokens: outT,
          cacheReadTokens: cacheR,
          cacheWriteTokens: cacheW,
        };
      }
    }

    return {
      text: totalText,
      cascadeId,
      endReason,
      pollCount,
      usage,
    };
  }

  private async unary(
    method: string,
    body: Buffer,
    timeoutMs: number
  ): Promise<Buffer> {
    return grpcUnary(
      this.entry.port,
      this.entry.csrfToken,
      `${LS_SERVICE}/${method}`,
      grpcFrame(body),
      timeoutMs
    );
  }
}

// ─── Helpers ──────────────────────────────────────────────

function asMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isPanelMissing(err: unknown): boolean {
  const msg = asMsg(err);
  return /panel state not found|not_found.*panel/i.test(msg);
}

function isExpiredCascade(err: unknown): boolean {
  const msg = asMsg(err);
  return /not_found.*(cascade|trajectory)|(?:cascade|trajectory).*not[ _-]?found|expired.*cascade|unknown.*cascade/i.test(
    msg
  );
}

function isUntrustedWorkspace(err: unknown): boolean {
  const msg = asMsg(err);
  return /untrusted workspace|workspace.*not.*trusted/i.test(msg);
}

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

/**
 * Compose the user-message body sent to Cascade. Cascade has no separate
 * system channel so we inline system + multi-turn history into one text
 * blob, similar to dwgx/client.js.
 */
function composeCascadeText(messages: WindsurfMessage[]): string {
  const sysParts: string[] = [];
  const convo: WindsurfMessage[] = [];
  for (const m of messages) {
    if (m.role === "system") {
      sysParts.push(contentToString(m.content));
    } else if (m.role === "user" || m.role === "assistant") {
      convo.push(m);
    } else if (m.role === "tool") {
      // Tool turns get rewritten as synthetic user observations so the
      // text-only flow does not have to deal with tool-call wire types.
      convo.push({
        role: "user",
        content: `[tool result${
          m.tool_call_id ? ` for ${m.tool_call_id}` : ""
        }]: ${contentToString(m.content)}`,
      });
    }
  }

  const sysText = sysParts.join("\n").trim();

  if (convo.length === 0) {
    return sysText;
  }
  if (convo.length === 1) {
    const last = contentToString(convo[0].content);
    return sysText ? `${sysText}\n\n${last}` : last;
  }

  // Multi-turn: render <human>/<assistant> tags so the model has
  // explicit role separators, mirroring how the IDE crystallises history.
  const lines: string[] = [];
  for (let i = 0; i < convo.length - 1; i++) {
    const m = convo[i];
    const tag = m.role === "user" ? "human" : "assistant";
    const body = escapeHistoryTag(contentToString(m.content), tag);
    lines.push(`<${tag}>\n${body}\n</${tag}>`);
  }
  const latest = contentToString(convo[convo.length - 1].content);
  let combined =
    `The following is a multi-turn conversation. You MUST remember and use all information from prior turns.\n\n${lines.join(
      "\n\n"
    )}\n\n<human>\n${latest}\n</human>`;
  if (sysText) {
    combined = `${sysText}\n\n${combined}`;
  }
  return combined;
}

function escapeHistoryTag(text: string, tag: string): string {
  return text.split(`</${tag}>`).join(`<\\/${tag}>`);
}

function contentToString(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }
        if (
          part &&
          typeof part === "object" &&
          "text" in (part as Record<string, unknown>) &&
          typeof (part as Record<string, unknown>).text === "string"
        ) {
          return (part as Record<string, unknown>).text as string;
        }
        return "";
      })
      .filter(Boolean)
      .join("");
  }
  if (content == null) {
    return "";
  }
  try {
    return JSON.stringify(content);
  } catch {
    return String(content);
  }
}

const _seededWorkspaces = new Set<string>();

function ensureWorkspaceDir(workspacePath: string, logger: Required<LsLogger>): void {
  if (_seededWorkspaces.has(workspacePath)) {
    return;
  }
  try {
    if (!existsSync(workspacePath)) {
      mkdirSync(workspacePath, { recursive: true });
      writeFileSync(
        join(workspacePath, "package.json"),
        `${JSON.stringify(
          {
            name: "proxy-workspace-stub",
            version: "0.0.0",
            private: true,
            description:
              "Empty placeholder created by the gateway. NOT the user project.",
            license: "UNLICENSED",
          },
          null,
          2
        )}\n`
      );
      writeFileSync(
        join(workspacePath, "README.md"),
        "# Proxy workspace placeholder\n\nThis directory exists only so the Windsurf language server has a workspace to register.\n"
      );
      writeFileSync(
        join(workspacePath, ".gitignore"),
        "# proxy workspace placeholder\n"
      );
      logger.info(`Workspace scaffold created: ${workspacePath}`);
    }
    _seededWorkspaces.add(workspacePath);
  } catch (err) {
    logger.debug(`ensureWorkspaceDir: ${asMsg(err)}`);
  }
}
