/**
 * ConfigStore — non-money-state-to-sqlite.
 *
 * SQLite-backed implementation of the {@link StateStore} contract (the same
 * load/save/saveDebounced/flush/drain surface as PersistenceService), so the
 * state-owning services keep hydrating from `load()` and persisting via
 * `app.persistState()` with NO call-site changes.
 *
 * Storage model (Database v5):
 *  - `config_entities(entity, id, data, ord)` — one row per list item
 *    (providerInstances, accounts, secrets, apiKeys, modelMappings,
 *    routingProfiles, teams, proxyPools, modelPricing, configRevisions). `data`
 *    is the item's JSON; `ord` preserves list order. A single-entity change
 *    writes one row (no whole-graph rewrite — spec scenario 3).
 *  - `config_kv(key, value)` — singletons (config.current, tokenSaver,
 *    marketplace, spendLedger, rateLimitCounters) + the schemaVersion +
 *    the `json_import_done` one-time-import marker.
 *
 * Durability comes from SQLite's WAL/transactions (spec scenario 1): each
 * persist runs in one transaction, so a crash mid-write rolls back cleanly.
 */
import type { Database, SqliteDatabase } from "./Database.js";
import {
  parsePersistedState,
  type PersistedGatewayState,
  type StateStore,
  CURRENT_SCHEMA_VERSION
} from "./PersistenceService.js";

/** List entities stored row-per-item in config_entities. */
const LIST_ENTITIES = [
  "providerInstances",
  "accounts",
  "modelMappings",
  "routingProfiles",
  "apiKeys",
  "secrets",
  "configRevisions",
  "teams",
  "proxyPools",
  "modelPricing"
] as const;

type ListEntity = (typeof LIST_ENTITIES)[number];

/**
 * Natural key per list entity. Most entities key on `id`; model_pricing on
 * `model`; model_mappings on `id|publicModel` because one channel id can map to
 * several public models (the JSON array allowed duplicate `id`s — a bare `id`
 * key would collapse them and silently drop rows on migration).
 */
function naturalKey(entity: ListEntity, item: Record<string, unknown>): string {
  if (entity === "modelPricing") return String(item.model ?? "");
  if (entity === "modelMappings") return `${String(item.id ?? "")}|${String(item.publicModel ?? "")}`;
  return String(item.id ?? "");
}

/**
 * Assign a UNIQUE, stable storage key to every item in a list. A blank or
 * duplicate natural key gets a deterministic `#n` suffix (nth occurrence) so no
 * row is ever silently merged/dropped — robustness against malformed/legacy
 * data. Stable as long as the list's relative order is stable (it is — same
 * in-memory array), so diffing + single-row writes still hold for the common
 * (unique-key) case.
 */
function computeRowKeys(entity: ListEntity, items: Array<Record<string, unknown>>): string[] {
  const seen = new Map<string, number>();
  return items.map((item) => {
    const base = naturalKey(entity, item) || "_blank";
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n === 0 ? base : `${base}#${n}`;
  });
}

export class ConfigStore implements StateStore {
  private readonly db: SqliteDatabase;
  private readonly database: Database;
  private readonly debounceMs: number;

  private pendingState: PersistedGatewayState | null = null;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private writing: Promise<void> = Promise.resolve();

  /** Snapshot of the last-persisted serialized rows, for diffing single writes. */
  private lastSerialized = new Map<string, string>();

  constructor(database: Database, options: { debounceMs?: number } = {}) {
    this.database = database;
    this.db = database.db;
    this.debounceMs = options.debounceMs ?? 250;
  }

  /** True once the one-time JSON import marker is set (or the store has data). */
  hasData(): boolean {
    const marker = this.getKv("json_import_done");
    if (marker === "1") return true;
    const row = this.db.prepare("SELECT COUNT(*) AS c FROM config_entities").get() as { c: number };
    return row.c > 0;
  }

  isImported(): boolean {
    return this.getKv("json_import_done") === "1";
  }

