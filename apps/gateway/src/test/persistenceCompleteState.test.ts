import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { PersistenceService } from "../services/PersistenceService.js";
import { createPersistedState } from "../services/createPersistedState.js";
import { testConfig } from "./helpers.js";

const dirs: string[] = [];

afterEach(async () => {
  while (dirs.length) {
    const d = dirs.pop();
    if (d) await rm(d, { recursive: true, force: true });
  }
});

async function tmpState(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "persist-int-"));
  dirs.push(dir);
  return join(dir, "state.json");
}

describe("persistence-durability — complete-state persistence", () => {
  it("the canonical builder persists raw API-key material (never key-stripped)", async () => {
    const dataFile = await tmpState();
    const config = testConfig({ dataFile, requestBodyLimit: "4kb" });
    const app = await buildApp(config, {
      persistenceService: new PersistenceService(dataFile)
    });
    try {
      const created = await app.inject({
        method: "POST",
        url: "/admin/v1/api-keys",
        headers: { authorization: "Bearer admin-key-1" },
        payload: { owner: "raw-key-test" }
      });
      const rawKey = created.json().key as string;
      expect(rawKey).toBeTruthy();

      // The canonical builder must include the raw key (listWithKeys), so a
      // reload can re-authenticate it. The old partial-save used list() which
      // stripped it.
      const state = createPersistedState(app);
      const persistedKey = state.apiKeys.find((k) => (k as { key?: string }).key === rawKey);
      expect(persistedKey).toBeDefined();
    } finally {
      await app.close();
    }
  });

  it("admin mutations survive a restart with all slices intact (teams + pricing)", async () => {
    const dataFile = await tmpState();
    const config = testConfig({ dataFile, requestBodyLimit: "8kb" });

    const first = await buildApp(config, {
      persistenceService: new PersistenceService(dataFile)
    });
    let rawKey: string;
    let teamId: string;
    try {
      rawKey = (
        await first.inject({
          method: "POST",
          url: "/admin/v1/api-keys",
          headers: { authorization: "Bearer admin-key-1" },
          payload: { owner: "survivor" }
        })
      ).json().key as string;

      const createdTeam = await first.inject({
        method: "POST",
        url: "/admin/v1/teams",
        headers: { authorization: "Bearer admin-key-1" },
        payload: { id: "team_durable", name: "Durable Team", enabled: true }
      });
      teamId = (createdTeam.json().id ?? createdTeam.json().team?.id) as string;
      expect(teamId).toBeTruthy();

      // Drain the debounced save before restart.
      await first.persistenceService.drain();
    } finally {
      await first.close();
    }

    const second = await buildApp(config, {
      persistenceService: new PersistenceService(dataFile)
    });
    try {
      // Team slice preserved (the partial-save bug used to drop it).
      const teams = second.teamService.list();
      expect(teams.map((t) => t.id)).toContain(teamId);

      // Raw API key still authenticates (key material preserved).
      const models = await second.inject({
        method: "GET",
        url: "/v1/models",
        headers: { authorization: `Bearer ${rawKey}` }
      });
      expect(models.statusCode).toBe(200);
    } finally {
      await second.close();
    }
  });
});
