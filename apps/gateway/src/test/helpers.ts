import type { AppConfig } from "../config.js";
import { Database } from "../services/Database.js";

export function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    nodeEnv: "test",
    port: 3100,
    host: "127.0.0.1",
    internalApiKeys: ["dev-key-1", "dev-key-2"],
    adminApiKeys: ["admin-key-1"],
    provisionApiKeys: [],
    provisionRateLimitPerMinute: 0,
    requestBodyLimit: "64b",
    dataFile: "data/test-gateway-state.json",
    internalRateLimitPerMinute: 0,
    internalDailyRequestQuota: 0,
    internalDailyTokenQuota: 0,
    addAccountRateLimitPerMinute: 10,
    logLevel: "silent",
    marketplaceEnabled: false,
    encryptionKey: "development-local-secret-key",
    fallbackCostPer1kUsd: 0.001,
    maxTopupUsd: 100_000,
    maxPackTokens: 10_000_000_000,
    maxPackHorizonMs: 2 * 365 * 24 * 60 * 60_000,
    ...overrides
  };
}

/** In-memory SQLite for unit tests (money services need a Database). */
export function makeTestDb(): Database {
  return new Database(":memory:");
}

