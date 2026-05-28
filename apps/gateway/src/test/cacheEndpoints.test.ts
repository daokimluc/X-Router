import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { buildApp } from "../app.js";
import { testConfig } from "./helpers.js";
import type { FastifyInstance } from "fastify";

describe("Cache admin endpoints (Phase 32)", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildApp(testConfig());
  });

  afterEach(async () => {
    await app.close();
  });

  it("GET /admin/v1/cache/stats requires admin auth", async () => {
    const r = await app.inject({ method: "GET", url: "/admin/v1/cache/stats" });
    expect(r.statusCode).toBe(401);
  });

  it("returns zero stats when cache is empty", async () => {
    const r = await app.inject({
      method: "GET",
      url: "/admin/v1/cache/stats",
      headers: { authorization: "Bearer admin-key-1" }
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.entries).toBe(0);
    expect(body.bytesUsed).toBe(0);
    expect(body.hits).toBe(0);
    expect(body.misses).toBe(0);
    expect(body.hitRatio).toBe(0);
    expect(body.topHot).toEqual([]);
  });

  it("reflects cache state after writes and reads", async () => {
    app.responseCacheService.write("key1", { hello: "world" }, "gpt-4o");
    app.responseCacheService.read("key1");
    app.responseCacheService.read("missing");

    const r = await app.inject({
      method: "GET",
      url: "/admin/v1/cache/stats",
      headers: { authorization: "Bearer admin-key-1" }
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.entries).toBe(1);
    expect(body.hits).toBe(1);
    expect(body.misses).toBe(1);
    expect(body.hitRatio).toBe(0.5);
  });

  it("DELETE /admin/v1/cache flushes all", async () => {
    app.responseCacheService.write("a", { v: 1 }, "m");
    app.responseCacheService.write("b", { v: 2 }, "m");

    const r = await app.inject({
      method: "DELETE",
      url: "/admin/v1/cache",
      headers: { authorization: "Bearer admin-key-1" }
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().cleared).toBe(2);
    expect(app.responseCacheService.size()).toBe(0);
  });

  it("DELETE /admin/v1/cache/:keyPrefix flushes only matching", async () => {
    app.responseCacheService.write("abc123", { v: 1 }, "m");
    app.responseCacheService.write("abc456", { v: 2 }, "m");
    app.responseCacheService.write("xyz789", { v: 3 }, "m");

    const r = await app.inject({
      method: "DELETE",
      url: "/admin/v1/cache/abc",
      headers: { authorization: "Bearer admin-key-1" }
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().cleared).toBe(2);
    expect(app.responseCacheService.size()).toBe(1);
  });

  it("DELETE /admin/v1/cache requires admin auth", async () => {
    const r = await app.inject({ method: "DELETE", url: "/admin/v1/cache" });
    expect(r.statusCode).toBe(401);
  });
});
