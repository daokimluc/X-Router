import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { buildApp } from "../app.js";
import { testConfig } from "./helpers.js";
import type { FastifyInstance } from "fastify";

describe("Spend snapshot endpoints (Phase 32)", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildApp(testConfig());
  });

  afterEach(async () => {
    await app.close();
  });

  it("GET /admin/v1/spend/key/:id requires admin auth", async () => {
    const r = await app.inject({ method: "GET", url: "/admin/v1/spend/key/abc" });
    expect(r.statusCode).toBe(401);
  });

  it("returns 404 for unknown key", async () => {
    const r = await app.inject({
      method: "GET",
      url: "/admin/v1/spend/key/never_seen",
      headers: { authorization: "Bearer admin-key-1" }
    });
    expect(r.statusCode).toBe(404);
    expect(r.json().error.code).toBe("key_not_found");
  });

  it("returns shape for an existing key with cap set", async () => {
    const created = app.apiKeyService.create({ owner: "test", dailySpendLimitUsd: 10 });
    const r = await app.inject({
      method: "GET",
      url: `/admin/v1/spend/key/${created.id}`,
      headers: { authorization: "Bearer admin-key-1" }
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.scope).toBe("key");
    expect(body.id).toBe(created.id);
    expect(body.day.cap).toBe(10);
    expect(body.day.spent).toBe(0);
    expect(body.day.remainingPct).toBe(100);
  });

  it("reflects live ledger after a reservation", async () => {
    const created = app.apiKeyService.create({ owner: "test", dailySpendLimitUsd: 10 });
    app.spendLedgerService.reserve({ scope: `key:${created.id}`, estimateUsd: 2.5, dayCap: 10 });

    const r = await app.inject({
      method: "GET",
      url: `/admin/v1/spend/key/${created.id}`,
      headers: { authorization: "Bearer admin-key-1" }
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.day.spent).toBe(2.5);
    expect(body.day.remainingPct).toBe(75);
  });

  it("returns null cap when key has no cap and no team", async () => {
    const created = app.apiKeyService.create({ owner: "test" });
    const r = await app.inject({
      method: "GET",
      url: `/admin/v1/spend/key/${created.id}`,
      headers: { authorization: "Bearer admin-key-1" }
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.day.cap).toBeNull();
    expect(body.month.cap).toBeNull();
    expect(body.day.remainingPct).toBeNull();
  });

  it("GET /admin/v1/spend/team/:id returns 404 when team missing", async () => {
    const r = await app.inject({
      method: "GET",
      url: "/admin/v1/spend/team/never",
      headers: { authorization: "Bearer admin-key-1" }
    });
    expect(r.statusCode).toBe(404);
    expect(r.json().error.code).toBe("team_not_found");
  });

  it("returns team snapshot when team exists", async () => {
    const team = app.teamService.create({ name: "Engineering", dailySpendLimitUsd: 50 });
    const r = await app.inject({
      method: "GET",
      url: `/admin/v1/spend/team/${team.id}`,
      headers: { authorization: "Bearer admin-key-1" }
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.scope).toBe("team");
    expect(body.id).toBe(team.id);
    expect(body.day.cap).toBe(50);
  });
});
