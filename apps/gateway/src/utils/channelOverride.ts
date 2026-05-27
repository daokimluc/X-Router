/**
 * Channel-level overrides for upstream requests (Phase 20b).
 *
 * paramOverride: shallow-merged into request body before serialization.
 * headerOverride: case-insensitive header injection. Reserved keys ignored.
 * statusCodeMapping: persisted only this phase; routing/auto-disable defer.
 */

import type { ProviderInstance } from "../providers/base/ProviderInstance.js";

export const RESERVED_HEADER_KEYS = new Set([
  "authorization",
  "content-type",
  "content-length",
  "host",
  "connection",
  "transfer-encoding",
]);

export function applyChannelOverrides(
  body: Record<string, unknown>,
  headers: Record<string, string>,
  instance: ProviderInstance
): { body: Record<string, unknown>; headers: Record<string, string> } {
  const finalBody = instance.paramOverride && Object.keys(instance.paramOverride).length > 0
    ? { ...body, ...instance.paramOverride }
    : body;

  if (!instance.headerOverride || Object.keys(instance.headerOverride).length === 0) {
    return { body: finalBody, headers };
  }

  // Build a case-insensitive lookup of existing headers so that an
  // override key (any case) replaces the existing one instead of
  // creating a duplicate header with different casing.
  const finalHeaders: Record<string, string> = {};
  const lowerToOriginal = new Map<string, string>();
  for (const [key, value] of Object.entries(headers)) {
    finalHeaders[key] = value;
    lowerToOriginal.set(key.toLowerCase(), key);
  }

  for (const [key, value] of Object.entries(instance.headerOverride)) {
    const lower = key.toLowerCase();
    if (RESERVED_HEADER_KEYS.has(lower)) continue;
    const existingKey = lowerToOriginal.get(lower);
    if (existingKey && existingKey !== key) {
      // Replace existing header (different case) — drop old, set new.
      delete finalHeaders[existingKey];
    }
    finalHeaders[key] = value;
    lowerToOriginal.set(lower, key);
  }
  return { body: finalBody, headers: finalHeaders };
}

/**
 * Validates a status-code mapping key. Accepts "NNN" (100-599) or "Nxx"
 * where N is 1-5.
 */
export function isValidStatusCodeMappingKey(key: string): boolean {
  if (/^[1-5]xx$/i.test(key)) return true;
  if (!/^\d{3}$/.test(key)) return false;
  const code = Number.parseInt(key, 10);
  return code >= 100 && code <= 599;
}

/**
 * Detects reserved header conflicts in an override map.
 * Returns the offending original keys (for an actionable error message).
 */
export function validateHeaderOverride(
  headers: Record<string, string>
): { valid: boolean; reservedConflicts: string[] } {
  const conflicts: string[] = [];
  for (const key of Object.keys(headers)) {
    if (RESERVED_HEADER_KEYS.has(key.toLowerCase())) {
      conflicts.push(key);
    }
  }
  return { valid: conflicts.length === 0, reservedConflicts: conflicts };
}

/**
 * Phase 20c — interpret an upstream HTTP status against the instance's
 * statusCodeMapping. Exact match wins over family match (e.g. "401" beats "4xx").
 * Returns "passthrough" when there's no mapping or no match.
 */
export function interpretStatusCode(
  instance: ProviderInstance,
  statusCode: number
): "retry" | "disable" | "passthrough" {
  const mapping = instance.statusCodeMapping;
  if (!mapping) return "passthrough";
  const exactKey = String(statusCode);
  if (mapping[exactKey]) return mapping[exactKey];
  const family = `${Math.floor(statusCode / 100)}xx`;
  if (mapping[family]) return mapping[family];
  return "passthrough";
}

/**
 * Phase 25 — Approximate token count by character count / 4 (rough English heuristic).
 * Used for `maxInputTokens` enforcement before forwarding upstream.
 */
export function estimateRequestTokens(body: Record<string, unknown>): number {
  let chars = 0;
  const visit = (val: unknown): void => {
    if (typeof val === "string") {
      chars += val.length;
      return;
    }
    if (Array.isArray(val)) {
      for (const item of val) visit(item);
      return;
    }
    if (val && typeof val === "object") {
      for (const v of Object.values(val as Record<string, unknown>)) visit(v);
    }
  };
  visit(body.messages);
  visit(body.system);
  visit(body.input);
  visit(body.prompt);
  return Math.ceil(chars / 4);
}

/**
 * Phase 25 — error thrown when a request exceeds `instance.maxInputTokens`.
 */
export class MaxInputTokensExceededError extends Error {
  readonly statusCode = 400;
  readonly code = "max_input_tokens_exceeded";
  constructor(public readonly limit: number, public readonly estimated: number) {
    super(`Request exceeds max_input_tokens: estimated ${estimated} > limit ${limit}`);
    this.name = "MaxInputTokensExceededError";
  }
}

/**
 * Phase 25 — Enforce maxInputTokens (rough heuristic) and inject systemPromptOverride.
 * Mutates a shallow copy of the body when systemPromptOverride is set.
 *
 * For OpenAI chat: prepend a system message at index 0 (or replace existing system msg).
 * For Anthropic: set/override top-level `system` string.
 * Other shapes: no-op.
 */
export function applyChannelInputPolicies(
  body: Record<string, unknown>,
  instance: ProviderInstance
): Record<string, unknown> {
  let result = body;

  if (instance.systemPromptOverride) {
    const sys = instance.systemPromptOverride;
    // Anthropic shape: top-level `system` field present (string or array).
    // Detected when body has both messages and system field, or only system field.
    const hasAnthropicSystem = "system" in body;
    if (hasAnthropicSystem) {
      result = { ...result, system: sys };
    } else if (Array.isArray(body.messages)) {
      const messages = (body.messages as Array<Record<string, unknown>>).slice();
      const firstIsSystem = messages[0]?.role === "system";
      if (firstIsSystem) {
        messages[0] = { ...messages[0], content: sys };
      } else {
        messages.unshift({ role: "system", content: sys });
      }
      result = { ...result, messages };
    }
  }

  if (typeof instance.maxInputTokens === "number" && instance.maxInputTokens > 0) {
    const estimated = estimateRequestTokens(result);
    if (estimated > instance.maxInputTokens) {
      throw new MaxInputTokensExceededError(instance.maxInputTokens, estimated);
    }
  }

  return result;
}
