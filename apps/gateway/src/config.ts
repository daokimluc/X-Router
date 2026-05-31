import { z } from "zod";

export type AppConfig = {
  nodeEnv: "development" | "test" | "production";
  port: number;
  host: string;
  internalApiKeys: string[];
  adminApiKeys: string[];
  /**
   * provision-webhook (#7) — website-facing automation keys for the /provision/*
   * command surface. A third auth dimension, separate from admin + internal
   * keys. Snapshot at startup (not runtime-mutable like the admin password).
   */
  provisionApiKeys: string[];
  /**
   * provision-hardening (#5) — per-minute cap on privileged mutating /provision/*
   * routes (create-key, wallet/topup, grant, mark-paid), per provision key. 0
   * disables the limit (trusted single-tenant). Default 120 (generous).
   */
  provisionRateLimitPerMinute: number;
  requestBodyLimit: string;
  logLevel: "fatal" | "error" | "warn" | "info" | "debug" | "trace" | "silent";
  dataFile: string;
  internalRateLimitPerMinute: number;
  internalDailyRequestQuota: number;
  internalDailyTokenQuota: number;
  addAccountRateLimitPerMinute: number;
  /**
   * Commercial marketplace layer (wallet, plans, sellers, settlement, provision).
   * Off by default → the gateway runs as the plain self-host engine. When false,
   * no marketplace code is loaded (see app.ts dynamic import). This is the single
   * flag that separates the open-core engine from the proprietary marketplace.
   */
  marketplaceEnabled: boolean;
  /**
   * Key used to encrypt secrets at rest (provider credentials + business-webhook
   * secret). Defaults to a well-known dev key; production MUST override it via
   * `ENCRYPTION_KEY` or the gateway refuses to start. Rotating it makes existing
   * ciphertext unreadable (re-enter secrets).
   */
  encryptionKey: string;
};

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3100),
  HOST: z.string().min(1).default("0.0.0.0"),
  ADMIN_API_KEYS: z.string().default(""),
  PROVISION_API_KEYS: z.string().default(""),
  PROVISION_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(0).default(120),
  REQUEST_BODY_LIMIT: z.string().min(1).default("1mb"),
  DATA_FILE: z.string().min(1).default("data/gateway-state.json"),
  INTERNAL_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(0).default(0),
  INTERNAL_DAILY_REQUEST_QUOTA: z.coerce.number().int().min(0).default(0),
  INTERNAL_DAILY_TOKEN_QUOTA: z.coerce.number().int().min(0).default(0),
  ADD_ACCOUNT_RATE_LIMIT_PER_MIN: z.string().optional(),
  MARKETPLACE_ENABLED: z
    .enum(["true", "false"])
    .default("false"),
  ENCRYPTION_KEY: z.string().optional(),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info")
});

/** Well-known development key for secrets-at-rest. MUST be overridden in production. */
export const DEFAULT_ENCRYPTION_KEY = "development-local-secret-key";

function parseCsv(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

/**
 * Parse ADD_ACCOUNT_RATE_LIMIT_PER_MIN environment variable.
 * Default: 10 requests per minute.
 * Fail-fast if invalid (≤ 0, non-integer, NaN).
 */
export function parseAddAccountRateLimit(raw?: string): number {
  if (!raw || raw.trim() === "") {
    return 10; // default
  }

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0 || Number.isNaN(parsed)) {
    throw new Error(
      `Invalid ADD_ACCOUNT_RATE_LIMIT_PER_MIN: expected positive integer, got "${raw}"`
    );
  }

  return parsed;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.parse(env);
  const adminApiKeys = parseCsv(parsed.ADMIN_API_KEYS);

  if (parsed.NODE_ENV === "production" && adminApiKeys.length === 0) {
    throw new Error("ADMIN_API_KEYS must contain at least one key in production");
  }

  // Secrets-at-rest key. Production must override the dev default, else any reader
  // of the state file can decrypt credentials + the webhook secret.
  const encryptionKey = parsed.ENCRYPTION_KEY?.trim() || DEFAULT_ENCRYPTION_KEY;
  if (parsed.NODE_ENV === "production" && encryptionKey === DEFAULT_ENCRYPTION_KEY) {
    throw new Error("ENCRYPTION_KEY must be set to a non-default value in production");
  }

  return {
    nodeEnv: parsed.NODE_ENV,
    port: parsed.PORT,
    host: parsed.HOST,
    internalApiKeys: [], // legacy field; client API keys live in ApiKeyService now
    adminApiKeys:
      adminApiKeys.length > 0 || parsed.NODE_ENV === "production"
        ? adminApiKeys
        : ["admin-key-1"],
    provisionApiKeys: parseCsv(parsed.PROVISION_API_KEYS),
    provisionRateLimitPerMinute: parsed.PROVISION_RATE_LIMIT_PER_MINUTE,
    requestBodyLimit: parsed.REQUEST_BODY_LIMIT,
    logLevel: parsed.LOG_LEVEL,
    dataFile: parsed.DATA_FILE,
    internalRateLimitPerMinute: parsed.INTERNAL_RATE_LIMIT_PER_MINUTE,
    internalDailyRequestQuota: parsed.INTERNAL_DAILY_REQUEST_QUOTA,
    internalDailyTokenQuota: parsed.INTERNAL_DAILY_TOKEN_QUOTA,
    addAccountRateLimitPerMinute: parseAddAccountRateLimit(parsed.ADD_ACCOUNT_RATE_LIMIT_PER_MIN),
    marketplaceEnabled: parsed.MARKETPLACE_ENABLED === "true",
    encryptionKey
  };
}
