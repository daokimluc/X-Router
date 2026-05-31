## Why

After `persistence-durability` makes the JSON state store safe (atomic writes,
single-flight, no partial saves) and cheap (no hot-path rewrite), the remaining
limitation is structural: the engine's configuration + runtime state still lives as
one in-memory graph serialized to a single JSON blob. The money/metering state
already moved to SQLite in Phase 34b (`Database`, with `wallets`, `seller_earnings`,
`settlement_log`, `usage_log`, …) and is sound. This change finishes the job for the
non-money state, so the gateway scales past the "whole graph in memory + one file"
ceiling:

- **Whole-graph-in-memory.** Provider accounts, encrypted secrets, API keys, model
  mappings, teams, proxy pools, config revisions are all held as live arrays and
  rewritten as one document. At thousands of accounts/keys this is a growing blob and
  a growing boot-time parse.
- **No partial / indexed reads or writes.** Every change touches the whole document;
  there is no per-row update, no query by id without scanning, no transactional
  multi-entity change. Concurrency safety relies entirely on the single-flight save
  added by `persistence-durability`.
- **Two stores, one engine.** Money is transactional SQLite; config is a JSON
  document. A single durable substrate (the existing `Database`) for both simplifies
  backup, migration, and reasoning about durability.

This is the strategic follow-up, not an emergency: `persistence-durability` removes
the acute data-loss/boot-brick risk; this removes the scaling ceiling.

## What Changes

- **Move non-money config state into SQLite** using the existing `Database` +
  migration runner: tables for provider instances, provider accounts, secrets
  (ciphertext as today), API keys, model mappings, routing profiles, teams, proxy
  pools, model pricing, config revisions. Each gets row-level read/update and an id
  index.
- **One-time JSON→SQLite import** on first boot (guarded by a marker), reading the
  existing state file (post-`persistence-durability` shape) and inserting rows;
  idempotent; logs counts. The JSON file becomes a legacy import source, then unused.
- **Services read/write through the DB** instead of holding the full array in memory
  and round-tripping the document — incrementally, one entity at a time, preserving
  each service's current public interface so call sites do not change.
- **Backups + integrity** come from SQLite (WAL, single file) instead of the `.bak`
  JSON copy; the schema-version mechanism already exists in `Database`.
- **No external API or behavior change** — purely the persistence substrate for
  config state.

## Capabilities

### Modified Capabilities
- `state-durability`: non-money state is persisted in the transactional SQLite store
  (row-level, indexed, migration-versioned) rather than a single JSON document, while
  preserving the durability guarantees established by `persistence-durability`.

## Impact

- Modified (engine): `services/Database.ts` (migrations for the config tables);
  the state-owning services (provider runtime registry / account pool source, model
  registry, routing profiles, ApiKeyService, SecretService, TeamService,
  ProxyPoolService, ModelPricingService, ConfigRevisionService) gain DB-backed
  load/persist; `PersistenceService` becomes the one-time JSON import path (or is
  retired once import is complete); `app.ts` boot wiring + `createPersistedState`
  removed/repointed.
- Data migration: one-time, idempotent JSON→SQLite import; the old state file is read
  once then ignored. Document the rollback (keep the JSON file until verified).
- Depends on: `persistence-durability` (lands first — this change assumes the cleaned
  state shape + schemaVersion). Independent of the marketplace SQLite work but shares
  the same `Database`.
- Risk: broad, touches many services. Mitigation: migrate entity-by-entity behind
  unchanged service interfaces, with the full suite as the regression net; keep the
  JSON import reversible until a production verification window passes.
- Out of scope: changing what config entities exist or their shapes; this is a
  substrate move. Live request-log/usage rings already covered by SQLite `usage_log`.
