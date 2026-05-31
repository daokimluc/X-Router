## 1. Schema + migrations

- [x] 1.1 Added SQLite migration (Database.ts v5) for non-money config: `config_entities(entity, id, data, ord)` (row-per-item, JSON `data`, id-indexed via PK + `idx_config_entities_entity`) covering providerInstances/accounts/secrets/apiKeys/modelMappings/routingProfiles/teams/proxyPools/modelPricing/configRevisions; `config_kv(key, value)` for singletons (config.current/tokenSaver/marketplace/spendLedger/rateLimitCounters) + markers.
- [x] 1.2 Bumped SCHEMA_VERSION 4→5; migrations idempotent (CREATE TABLE IF NOT EXISTS, run inside transaction per the existing runner).

## 2. One-time JSON → SQLite import

- [x] 2.1 `buildConfigStore()` in app.ts: on boot, if `!store.isImported()` and a legacy state file exists, `parsePersistedState(JSON)` → `store.importFrom(state)` inside one transaction; sets `json_import_done` marker; logs imported row count.
- [x] 2.2 Idempotent: `importFrom` is marker-guarded (returns {imported:0} if already imported) + `INSERT ... ON CONFLICT DO UPDATE`. A missing/broken legacy file still sets the marker (empty import) so it isn't retried every boot.
- [x] 2.3 The JSON file is read once then ignored; NOT deleted (left as a rollback artifact). buildConfigStore catches a present-but-unreadable file (warns, starts empty) and ENOENT (fresh install).

## 3. Services read/write through the DB

- [x] 3.1 Preserved every service's public interface by implementing a shared `StateStore` contract (load/save/saveDebounced/flush/drain). `ConfigStore` (SQLite) is a drop-in for `PersistenceService` (JSON) — services still hydrate from `persistedState` at boot and persist via `app.persistState()`; ZERO call-site changes. (A diff-based store rather than rewriting 9 service internals — the proposal's stated risk mitigation.)
- [x] 3.2 Row-level writes: `ConfigStore.save()` diffs each entity against the last-persisted snapshot and writes only changed rows (upsert) + deletes vanished rows; a single-entity change writes one row. `load()` reads rows ORDER BY ord and reconstructs the state, then runs `parsePersistedState` for identical Date-revival/seller-migration/validation. id-indexed via PK.
- [x] 3.3 `createPersistedState` + the JSON `save()` path are retained as the in-memory→store serializer feeding `StateStore.save()` (both substrates share it). PersistenceService kept as the JSON import source + the test-injectable substrate; not deleted (rollback path).

## 4. Verification

- [x] 4.1 Gateway `tsc` clean.
- [x] 4.2 Full suite green, service interfaces unchanged (675 pass / 7 skip, was 667). +tests: import idempotency, row-level update, delete-on-disappear, boot-from-SQLite-with-no-JSON (configStoreE2E), debounce/drain.
- [x] 4.3 Migration test: serialized legacy JSON → parse → import → equal entity counts; second import no double-insert (configStore.test.ts).
- [ ] 4.4 Manual: large fleet (thousands of accounts/keys) boots without a multi-MB JSON parse; a single mutation writes one row. (User manual smoke.)
- [x] 4.5 `openspec validate non-money-state-to-sqlite --strict` passes.

## 5. Sequencing

- [x] 5.1 Landed AFTER `persistence-durability` (uses its cleaned shape + schemaVersion + dropped usage/requestLogs + `parsePersistedState`). Shares the existing `Database` (v5 migration); independent of the marketplace money tables.
