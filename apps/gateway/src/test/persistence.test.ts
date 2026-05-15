import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { PersistenceService } from "../services/PersistenceService.js";
import { testConfig } from "./helpers.js";

describe("Persistence", () => {
  it("persists admin-created runtime state across app restarts", async () => {
    const directory = await mkdtemp(join(tmpdir(), "gateway-state-"));
    const dataFile = join(directory, "state.json");
    const config = testConfig({ dataFile, requestBodyLimit: "4kb" });

    try {
      const firstApp = await buildApp(config, {
        persistenceService: new PersistenceService(dataFile)
      });

      const createKey = await firstApp.inject({
        method: "POST",
        url: "/admin/v1/api-keys",
        headers: {
          authorization: "Bearer admin-key-1"
        },
        payload: {
          owner: "persisted"
        }
      });
      const rawKey = createKey.json().key;

      const createProvider = await firstApp.inject({
        method: "POST",
        url: "/admin/v1/provider-instances",
        headers: {
          authorization: "Bearer admin-key-1"
        },
        payload: {
          id: "provider_persisted",
          type: "kiro",
          name: "Persisted"
        }
      });
      expect(createProvider.statusCode).toBe(200);
      await firstApp.close();

      const secondApp = await buildApp(config, {
        persistenceService: new PersistenceService(dataFile)
      });

      expect(
        secondApp.providerRuntimeRegistry
          .listProviderInstances()
          .map((provider) => provider.id)
      ).toContain("provider_persisted");

      const models = await secondApp.inject({
        method: "GET",
        url: "/v1/models",
        headers: {
          authorization: `Bearer ${rawKey}`
        }
      });
      expect(models.statusCode).toBe(200);

      await secondApp.close();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
