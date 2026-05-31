import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { PersistenceService } from "../services/PersistenceService.js";
import { testConfig } from "./helpers.js";

const PROV = "prov-key-1";
const prov = { authorization: `Bearer ${PROV}` };

describe("provision persistence (gap #3 regression)", () => {
  const dirs: string[] = [];
  afterEach(async () => {
    while (dirs.length) {
      const d = dirs.pop();
      if (d) await rm(d, { recursive: true, force: true });
    }
  });

  it("a key created via /provision/key survives a restart", async () => {
    const directory = await mkdtemp(join(tmpdir(), "prov-persist-"));
    dirs.push(directory);
    const dataFile = join(directory, "state.json");
    const config = testConfig({ marketplaceEnabled: true, requestBodyLimit: "1mb", provisionApiKeys: [PROV], dataFile });

    let keyId: string;
    let app1: FastifyInstance | undefined;
    try {
      app1 = await buildApp(config, { persistenceService: new PersistenceService(dataFile) });
      const created = await app1.inject({ method: "POST", url: "/provision/key", headers: prov, payload: { label: "buyer1", planId: "plan_claude" } });
      expect(created.statusCode).toBe(200);
      keyId = created.json().id;
    } finally {
      if (app1) await app1.close();
    }

    // Fresh app instance over the same state file — the key must still be there.
    const app2 = await buildApp(config, { persistenceService: new PersistenceService(dataFile) });
    try {
      const list = await app2.inject({ method: "GET", url: "/provision/keys", headers: prov });
      const ids = list.json().keys.map((k: { id: string }) => k.id);
      expect(ids).toContain(keyId);
      const restored = list.json().keys.find((k: { id: string }) => k.id === keyId);
      expect(restored.planId).toBe("plan_claude");
      expect(restored.owner).toBe("buyer1");
    } finally {
      await app2.close();
    }
  });
});

describe("ApiKeyService id collision (gap #5 regression)", () => {
  it("create after delete does not reuse a live id", async () => {
    // Construct via buildApp so we get a real ApiKeyService; use admin to create/delete.
    const app = await buildApp(testConfig({ marketplaceEnabled: true, requestBodyLimit: "1mb", provisionApiKeys: [PROV] }));
    try {
      const a = app.apiKeyService.create({ owner: "a" });
      const b = app.apiKeyService.create({ owner: "b" });
      expect(a.id).not.toBe(b.id);
      app.apiKeyService.delete(b.id);
      const c = app.apiKeyService.create({ owner: "c" });
      // c must NOT collide with the still-live `a` (size shrank after delete).
      expect(c.id).not.toBe(a.id);
      expect(c.id).not.toBe(b.id);
    } finally {
      await app.close();
    }
  });
});
