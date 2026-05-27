import type { AppConfig } from "../config.js";

export function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    nodeEnv: "test",
    port: 3100,
    host: "127.0.0.1",
    internalApiKeys: ["dev-key-1", "dev-key-2"],
    adminApiKeys: ["admin-key-1"],
    requestBodyLimit: "64b",
    dataFile: "data/test-gateway-state.json",
    internalRateLimitPerMinute: 0,
    internalDailyRequestQuota: 0,
    internalDailyTokenQuota: 0,
    addAccountRateLimitPerMinute: 10,
    logLevel: "silent",
    ...overrides
  };
}
