/**
 * Protobuf message builders/parsers for the local Windsurf language server.
 *
 * Ported (subset) from dwgx/WindsurfAPI/src/windsurf.js (MIT). See
 * LICENSE-WindsurfAPI.md in this directory for attribution.
 *
 * Service: exa.language_server_pb.LanguageServerService
 *
 * Two flows:
 *   Legacy  → RawGetChatMessage (streaming, simpler)
 *   Cascade → StartCascade → SendUserCascadeMessage → poll GetCascadeTrajectorySteps
 */

import { randomUUID } from "node:crypto";
import { arch as osArch, platform as osPlatform } from "node:os";

import {
  getAllFields,
  getField,
  parseFields,
  readBool,
  readString,
  writeBoolField,
  writeMessageField,
  writeStringField,
  writeVarintField,
} from "./proto.js";

// ─── Enums ─────────────────────────────────────────────────

export const SOURCE = {
  USER: 1,
  SYSTEM: 2,
  ASSISTANT: 3,
  TOOL: 4,
} as const;

export type ChatRole = "user" | "assistant" | "system" | "tool";

export type WindsurfMessage = {
  role: ChatRole | string;
  content: unknown;
  /** Optional tool-call metadata for assistant turns (degraded to text). */
  tool_calls?: Array<{ function?: { name?: string; arguments?: string } }>;
  /** Optional tool-call id for tool result turns. */
  tool_call_id?: string;
};

// ─── Timestamp ─────────────────────────────────────────────

function encodeTimestamp(): Buffer {
  const now = Date.now();
  const secs = Math.floor(now / 1000);
  const nanos = (now % 1000) * 1_000_000;
  const parts = [writeVarintField(1, secs)];
  if (nanos > 0) {
    parts.push(writeVarintField(2, nanos));
  }
  return Buffer.concat(parts);
}

// ─── Metadata ──────────────────────────────────────────────

const _os =
  osPlatform() === "darwin"
    ? "macos"
    : osPlatform() === "win32"
      ? "windows"
      : "linux";
const _hw = osArch() === "arm64" ? "arm64" : "x86_64";
const DEFAULT_CLIENT_VERSION =
  process.env.WINDSURF_CLIENT_VERSION || "2.0.67";

export function buildMetadata(
  apiKey: string,
  version: string = DEFAULT_CLIENT_VERSION,
  sessionId: string | null = null
): Buffer {
  return Buffer.concat([
    writeStringField(1, "windsurf"), // ide_name
    writeStringField(2, version), // extension_version
    writeStringField(3, apiKey), // api_key
    writeStringField(4, "en"), // locale
    writeStringField(5, _os), // os
    writeStringField(7, version), // ide_version
    writeStringField(8, _hw), // hardware
    writeVarintField(9, Math.floor(Math.random() * 2 ** 48)), // request_id
    writeStringField(10, sessionId || randomUUID()), // session_id
    writeStringField(12, "windsurf"), // extension_name
  ]);
}

// ─── Workspace setup builders ──────────────────────────────

export function buildInitializePanelStateRequest(
  apiKey: string,
  sessionId: string,
  trusted = true
): Buffer {
  return Buffer.concat([
    writeMessageField(1, buildMetadata(apiKey, undefined, sessionId)),
    writeBoolField(3, trusted), // workspace_trusted
  ]);
}

export function buildHeartbeatRequest(apiKey: string, sessionId: string): Buffer {
  return writeMessageField(1, buildMetadata(apiKey, undefined, sessionId));
}

export function buildAddTrackedWorkspaceRequest(workspacePath: string): Buffer {
  return writeStringField(1, workspacePath);
}

export function buildUpdateWorkspaceTrustRequest(
  apiKey: string,
  _ignored: string,
  trusted: boolean,
  sessionId: string
): Buffer {
  return Buffer.concat([
    writeMessageField(1, buildMetadata(apiKey, undefined, sessionId)),
    writeBoolField(2, trusted),
  ]);
}

// ─── Cascade flow builders ─────────────────────────────────

export function buildStartCascadeRequest(
  apiKey: string,
  sessionId: string
): Buffer {
  return Buffer.concat([
    writeMessageField(1, buildMetadata(apiKey, undefined, sessionId)),
    writeVarintField(4, 1), // source = CORTEX_TRAJECTORY_SOURCE_CASCADE_CLIENT
    writeVarintField(5, 1), // trajectory_type = CORTEX_TRAJECTORY_TYPE_USER_MAINLINE
  ]);
}

export type CascadeSendOptions = {
  modelEnum?: number;
  modelUid?: string | null;
};