  /**
   * One-time idempotent import of a legacy JSON state into SQLite. Guarded by the
   * `json_import_done` marker so a second boot does not re-insert (spec scenario
   * 2). Runs in a single transaction. Returns the row counts imported.
   */
  importFrom(state: PersistedGatewayState): { imported: number } {
    if (this.isImported()) return { imported: 0 };
    return this.database.transaction(() => {
      let imported = 0;
      for (const entity of LIST_ENTITIES) {
        const items = this.extractList(state, entity);
        const keys = computeRowKeys(entity, items);
        items.forEach((item, i) => {
          this.upsertRow(entity, keys[i], item, i);
          imported++;
        });
      }
      this.writeSingletons(state);
      this.setKv("json_import_done", "1");
      this.setKv("schemaVersion", String(CURRENT_SCHEMA_VERSION));
      this.snapshotInto(state);
      return { imported };
    });
  }

  async load(): Promise<PersistedGatewayState | null> {
    if (!this.hasData()) return null;

    const lists: Record<string, unknown[]> = {};
    for (const entity of LIST_ENTITIES) {
      lists[entity] = this.readList(entity);
    }

    const raw: Record<string, unknown> = {
      schemaVersion: Number(this.getKv("schemaVersion") ?? CURRENT_SCHEMA_VERSION),
      providerInstances: lists.providerInstances,
      accounts: lists.accounts,
      modelMappings: lists.modelMappings,
      routingProfiles: lists.routingProfiles,
      apiKeys: lists.apiKeys,
      secrets: lists.secrets,
      config: {
        current: this.getJsonKv("config.current") ?? {},
        revisions: lists.configRevisions
      },
      tokenSaver: this.getJsonKv("tokenSaver"),
      teams: lists.teams,
      proxyPools: lists.proxyPools,
      rateLimitCounters: this.getJsonKv("rateLimitCounters"),
      modelPricing: lists.modelPricing,
      spendLedger: this.getJsonKv("spendLedger"),
      marketplace: this.getJsonKv("marketplace")
    };

    // Run through the SAME parse+revive used for JSON, so the in-memory shape
    // (Date revival, seller migration, validation) is identical.
    const state = parsePersistedState(raw);
    this.snapshotInto(state);
    return state;
  }

  /** Persist a full state, writing only the rows that changed since last save. */
  async save(state: PersistedGatewayState): Promise<void> {
    // Build the next cache OUTSIDE the transaction; only swap it in after commit
    // so a rollback can't leave the in-memory diff cache claiming rows are
    // persisted that were rolled back (the cache must track committed DB state).
    const nextCache = new Map<string, string>();

    this.database.transaction(() => {
      for (const entity of LIST_ENTITIES) {
        const items = this.extractList(state, entity);
        const keys = computeRowKeys(entity, items);
        const liveKeys = new Set<string>();

        items.forEach((item, i) => {
          const rowKey = keys[i];
          liveKeys.add(rowKey);
          const cacheKey = `${entity}::${rowKey}`;
          // Signature includes ord so a reorder (same content, new index) still
          // rewrites the row — otherwise trailing rows keep a stale ord and
          // load()'s ORDER BY ord returns a wrong/ambiguous order.
          const signature = `${i}:${JSON.stringify(item)}`;
          if (this.lastSerialized.get(cacheKey) !== signature) {
            this.upsertRow(entity, rowKey, item, i);
          }
          nextCache.set(cacheKey, signature);
        });

        // Delete rows that no longer exist (key must match the write key form).
        const existing = this.db
          .prepare("SELECT id FROM config_entities WHERE entity = ?")
          .all(entity) as Array<{ id: string }>;
        for (const { id } of existing) {
          if (!liveKeys.has(id)) {
            this.db.prepare("DELETE FROM config_entities WHERE entity = ? AND id = ?").run(entity, id);
          }
        }
      }
      this.writeSingletons(state);
      this.setKv("schemaVersion", String(CURRENT_SCHEMA_VERSION));
      this.setKv("json_import_done", "1");
    });

    // Committed — adopt the new cache (drops evicted keys, no stale accumulation).
    this.lastSerialized = nextCache;
  }

