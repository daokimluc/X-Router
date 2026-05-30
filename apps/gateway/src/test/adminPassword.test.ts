import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../app.js";
import { AdminKeyService, DEFAULT_ADMIN_KEY } from "../services/AdminKeyService.js";
import { testConfig } from "./helpers.js";

describe("AdminKeyService", () => {
  let dir: string;
  let persistPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "xr-adminkey-"));
    persistPath = join(dir, "config.json");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("mutates the same array instance so live readers see changes", () => {
    const keys = ["secret-old"];
    const svc = new AdminKeyService(keys, { persistPath });

    expect(svc.isValid("secret-old")).toBe(true);
    svc.setKey("brand-new-key");

    // Same array reference — what config.adminApiKeys points to is updated.
    expect(keys).toEqual(["brand-new-key"]);
    expect(svc.isValid("secret-old")).toBe(false);
    expect(svc.isValid("brand-new-key")).toBe(true);
  });

  it("persists to config.json in CLI-readable shape (comma-separated string)", () => {
    const svc = new AdminKeyService(["x"], { persistPath });
    svc.setKey("newpass");

    const saved = JSON.parse(readFileSync(persistPath, "utf8"));
    expect(saved.adminApiKeys).toBe("newpass");
  });

  it("rejects keys shorter than 4 characters", () => {
    const svc = new AdminKeyService(["x".repeat(8)], { persistPath });
    expect(() => svc.setKey("abc")).toThrow();
  });

  it("isDefault is true only when the sole key is 'admin'", () => {
    expect(new AdminKeyService([DEFAULT_ADMIN_KEY], { persistPath }).isDefault()).toBe(true);
    expect(new AdminKeyService(["something"], { persistPath }).isDefault()).toBe(false);
    expect(new AdminKeyService(["admin", "other"], { persistPath }).isDefault()).toBe(false);
  });

  it("reset() returns to default and persists", () => {
    const keys = ["custom-key"];
    const svc = new AdminKeyService(keys, { persistPath });
    svc.reset();

    expect(keys).toEqual([DEFAULT_ADMIN_KEY]);
    expect(svc.isDefault()).toBe(true);
    const saved = JSON.parse(readFileSync(persistPath, "utf8"));
    expect(saved.adminApiKeys).toBe(DEFAULT_ADMIN_KEY);
  });
});

describe("admin password endpoints", () => {
  let dir: string;
  let persistPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "xr-pwendpoint-"));
    persistPath = join(dir, "config.json");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  async function buildWithAdminKey() {
    const config = testConfig();
    const adminKeyService = new AdminKeyService(config.adminApiKeys, { persistPath });
    const app = await buildApp(config, { adminKeyService });
    return app;
  }

  it("change-password rejects wrong current password", async () => {
    const app = await buildWithAdminKey();
    const res = await app.inject({
      method: "POST",
      url: "/admin/v1/settings/change-password",
      headers: { authorization: "Bearer admin-key-1" },
      payload: { currentPassword: "wrong", newPassword: "newsecret" }
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().success).toBe(false);
    await app.close();
  });

  it("change-password updates the live key and the old key stops working", async () => {
    const app = await buildWithAdminKey();
    const change = await app.inject({
      method: "POST",
      url: "/admin/v1/settings/change-password",
      headers: { authorization: "Bearer admin-key-1" },
      payload: { currentPassword: "admin-key-1", newPassword: "newsecret" }
    });
    expect(change.statusCode).toBe(200);
    expect(change.json().success).toBe(true);

    // Old key now rejected
    const oldKey = await app.inject({
      method: "GET",
      url: "/admin/v1/provider-types",
      headers: { authorization: "Bearer admin-key-1" }
    });
    expect(oldKey.statusCode).toBe(401);

    // New key works without restart
    const newKey = await app.inject({
      method: "GET",
      url: "/admin/v1/provider-types",
      headers: { authorization: "Bearer newsecret" }
    });
    expect(newKey.statusCode).toBe(200);
    await app.close();
  });

  it("reset-password sets key back to admin", async () => {
    const app = await buildWithAdminKey();
    // First change it away from the test default
    await app.inject({
      method: "POST",
      url: "/admin/v1/settings/change-password",
      headers: { authorization: "Bearer admin-key-1" },
      payload: { currentPassword: "admin-key-1", newPassword: "temppass" }
    });
    const reset = await app.inject({
      method: "POST",
      url: "/admin/v1/settings/reset-password",
      headers: { authorization: "Bearer temppass" },
      payload: {}
    });
    expect(reset.statusCode).toBe(200);
    expect(reset.json().defaultPassword).toBe(DEFAULT_ADMIN_KEY);

    const login = await app.inject({
      method: "GET",
      url: "/admin/v1/provider-types",
      headers: { authorization: "Bearer admin" }
    });
    expect(login.statusCode).toBe(200);
    await app.close();
  });

  it("public auth-info reveals default only when still default", async () => {
    const config = testConfig({ adminApiKeys: ["admin"] });
    const svc = new AdminKeyService(config.adminApiKeys, { persistPath });
    const app = await buildApp(config, { adminKeyService: svc });

    const before = await app.inject({ method: "GET", url: "/v1/public/auth-info" });
    expect(before.json()).toEqual({ isDefaultPassword: true, defaultPassword: "admin", marketplaceEnabled: false });

    svc.setKey("nolongerdefault");
    const after = await app.inject({ method: "GET", url: "/v1/public/auth-info" });
    expect(after.json()).toEqual({ isDefaultPassword: false, defaultPassword: null, marketplaceEnabled: false });
    await app.close();
  });
});