export function buildSendCascadeMessageRequest(
  apiKey: string,
  cascadeId: string,
  text: string,
  options: CascadeSendOptions,
  sessionId: string
): Buffer {
  const parts: Buffer[] = [];
  parts.push(writeStringField(1, cascadeId));
  // Field 2: TextOrScopeItem { text = 1 }
  parts.push(writeMessageField(2, writeStringField(1, text)));
  // Field 3: metadata
  parts.push(writeMessageField(3, buildMetadata(apiKey, undefined, sessionId)));
  // Field 5: cascade_config
  parts.push(writeMessageField(5, buildCascadeConfig(options)));
  return Buffer.concat(parts);
}

function buildCascadeConfig(options: CascadeSendOptions): Buffer {
  // planner_mode = NO_TOOL (3). Tool emulation is out of scope for this
  // port — see comments in dwgx/windsurf.js about the full
  // tool_calling_section / additional_instructions_section overrides.
  const convParts: Buffer[] = [writeVarintField(4, 3)];

  // tool_calling_section (field 10): suppress built-in tool list
  const noToolSection = Buffer.concat([
    writeVarintField(1, 1), // SECTION_OVERRIDE_MODE_OVERRIDE
    writeStringField(2, "No tools are available."),
  ]);
  convParts.push(writeMessageField(10, noToolSection));

  // additional_instructions (field 12): force chat-API mode
  const additional = Buffer.concat([
    writeVarintField(1, 1),
    writeStringField(
      2,
      "CRITICAL OPERATING CONSTRAINT — READ BEFORE ANY RESPONSE:\n" +
        "You are being accessed as a plain chat API. You have NO tools, NO file access, NO shell, NO code execution, NO repository awareness, NO ability to list or read anything on the user's machine or any sandbox. You cannot \"check\", \"look at\", \"open\", \"view\", \"inspect\", \"run\", \"glob\", \"grep\", \"list\", or \"edit\" anything.\n\n" +
        "OUTPUT RULES:\n" +
        "1. Never narrate tool-like actions (\"Let me check X\", \"I'll look at Y\", \"Looking at the file...\").\n" +
        "2. Never reference file paths, directory structures, line numbers, or repository contents that were not explicitly pasted into the current conversation by the user.\n" +
        "3. If the user asks about their code or project but hasn't pasted the relevant file content, respond: \"I don't see that file in our conversation — please paste it and I'll help.\" Do NOT invent file contents.\n" +
        "4. For general questions, answer directly from your training knowledge. No preambles.\n" +
        "5. Match the user's language (Vietnamese → Vietnamese, Chinese → Chinese, English → English; never switch mid-conversation).\n\n" +
        "Violating these rules will produce broken output for the end user. Stay in chat-API mode at all times."
    ),
  ]);
  convParts.push(writeMessageField(12, additional));

  // communication_section (field 13): minimal, no identity manipulation
  const communication = Buffer.concat([
    writeVarintField(1, 1),
    writeStringField(
      2,
      "Be direct, concise, and answer the user's question without preamble. Match the user's language."
    ),
  ]);
  convParts.push(writeMessageField(13, communication));

  const conversationalConfig = Buffer.concat(convParts);
  const plannerParts: Buffer[] = [
    writeMessageField(2, conversationalConfig), // conversational = 2
  ];

  if (options.modelUid) {
    plannerParts.push(writeStringField(35, options.modelUid)); // requested_model_uid
    plannerParts.push(writeStringField(34, options.modelUid)); // plan_model_uid (safety)
  }
  if (options.modelEnum && options.modelEnum > 0) {
    plannerParts.push(
      writeMessageField(15, writeVarintField(1, options.modelEnum))
    );
    plannerParts.push(writeVarintField(1, options.modelEnum));
  }
  if (!options.modelUid && !options.modelEnum) {
    throw new Error(
      "buildCascadeConfig: at least one of modelUid or modelEnum must be provided"
    );
  }

  // max_output_tokens (field 6) — match Windsurf IDE defaults so long
  // replies are not truncated.
  plannerParts.push(writeVarintField(6, 32_768));

  // code_changes_section (field 11): empty so cascade-IDE boilerplate is
  // suppressed.
  const emptySection = Buffer.concat([
    writeVarintField(1, 1),
    writeStringField(2, ""),
  ]);
  plannerParts.push(writeMessageField(11, emptySection));

  const plannerConfig = Buffer.concat(plannerParts);

  const brainConfig = Buffer.concat([
    writeVarintField(1, 1),
    writeMessageField(6, writeMessageField(6, Buffer.alloc(0))),
  ]);

  // memory_config (field 5): {enabled=false}
  const memoryConfig = Buffer.concat([writeBoolField(1, false)]);

  return Buffer.concat([
    writeMessageField(1, plannerConfig),
    writeMessageField(5, memoryConfig),
    writeMessageField(7, brainConfig),
  ]);
}

export function buildGetTrajectoryStepsRequest(
  cascadeId: string,
  stepOffset = 0
): Buffer {
  const parts: Buffer[] = [writeStringField(1, cascadeId)];
  if (stepOffset > 0) {
    parts.push(writeVarintField(2, stepOffset));
  }
  return Buffer.concat(parts);
}

