import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { PersistenceService } from "../services/PersistenceService.js";
import { ApiKeyService } from "../services/ApiKeyService.js";
import { testConfig } from "./helpers.js";

const ADMIN = "admin-key-1";
const apps: FastifyInstance[] = [];

afterEach(async () => {
  while (apps.length) {
    const a = apps.pop();
    if (a) await a.close();
  }
});

async function build(opts: { marketplaceEnabled?: boolean; persistenceService?: PersistenceService; apiKeyService?: ApiKeyService } = {}) {
  const app = await buildApp(
    testConfig({ marketplaceEnabled: opts.marketplaceEnabled ?? true, requestBodyLimit: "1mb" }),
    { persistenceService: opts.persistenceService, apiKeyService: opts.apiKeyService }
  );
  await app.ready();
  apps.push(app);
  return app;
}

describe("usd-wallet marketplace wiring", () => {
  it("does NOT register wallet endpoints when marketplace is off", async () => {
    const app = await build({ marketplaceEnabled: false });
    const apiKeyService = app.apiKeyService;
    const created = apiKeyService.create({});
    const res = await app.inject({
      method: "POST",
      url: `/admin/v1/api-keys/${created.id}/topup`,
      headers: { authorization: `Bearer ${ADMIN}` },
      payload: { amountUsd: 5 }
    });
    // The engine no longer defines this route; with marketplace off the request
    // falls through to the dashboard SPA fallback (HTML), never the JSON wallet
    // handler. No wallet service is decorated either.
    expect(res.headers["content-type"]).toContain("text/html");
    expect((app as unknown as { walletService?: unknown }).walletService).toBeUndefined();
  });

  it("USD topup increases wallet balance and persists", async () => {
    const app = await build({ marketplaceEnabled: true });
    const created = app.apiKeyService.create({});

    const top = await app.inject({
      method: "POST",
      url: `/admin/v1/api-keys/${created.id}/topup`,
      headers: { authorization: `Bearer ${ADMIN}` },
      payload: { amountUsd: 5 }
    });
    expect(top.statusCode).toBe(200);
    expect(top.json()).toMatchObject({ id: created.id, walletUsd: 5, addedUsd: 5 });

    const get = await app.inject({
      method: "GET",
      url: `/admin/v1/api-keys/${created.id}/wallet`,
      headers: { authorization: `Bearer ${ADMIN}` }
    });
    expect(get.json()).toMatchObject({ walletUsd: 5, provisioned: true });
  });

  it("topup rejects non-positive amountUsd", async () => {
    const app = await build({ marketplaceEnabled: true });
    const created = app.apiKeyService.create({});
    const res = await app.inject({
      method: "POST",
      url: `/admin/v1/api-keys/${created.id}/topup`,
      headers: { authorization: `Bearer ${ADMIN}` },
      payload: { amountUsd: 0 }
    });
    expect(res.statusCode).toBe(400);
  });

  it("migrates a legacy token balance to a $0 provisioned wallet", async () => {
    // Persist a state file with a key carrying a legacy token `balance`.
    const dir = mkdtempSync(join(tmpdir(), "wallet-mig-"));
    const file = join(dir, "state.json");
    writeFileSync(
      file,
      JSON.stringify({
        apiKeys: [
          { id: "internal_key_1", key: "igw_legacy", keyHash: "h1", enabled: true, balance: 50000, createdAt: new Date().toISOString() }
        ]
      }),
      "utf8"
    );

    const persistenceService = new PersistenceService(file);
    const app = await build({ marketplaceEnabled: true, persistenceService });

    expect(app.walletService.isProvisioned("internal_key_1")).toBe(true);
    expect(app.walletService.getUsd("internal_key_1")).toBe(0);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("marketplace-plans admin wiring", () => {
  it("lists seeded plans and supports CRUD + key assignment", async () => {
    const app = await build({ marketplaceEnabled: true });

    const list = await app.inject({
      method: "GET",
      url: "/admin/v1/plans",
      headers: { authorization: `Bearer ${ADMIN}` }
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().plans).toHaveLength(4);

    // Create
    const created = await app.inject({
      method: "POST",
      url: "/admin/v1/plans",
      headers: { authorization: `Bearer ${ADMIN}` },
      payload: { name: "Test", priceUsd: 5, modelGroups: ["claude"], buckets: { hourUsd: 1, dayUsd: 2, monthUsd: 3 }, overageEnabled: false }
    });
    expect(created.statusCode).toBe(200);
    const planId = created.json().plan.id;

    // Assign to a key
    const key = app.apiKeyService.create({});
    const assign = await app.inject({
      method: "PATCH",
      url: `/admin/v1/keys/${key.id}/plan`,
      headers: { authorization: `Bearer ${ADMIN}` },
      payload: { planId, overageEnabled: true, paygDailyLimitUsd: 2.5 }
    });
    expect(assign.statusCode).toBe(200);
    expect(assign.json()).toMatchObject({ planId, overageEnabled: true, paygDailyLimitUsd: 2.5 });

    // Assigning a non-existent plan → 400
    const bad = await app.inject({
      method: "PATCH",
      url: `/admin/v1/keys/${key.id}/plan`,
      headers: { authorization: `Bearer ${ADMIN}` },
      payload: { planId: "plan_does_not_exist" }
    });
    expect(bad.statusCode).toBe(400);

    // Delete
    const del = await app.inject({
      method: "DELETE",
      url: `/admin/v1/plans/${planId}`,
      headers: { authorization: `Bearer ${ADMIN}` }
    });
    expect(del.statusCode).toBe(200);
  });
});
