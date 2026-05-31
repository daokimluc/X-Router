import { describe, expect, it } from "vitest";
import { loadConfig, DEFAULT_ENCRYPTION_KEY } from "../config.js";

const base = {
  NODE_ENV: "production",
  ADMIN_API_KEYS: "admin-1",
  ENCRYPTION_KEY: "a-strong-production-key"
} as NodeJS.ProcessEnv;

describe("loadConfig — encryption key guard", () => {
  it("accepts a non-default ENCRYPTION_KEY in production", () => {
    const cfg = loadConfig({ ...base });
    expect(cfg.encryptionKey).toBe("a-strong-production-key");
  });

  it("rejects the default ENCRYPTION_KEY in production", () => {
    expect(() => loadConfig({ ...base, ENCRYPTION_KEY: DEFAULT_ENCRYPTION_KEY }))
      .toThrow(/ENCRYPTION_KEY must be set/);
  });

  it("rejects a missing ENCRYPTION_KEY in production (falls back to default → blocked)", () => {
    const { ENCRYPTION_KEY: _omit, ...noKey } = base as Record<string, string>;
    expect(() => loadConfig(noKey as NodeJS.ProcessEnv)).toThrow(/ENCRYPTION_KEY must be set/);
  });

  it("allows the default key outside production (dev/test)", () => {
    const cfg = loadConfig({ NODE_ENV: "development", ADMIN_API_KEYS: "admin-1" } as NodeJS.ProcessEnv);
    expect(cfg.encryptionKey).toBe(DEFAULT_ENCRYPTION_KEY);
  });
});