export function buildGetTrajectoryRequest(cascadeId: string): Buffer {
  return writeStringField(1, cascadeId);
}

// ─── Response parsers ─────────────────────────────────────

/** Parse StartCascadeResponse → cascade_id (field 1). */
export function parseStartCascadeResponse(buf: Buffer): string {
  const fields = parseFields(buf);
  return readString(getField(fields, 1, 2)) ?? "";
}

/** Parse GetCascadeTrajectoryResponse → status enum (field 2). */
export function parseTrajectoryStatus(buf: Buffer): number {
  const fields = parseFields(buf);
  const f2 = getField(fields, 2, 0);
  if (!f2) {
    return 0;
  }
  return Number(f2.value);
}

export type TrajectoryStep = {
  type: number;
  status: number;
  text: string;
  responseText: string;
  modifiedText: string;
  thinking: string;
  errorText: string;
  usage:
    | {
        inputTokens: number;
        outputTokens: number;
        cacheReadTokens: number;
        cacheWriteTokens: number;
      }
    | null;
};

/**
 * Parse GetCascadeTrajectoryStepsResponse → planner-response steps only.
 * Tool-call sub-messages are ignored in this milestone (out of scope for
 * the basic chat path). Re-add when porting the tool emulation layer.
 */
export function parseTrajectorySteps(buf: Buffer): TrajectoryStep[] {
  const fields = parseFields(buf);
  const stepFields = getAllFields(fields, 1).filter((f) => f.wireType === 2);
  const results: TrajectoryStep[] = [];

  for (const step of stepFields) {
    if (!Buffer.isBuffer(step.value)) {
      continue;
    }
    const sf = parseFields(step.value);
    const typeField = getField(sf, 1, 0);
    const statusField = getField(sf, 4, 0);
    const plannerField = getField(sf, 20, 2);

    const entry: TrajectoryStep = {
      type: typeField ? Number(typeField.value) : 0,
      status: statusField ? Number(statusField.value) : 0,
      text: "",
      responseText: "",
      modifiedText: "",
      thinking: "",
      errorText: "",
      usage: null,
    };

    // CortexTrajectoryStep.metadata (field 5) → CortexStepMetadata.
    // CortexStepMetadata.model_usage (field 9) → ModelUsageStats.
    const stepMetaField = getField(sf, 5, 2);
    if (stepMetaField && Buffer.isBuffer(stepMetaField.value)) {
      const meta = parseFields(stepMetaField.value);
      const usageField = getField(meta, 9, 2);
      if (usageField && Buffer.isBuffer(usageField.value)) {
        const us = parseFields(usageField.value);
        const readUint = (fn: number): number => {
          const f = getField(us, fn, 0);
          return f ? Number(f.value) : 0;
        };
        const inputTokens = readUint(2);
        const outputTokens = readUint(3);
        const cacheWriteTokens = readUint(4);
        const cacheReadTokens = readUint(5);
        if (inputTokens || outputTokens || cacheReadTokens || cacheWriteTokens) {
          entry.usage = {
            inputTokens,
            outputTokens,
            cacheWriteTokens,
            cacheReadTokens,
          };
        }
      }
    }

    if (plannerField && Buffer.isBuffer(plannerField.value)) {
      const pf = parseFields(plannerField.value);
      const responseText = readString(getField(pf, 1, 2)) ?? "";
      const modifiedText = readString(getField(pf, 8, 2)) ?? "";
      const thinkText = readString(getField(pf, 3, 2)) ?? "";
      entry.responseText = responseText;
      entry.modifiedText = modifiedText;
      entry.text = modifiedText || responseText;
      entry.thinking = thinkText;
    }

    // Errors live at field 24 (error_message wrapper) or 31 (error). Each
    // wraps CortexErrorDetails: user_error_message=1, short_error=2,
    // full_error=3.
    const readErrorDetails = (errBuf: Buffer): string => {
      const ed = parseFields(errBuf);
      for (const fnum of [1, 2, 3]) {
        const f = getField(ed, fnum, 2);
        const s = readString(f);
        if (s) {
          return s.split("\n")[0].slice(0, 300).trim();
        }
      }
      return "";
    };
    const errMsgField = getField(sf, 24, 2);
    if (errMsgField && Buffer.isBuffer(errMsgField.value)) {
      const inner = getField(parseFields(errMsgField.value), 3, 2);
      if (inner && Buffer.isBuffer(inner.value)) {
        entry.errorText = readErrorDetails(inner.value);
      }
    }
    if (!entry.errorText) {
      const errField = getField(sf, 31, 2);
      if (errField && Buffer.isBuffer(errField.value)) {
        entry.errorText = readErrorDetails(errField.value);
      }
    }

    results.push(entry);
  }

  return results;
}

// readBool re-export to suppress unused-import lint when callers extend this file
export { readBool };
