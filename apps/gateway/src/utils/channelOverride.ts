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

  const finalHeaders = { ...headers };
  for (const [key, value] of Object.entries(instance.headerOverride)) {
    const lower = key.toLowerCase();
    if (RESERVED_HEADER_KEYS.has(lower)) continue;
    finalHeaders[key] = value;
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
