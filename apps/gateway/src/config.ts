import { z } from "zod";

export type AppConfig = {
  nodeEnv: "development" | "test" | "production";
  port: number;
  host: string;
  internalApiKeys: string[];
  adminApiKeys: string[];
  requestBodyLimit: string;
  logLevel: "fatal" | "error" | "warn" | "info" | "debug" | "trace" | "silent";
  dataFile: string;
  internalRateLimitPerMinute: number;
  internalDailyRequestQuota: number;
  addAccountRateLimitPerMinute: number;
};

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3100),
  HOST: z.string().min(1).default("0.0.0.0"),
  INTERNAL_API_KEYS: z.string().default("dev-key-1,dev-key-2"),
  ADMIN_API_KEYS: z.string().default(""),
  REQUEST_BODY_LIMIT: z.string().min(1).default("1mb"),
  DATA_FILE: z.string().min(1).default("data/gateway-state.json"),
  INTERNAL_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(0).default(0),
  INTERNAL_DAILY_REQUEST_QUOTA: z.coerce.number().int().min(0).default(0),
  ADD_ACCOUNT_RATE_LIMIT_PER_MIN: z.string().optional(),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info")
});

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
  const internalApiKeys = parseCsv(parsed.INTERNAL_API_KEYS);
  const adminApiKeys = parseCsv(parsed.ADMIN_API_KEYS);

  if (internalApiKeys.length === 0) {
    throw new Error("INTERNAL_API_KEYS must contain at least one key");
  }

  if (parsed.NODE_ENV === "production" && adminApiKeys.length === 0) {
    throw new Error("ADMIN_API_KEYS must contain at least one key in production");
  }

  return {
    nodeEnv: parsed.NODE_ENV,
    port: parsed.PORT,
    host: parsed.HOST,
    internalApiKeys,
    adminApiKeys:
      adminApiKeys.length > 0 || parsed.NODE_ENV === "production"
        ? adminApiKeys
        : ["admin-key-1"],
    requestBodyLimit: parsed.REQUEST_BODY_LIMIT,
    logLevel: parsed.LOG_LEVEL,
    dataFile: parsed.DATA_FILE,
    internalRateLimitPerMinute: parsed.INTERNAL_RATE_LIMIT_PER_MINUTE,
    internalDailyRequestQuota: parsed.INTERNAL_DAILY_REQUEST_QUOTA,
    addAccountRateLimitPerMinute: parseAddAccountRateLimit(parsed.ADD_ACCOUNT_RATE_LIMIT_PER_MIN)
  };
}
