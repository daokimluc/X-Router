import { describe, expect, it } from "vitest";
import { Database } from "../services/Database.js";
import { ConfigStore } from "../services/ConfigStore.js";
import { parsePersistedState, type PersistedGatewayState } from "../services/PersistenceService.js";

function makeState(overrides: Partial<PersistedGatewayState> = {}): PersistedGatewayState {
  const now = new Date("2026-01-01T00:00:00.000Z");
  return {
    providerInstances: [
      {
        id: "p1",
        type: "kiro",
        name: "P1",
        enabled: true,
        config: {},
        defaultTimeoutMs: 30000,
        maxRetries: 1,
        cooldownMs: 60000,
        accountSelectionStrategy: "round_robin",
        maxConcurrentRequests: 20,
        maxConcurrentRequestsPerAccount: 3,
        circuitBreaker: { enabled: true, failureThreshold: 5, cooldownMs: 60000, halfOpenMaxRequests: 1 },
        createdAt: now,
        updatedAt: now
      }
    ] as PersistedGatewayState["providerInstances"],
    accounts: [
      {
        id: "acc1",
        providerInstanceId: "p1",
        providerType: "kiro",
        displayName: "Acc 1",
        status: "active",
        weight: 1,
        maxConcurrency: 1,
        credentialRef: "secret_acc1",
        runtime: { activeRequests: 0, totalRequests: 0, failedRequests: 0, consecutiveFailures: 0 },
        createdAt: now,
        updatedAt: now
      }
    ] as PersistedGatewayState["accounts"],
    modelMappings: [
      { id: "m1", publicModel: "kiro-sonnet", providerInstanceId: "p1", providerType: "kiro", upstreamModel: "sonnet", capabilities: ["chat"], enabled: true }
    ] as PersistedGatewayState["modelMappings"],
    routingProfiles: [],
    apiKeys: [
      { id: "k1", keyHash: "hash1", enabled: true, owner: "tester", createdAt: now, key: "raw-key-1" }
    ] as unknown as PersistedGatewayState["apiKeys"],
    secrets: [
      { id: "secret_acc1", accountId: "acc1", credentialType: "oauth", encryptedPayload: "cipher", updatedAt: now }
    ] as PersistedGatewayState["secrets"],
    config: { current: { foo: "bar" }, revisions: [] },
    teams: [
      { id: "t1", name: "Team 1", enabled: true, createdAt: now, updatedAt: now }
    ] as PersistedGatewayState["teams"],
    modelPricing: [
      { model: "kiro-sonnet", inputRate: 1, outputRate: 2 }
    ] as PersistedGatewayState["modelPricing"],
    ...overrides
  } as PersistedGatewayState;
}

describe("ConfigStore (non-money-state-to-sqlite)", () => {
  it("returns null before any data / import", async () => {
    const db = new Database(":memory:");
    const store = new ConfigStore(db);
    expect(await store.load()).toBeNull();
    db.close();
  });

  it("imports a legacy state once and is idempotent on a second import", async () => {
    const db = new Database(":memory:");
    const store = new ConfigStore(db);

    const first = store.importFrom(makeState());
    expect(first.imported).toBeGreaterThan(0);
    expect(store.isImported()).toBe(true);

    // Second import is a no-op (marker-guarded) — spec scenario 2.
    const second = store.importFrom(makeState());
    expect(second.imported).toBe(0);

    db.close();
  });

  it("round-trips a full state through SQLite with revived shape", async () => {
    const db = new Database(":memory:");
    const store = new ConfigStore(db);
    store.importFrom(makeState());

    const loaded = await store.load();
    expect(loaded).not.toBeNull();
    expect(loaded!.providerInstances.map((p) => p.id)).toEqual(["p1"]);
    expect(loaded!.accounts.map((a) => a.id)).toEqual(["acc1"]);
    expect(loaded!.modelMappings.map((m) => m.publicModel)).toEqual(["kiro-sonnet"]);
    expect(loaded!.apiKeys).toHaveLength(1);
    // Raw key material preserved (listWithKeys equivalent).
    expect((loaded!.apiKeys[0] as { key?: string }).key).toBe("raw-key-1");
    expect(loaded!.secrets[0].encryptedPayload).toBe("cipher");
    expect(loaded!.config.current).toEqual({ foo: "bar" });
    expect(loaded!.teams?.map((t) => t.id)).toEqual(["t1"]);
    expect(loaded!.modelPricing?.[0].model).toBe("kiro-sonnet");
    // Dates revived to Date objects (parsePersistedState path).
    expect(loaded!.accounts[0].createdAt).toBeInstanceOf(Date);
    // seller migration applied on accounts.
    expect((loaded!.accounts[0] as { sellerId?: string }).sellerId).toBe("house");

    db.close();
  });

  it("a single-entity change writes one row, not the whole graph", async () => {
    const db = new Database(":memory:");
    const store = new ConfigStore(db);
    store.importFrom(makeState());

    // Mutate just one account's displayName.
    const state = (await store.load())!;
    state.accounts[0].displayName = "Renamed";
    await store.save(state);

    // Verify only that row changed (others untouched), and reload reflects it.
    const reloaded = (await store.load())!;
    expect(reloaded.accounts[0].displayName).toBe("Renamed");
    expect(reloaded.providerInstances.map((p) => p.id)).toEqual(["p1"]);

    db.close();
  });

  it("deletes rows that disappear from the saved state", async () => {
    const db = new Database(":memory:");
    const store = new ConfigStore(db);
    store.importFrom(makeState());

    const state = (await store.load())!;
    state.accounts = [];
    await store.save(state);

    const reloaded = (await store.load())!;
    expect(reloaded.accounts).toHaveLength(0);
    // Other entities survive.
    expect(reloaded.providerInstances).toHaveLength(1);

    db.close();
  });

  it("debounced save coalesces and drain flushes", async () => {
    const db = new Database(":memory:");
    const store = new ConfigStore(db, { debounceMs: 10 });
    store.importFrom(makeState());

    for (let i = 0; i < 5; i++) {
      const s = await store.load();
      s!.config.current = { n: i };
      store.saveDebounced(s!);
    }
    await store.drain();

    const reloaded = (await store.load())!;
    expect(reloaded.config.current).toEqual({ n: 4 });
    db.close();
  });

  it("migrates a serialized legacy JSON document with equal entity counts", async () => {
    const db = new Database(":memory:");
    const store = new ConfigStore(db);

    // Simulate buildConfigStore's import path: JSON text → parse → importFrom.
    const legacyJson = JSON.stringify(makeState());
    const parsed = parsePersistedState(JSON.parse(legacyJson));
    store.importFrom(parsed);

    const loaded = (await store.load())!;
    expect(loaded.providerInstances.length).toBe(parsed.providerInstances.length);
    expect(loaded.accounts.length).toBe(parsed.accounts.length);
    expect(loaded.apiKeys.length).toBe(parsed.apiKeys.length);
    expect(loaded.secrets.length).toBe(parsed.secrets.length);
    expect(loaded.modelMappings.length).toBe(parsed.modelMappings.length);
    expect(loaded.teams?.length).toBe(parsed.teams?.length);
    expect(loaded.modelPricing?.length).toBe(parsed.modelPricing?.length);

    // Second import is guarded — no double insert.
    const again = store.importFrom(parsed);
    expect(again.imported).toBe(0);
    const reloaded = (await store.load())!;
    expect(reloaded.accounts.length).toBe(parsed.accounts.length);

    db.close();
  });
});
