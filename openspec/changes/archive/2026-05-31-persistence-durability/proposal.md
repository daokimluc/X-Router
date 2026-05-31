## Why

The non-money state (provider instances, accounts, encrypted secrets, API keys,
model mappings, teams, config revisions, …) lives in a single pretty-printed JSON
file rewritten in full on every mutating request. A read-only audit (verified in
code) found this layer carries two HIGH data-loss vectors and a hot-path cost:

1. **Partial-save helpers silently drop state.** `saveAdminRuntimeState`
   (`admin.ts`, 26 call sites) and `saveRuntimeState`/`void save(...)` (`oauth.ts`)
   hand `PersistenceService.save()` a **subset** object — only `{providerInstances,
   accounts, modelMappings, routingProfiles, apiKeys, secrets, config}` — and because
   `save()` rewrites the whole file, the omitted slices (`teams`, `tokenSaver`,
   `usage`, `requestLogs`, `proxyPools`, `rateLimitCounters`, `modelPricing`,
   `spendLedger`, `marketplace`) are dropped to defaults on next load. For `/admin/*`
   the later `onSend` full-save masks it; but the OAuth callback is a **GET**, which
   `onSend` does not match, so **every OAuth account addition silently truncates the
   state file** (losing teams/pricing/marketplace/…) and, by passing
   `apiKeyService.list()` (key-stripped), blanks raw API-key material on reload.

2. **Non-atomic write + unordered concurrent saves can brick startup.** `save()` is a
   plain `writeFile` (truncate-then-write — not temp+rename), with no lock. Several
   fire-and-forget `void save()` callers can overlap the awaited `onSend` save. Two
   overlapping writes (or a crash mid-write) can leave invalid/truncated JSON; on next
   boot `load()` rethrows the parse error and `buildApp` fails — the gateway will not
   start, with no fallback.

3. **Full-file rewrite on the request hot path.** The `onSend` hook `await`s a
   `JSON.stringify(entireState, null, 2)` + full `writeFile` on every mutating
   request **including every `/v1/*` POST** (the LLM proxy path). The serialized graph
   (~1-3 MB at scale: usage ring, secrets, config revisions) is rebuilt via
   per-record `structuredClone` synchronously on the event loop and the write blocks
   the response — adding ~15-50 ms/request and serializing throughput, to persist a
   ~1 KB delta. `config.revisions` is also **unbounded**, growing this blob without
   limit. (`usage`/`requestLogs` are already capped rings — and `usage` is already
   durably mirrored to SQLite `usage_log`, making its presence in the JSON redundant.)

Money state already moved to SQLite (Phase 34b) and is sound; this change makes the
remaining JSON store safe and cheap without (yet) a full SQLite migration.

## What Changes

- **Atomic, recoverable writes.** `save()` writes to a temp file, fsyncs, and
  `rename`s over the target; keeps one `.bak`; on `load()` parse-failure, falls back
  to `.bak` instead of failing to boot.
- **Single source of truth for what gets persisted.** Delete the partial-save
  helpers; every persist path serializes the **full** `createPersistedState(app)` (and
  never uses key-stripped `list()` for persistence). The OAuth-callback save uses it
  too, so account additions no longer truncate state.
- **Single-flight + debounced saves.** Coalesce bursts and serialize writes through
  one queue so concurrent/`void` callers cannot race or land out of order, and the
  response path is not blocked by the write.
- **Stop hot-rewriting metering data.** Drop `usage` and `requestLogs` from the JSON
  (hydrate the live rings from SQLite `usage_log` / keep request logs in-memory) so a
  `/v1/*` POST no longer triggers a config rewrite. Cap `config.revisions`.
- **Fail loudly on bad state.** Add a `schemaVersion` marker; validate the critical
  slices (accounts, secrets, apiKeys, modelMappings) on load so a corrupt/old file
  reports a field path instead of crashing later or loading silently wrong.
- Closely related: release `request.spendReservation` on the cache-hit / 404 /
  direct-route early returns (currently leaked because settle/release only runs in the
  failover loop).

## Capabilities

### New Capabilities
- `state-durability`: non-money gateway state is persisted atomically, recoverably,
  and completely — no partial write drops slices, no concurrent write corrupts the
  file, and a bad file fails loudly with a fallback rather than bricking startup.

## Impact

- Modified (engine): `services/PersistenceService.ts` (atomic write + `.bak`
  fallback + schemaVersion + critical-slice validation); `app.ts` (single-flight +
  debounce around save; drop `usage`/`requestLogs` from `createPersistedState`;
  hydrate rings from SQLite on boot); `routes/admin.ts` + `routes/oauth.ts` (delete
  partial-save helpers, call `createPersistedState`/`persistState`);
  `services/ConfigRevisionService.ts` (cap revisions).
- Reservation-leak fix touches `routes/openai.ts` + `routes/anthropic.ts` early-return
  paths.
- Data migration: existing JSON files load unchanged (schemaVersion absent → treated
  as v0, migrated forward). No marketplace coupling.
- Out of scope: a full move of config state to SQLite (`non-money-state-to-sqlite`,
  a later change) — this is the cheap, safe interim that removes the data-loss + boot-
  brick risk now.