  saveDebounced(state: PersistedGatewayState): void {
    this.pendingState = state;
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, this.debounceMs);
  }

  async flush(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    const state = this.pendingState;
    if (!state) return this.writing;
    this.pendingState = null;
    this.writing = this.writing.catch(() => undefined).then(() => this.save(state));
    return this.writing;
  }

  async drain(): Promise<void> {
    await this.flush();
    // Surface a failed final write rather than silently dropping it.
    await this.writing.catch((err) => {
      // eslint-disable-next-line no-console
      console.error(`[config-store] final save on drain failed: ${String(err)}`);
    });
  }

  // ── internals ──────────────────────────────────────────────

  private extractList(state: PersistedGatewayState, entity: ListEntity): Array<Record<string, unknown>> {
    switch (entity) {
      case "providerInstances": return (state.providerInstances ?? []) as Array<Record<string, unknown>>;
      case "accounts": return (state.accounts ?? []) as Array<Record<string, unknown>>;
      case "modelMappings": return (state.modelMappings ?? []) as Array<Record<string, unknown>>;
      case "routingProfiles": return (state.routingProfiles ?? []) as Array<Record<string, unknown>>;
      case "apiKeys": return (state.apiKeys ?? []) as Array<Record<string, unknown>>;
      case "secrets": return (state.secrets ?? []) as Array<Record<string, unknown>>;
      case "configRevisions": return (state.config?.revisions ?? []) as Array<Record<string, unknown>>;
      case "teams": return (state.teams ?? []) as Array<Record<string, unknown>>;
      case "proxyPools": return (state.proxyPools ?? []) as Array<Record<string, unknown>>;
      case "modelPricing": return (state.modelPricing ?? []) as Array<Record<string, unknown>>;
    }
  }

  private readList(entity: ListEntity): unknown[] {
    const rows = this.db
      .prepare("SELECT data FROM config_entities WHERE entity = ? ORDER BY ord ASC")
      .all(entity) as Array<{ data: string }>;
    return rows.map((r) => JSON.parse(r.data));
  }

  private upsertRow(entity: string, id: string, item: unknown, ord: number): void {
    this.db
      .prepare(
        `INSERT INTO config_entities (entity, id, data, ord) VALUES (?, ?, ?, ?)
         ON CONFLICT(entity, id) DO UPDATE SET data = excluded.data, ord = excluded.ord`
      )
      .run(entity, id, JSON.stringify(item), ord);
  }

  private writeSingletons(state: PersistedGatewayState): void {
    this.setJsonKv("config.current", state.config?.current ?? {});
    this.setJsonKv("tokenSaver", state.tokenSaver);
    this.setJsonKv("rateLimitCounters", state.rateLimitCounters);
    this.setJsonKv("spendLedger", state.spendLedger);
    this.setJsonKv("marketplace", state.marketplace);
  }

  /** Seed lastSerialized from a known state so the next save() diffs correctly. */
  private snapshotInto(state: PersistedGatewayState): void {
    this.lastSerialized.clear();
    for (const entity of LIST_ENTITIES) {
      const items = this.extractList(state, entity);
      const keys = computeRowKeys(entity, items);
      items.forEach((item, i) => {
        // Must match save()'s signature format (ord-prefixed) so a no-op state
        // round-trip after load/import doesn't rewrite every row.
        this.lastSerialized.set(`${entity}::${keys[i]}`, `${i}:${JSON.stringify(item)}`);
      });
    }
  }

  private getKv(key: string): string | undefined {
    const row = this.db.prepare("SELECT value FROM config_kv WHERE key = ?").get(key) as { value: string } | undefined;
    return row?.value;
  }

  private setKv(key: string, value: string): void {
    this.db
      .prepare("INSERT INTO config_kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(key, value);
  }

  private getJsonKv(key: string): unknown {
    const v = this.getKv(key);
    if (v === undefined) return undefined;
    try {
      return JSON.parse(v);
    } catch {
      return undefined;
    }
  }

  private setJsonKv(key: string, value: unknown): void {
    if (value === undefined) {
      this.db.prepare("DELETE FROM config_kv WHERE key = ?").run(key);
      return;
    }
    this.setKv(key, JSON.stringify(value));
  }
}
