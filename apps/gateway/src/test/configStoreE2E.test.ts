import { describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { Database } from "../services/Database.js";
import { ConfigStore } from "../services/ConfigStore.js";
import { testConfig } from "./helpers.js";

/**
 * Boot the gateway with the SQLite ConfigStore as the persistence substrate
 * (no JSON file), then restart against the SAME Database and confirm state
 * survives — the row-level, JSON-free boot path (non-money-state-to-sqlite).
 */
describe("ConfigStore end-to-end persistence", () => {
  it("persists admin-created state across restarts via SQLite (no JSON file)", async () => {
    const db = new Database(":memory:");

    const first = await buildApp(testConfig({ requestBodyLimit: "8kb" }), {
      database: db,
      persistenceService: new ConfigStore(db)
    });

    let rawKey: string;
    try {
      rawKey = (
        await first.inject({
          method: "POST",
          url: "/admin/v1/api-keys",
          headers: { authorization: "Bearer admin-key-1" },
          payload: { owner: "sqlite-survivor" }
        })
      ).json().key as string;
      expect(rawKey).toBeTruthy();

      const createProvider = await first.inject({
        method: "POST",
        url: "/admin/v1/provider-instances",
        headers: { authorization: "Bearer admin-key-1" },
        payload: { id: "provider_sqlite", type: "kiro", name: "SQLite" }
      });
      expect(createProvider.statusCode).toBe(200);

      await first.persistenceService.drain();
    } finally {
      await first.close();
    }

    // Restart against the SAME Database (the JSON file was never touched).
    const second = await buildApp(testConfig({ requestBodyLimit: "8kb" }), {
      database: db,
      persistenceService: new ConfigStore(db)
    });
    try {
      expect(
        second.providerRuntimeRegistry.listProviderInstances().map((p) => p.id)
      ).toContain("provider_sqlite");

      // The raw key still authenticates a /v1 request after the SQLite reboot.
      const models = await second.inject({
        method: "GET",
        url: "/v1/models",
        headers: { authorization: `Bearer ${rawKey}` }
      });
      expect(models.statusCode).toBe(200);
    } finally {
      await second.close();
    }

    db.close();
  });
});
