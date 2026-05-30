import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { PersistenceService } from "../services/PersistenceService.js";
import { testConfig } from "./helpers.js";

const ADMIN = "admin-key-1";
const apps: FastifyInstance[] = [];

afterEach(async () => {
  while (apps.length) {
    const a = apps.pop();
    if (a) await a.close();
  }
});

async function build(persistenceService?: PersistenceService) {
  const app = await buildApp(testConfig({ marketplaceEnabled: true, requestBodyLimit: "1mb" }), { persistenceService });
  await app.ready();
  apps.push(app);
  return app;
}

describe("seller-supply wiring", () => {
  it("approve seller + create listing → direct and pooled both resolve", async () => {
    const app = await build();

    // Register + approve a seller
    const reg = await app.inject({ method: "POST", url: "/admin/v1/sellers", headers: { authorization: `Bearer ${ADMIN}` }, payload: { displayName: "hoang", commissionPct: 0.08 } });
    expect(reg.statusCode).toBe(200);
    const sellerId = reg.json().seller.id;
    await app.inject({ method: "POST", url: `/admin/v1/sellers/${sellerId}/approve`, headers: { authorization: `Bearer ${ADMIN}` } });

    // Create a listing for canonical gpt-5.5
    const created = await app.inject({
      method: "POST",
      url: "/admin/v1/listings",
      headers: { authorization: `Bearer ${ADMIN}` },
      payload: { sellerId, baseModel: "gpt-5.5", costPrice: { inputPerM: 2.4, outputPerM: 7 }, providerInstanceId: "provider_kiro_main", providerAccountId: "acct_1" }
    });
    expect(created.statusCode).toBe(200);

    // Both names resolve in the registry
    expect(app.modelRegistry.getAll("hoang/gpt-5.5").length).toBeGreaterThan(0);
    expect(app.modelRegistry.getAll("gpt-5.5").length).toBeGreaterThan(0);

    // Disable → both removed
    const listingId = created.json().listing.id;
    await app.inject({ method: "PATCH", url: `/admin/v1/listings/${listingId}`, headers: { authorization: `Bearer ${ADMIN}` }, payload: { enabled: false } });
    expect(app.modelRegistry.getAll("hoang/gpt-5.5").length).toBe(0);
  });

  it("pending seller cannot create a listing (400)", async () => {
    const app = await build();
    const reg = await app.inject({ method: "POST", url: "/admin/v1/sellers", headers: { authorization: `Bearer ${ADMIN}` }, payload: { displayName: "pendingguy" } });
    const sellerId = reg.json().seller.id;
    const res = await app.inject({
      method: "POST",
      url: "/admin/v1/listings",
      headers: { authorization: `Bearer ${ADMIN}` },
      payload: { sellerId, baseModel: "gpt-5.5", costPrice: { inputPerM: 1, outputPerM: 1 }, providerInstanceId: "provider_kiro_main", providerAccountId: "acct_1" }
    });
    expect(res.statusCode).toBe(400);
  });

  it("migrates a legacy provider account (no sellerId) to house", async () => {
    const dir = mkdtempSync(join(tmpdir(), "seller-mig-"));
    const file = join(dir, "state.json");
    writeFileSync(
      file,
      JSON.stringify({
        providerInstances: [],
        accounts: [
          { id: "acct_legacy", providerInstanceId: "p1", providerType: "kiro", displayName: "legacy", status: "active", weight: 1, maxConcurrency: 1, credentialRef: "c1", owner: "team-dev", runtime: { activeRequests: 0, totalRequests: 0, failedRequests: 0, consecutiveFailures: 0 }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
        ]
      }),
      "utf8"
    );
    const persistenceService = new PersistenceService(file);
    const loaded = await persistenceService.load();
    expect(loaded?.accounts[0].sellerId).toBe("house");
    rmSync(dir, { recursive: true, force: true });
  });
});
