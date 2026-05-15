/**
 * Normalize pipeline for AddAccountRequest
 * @module services/addAccount/normalize
 */

export type CredentialMode = "oauth_pkce" | "refresh_token" | "api_key" | "mock_static";

export type AccountDraft = {
  label: string;
  credentialMode: CredentialMode;
  weight: number;
  enabled: boolean;
  maxConcurrency: number;
  allowedModels?: string[];
  tags?: string[];
  owner?: string;
};

export type AddAccountRequestParsed = {
  label: string;
  credentialMode: CredentialMode;
  weight?: number;
  enabled?: boolean;
  maxConcurrency?: number;
  allowedModels?: string[];
  tags?: string[];
  owner?: string;
};

/**
 * Normalize label: trim whitespace and collapse internal whitespace to single space.
 * Idempotent: normalizeLabel(normalizeLabel(x)) === normalizeLabel(x)
 */
export function normalizeLabel(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

/**
 * Normalize weight: clamp to [1, 100], floor decimals.
 * Default to 1 if undefined/null.
 * Idempotent: normalizeWeight(normalizeWeight(x)) === normalizeWeight(x)
 */
export function normalizeWeight(raw?: number | null): number {
  if (raw === undefined || raw === null) return 1;
  const floored = Math.floor(raw);
  return Math.max(1, Math.min(100, floored));
}

/**
 * Normalize full AddAccountRequest to AccountDraft.
 * Idempotent: normalize(normalize(x)) === normalize(x)
 */
export function normalizeAddAccountRequest(raw: AddAccountRequestParsed): AccountDraft {
  return {
    label: normalizeLabel(raw.label),
    credentialMode: raw.credentialMode,
    weight: normalizeWeight(raw.weight),
    enabled: raw.enabled ?? true,
    maxConcurrency: raw.maxConcurrency ?? 3,
    allowedModels: raw.allowedModels,
    tags: raw.tags,
    owner: raw.owner,
  };
}
