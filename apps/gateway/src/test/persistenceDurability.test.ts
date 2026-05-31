import { mkdtemp, rm, readFile, writeFile, copyFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import {
  PersistenceService,
  StateValidationError,
  CURRENT_SCHEMA_VERSION,
  type PersistedGatewayState
} from "../services/PersistenceService.js";

const dirs: string[] = [];

afterEach(async () => {
  while (dirs.length) {
    const d = dirs.pop();
    if (d) await rm(d, { recursive: true, force: true });
  }
});

async function tmpFile(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "persist-"));
  dirs.push(dir);
  return join(dir, "state.json");
}

function minimalState(extra: Partial<PersistedGatewayState> = {}): PersistedGatewayState {
  return {
    providerInstances: [],
    accounts: [],
    modelMappings: [],
    routingProfiles: [],
    apiKeys: [],
    secrets: [],
    config: { current: {}, revisions: [] },
    ...extra
  } as PersistedGatewayState;
}

describe("PersistenceService atomic + recoverable writes", () => {
  it("writes the schema version and round-trips", async () => {
    const file = await tmpFile();
    const svc = new PersistenceService(file);
    await svc.save(minimalState({ teams: [] }));

    const onDisk = JSON.parse(await readFile(file, "utf8"));
    expect(onDisk.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);

    const loaded = await svc.load();
    expect(loaded).not.toBeNull();
    expect(loaded?.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
  });

  it("keeps a .bak of the previous good file and recovers from a corrupt primary", async () => {
    const file = await tmpFile();
    const svc = new PersistenceService(file);

    // Two successive saves → .bak holds the first, primary holds the second.
    await svc.save(minimalState({ config: { current: { v: 1 }, revisions: [] } }));
    await svc.save(minimalState({ config: { current: { v: 2 }, revisions: [] } }));

    const bak = `${file}.bak`;
    expect((await stat(bak)).isFile()).toBe(true);

    // Corrupt the primary; load() must fall back to .bak rather than throw.
    await writeFile(file, "{ this is : not json", "utf8");
    const loaded = await svc.load();
    expect(loaded).not.toBeNull();
    // .bak held the first save (v:1).
    expect(loaded?.config.current).toEqual({ v: 1 });
  });

  it("an interrupted write (stale .tmp) does not affect the intact primary", async () => {
    const file = await tmpFile();
    const svc = new PersistenceService(file);
    await svc.save(minimalState({ config: { current: { good: true }, revisions: [] } }));

    // Simulate a crash mid-write: a partial temp file left behind.
    await writeFile(`${file}.tmp`, "{ partial", "utf8");

    const loaded = await svc.load();
    expect(loaded?.config.current).toEqual({ good: true });
  });

  it("returns null on a fresh install (no primary, no backup)", async () => {
    const file = await tmpFile();
    const svc = new PersistenceService(file);
    expect(await svc.load()).toBeNull();
  });

  it("throws loudly when both primary and backup are corrupt", async () => {
    const file = await tmpFile();
    const svc = new PersistenceService(file);
    await writeFile(file, "garbage", "utf8");
    await writeFile(`${file}.bak`, "also garbage", "utf8");
    await expect(svc.load()).rejects.toBeInstanceOf(StateValidationError);
  });
});

describe("PersistenceService validation + versioning", () => {
  it("treats a versionless (older) file as v0 and migrates forward", async () => {
    const file = await tmpFile();
    // Older shape: no schemaVersion, account with no sellerId.
    const legacy = {
      providerInstances: [],
      accounts: [
        {
          id: "acc1",
          providerInstanceId: "p1",
          providerType: "kiro",
          status: "active",
          displayName: "a",
          weight: 1,
          maxConcurrency: 1,
          credentialRef: "s1",
          runtime: { activeRequests: 0, totalRequests: 0, failedRequests: 0, consecutiveFailures: 0 },
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z"
        }
      ],
      modelMappings: [],
      routingProfiles: [],
      apiKeys: [],
      secrets: [],
      config: { current: {}, revisions: [] }
    };
    await writeFile(file, JSON.stringify(legacy), "utf8");

    const svc = new PersistenceService(file);
    const loaded = await svc.load();
    expect(loaded?.schemaVersion).toBe(0);
    // seller migration applied.
    expect((loaded?.accounts[0] as { sellerId?: string }).sellerId).toBe("house");
  });

  it("fails loudly with a field path when a critical slice is malformed", async () => {
    const file = await tmpFile();
    // accounts entry missing required providerInstanceId.
    const bad = {
      providerInstances: [],
      accounts: [{ id: "acc1" }],
      modelMappings: [],
      routingProfiles: [],
      apiKeys: [],
      secrets: [],
      config: { current: {}, revisions: [] }
    };
    await writeFile(file, JSON.stringify(bad), "utf8");

    const svc = new PersistenceService(file);
    await expect(svc.load()).rejects.toThrow(/accounts/);
  });
});

describe("PersistenceService single-flight + debounce", () => {
  it("coalesces a burst of saveDebounced calls into ordered writes", async () => {
    const file = await tmpFile();
    const svc = new PersistenceService(file, { debounceMs: 20 });

    for (let i = 1; i <= 10; i++) {
      svc.saveDebounced(minimalState({ config: { current: { n: i }, revisions: [] } }));
    }
    await svc.drain();

    const onDisk = JSON.parse(await readFile(file, "utf8"));
    // Last state wins; the intermediate writes coalesced.
    expect(onDisk.config.current).toEqual({ n: 10 });
  });

  it("drain flushes a pending save on shutdown", async () => {
    const file = await tmpFile();
    const svc = new PersistenceService(file, { debounceMs: 10_000 });
    svc.saveDebounced(minimalState({ config: { current: { flushed: true }, revisions: [] } }));
    // Timer hasn't fired (10s debounce), but drain forces it.
    await svc.drain();
    const onDisk = JSON.parse(await readFile(file, "utf8"));
    expect(onDisk.config.current).toEqual({ flushed: true });
  });
});
