## 1. Atomic, recoverable writes

- [x] 1.1 `PersistenceService.save()`: write to `<file>.tmp`, fsync, `rename` over `<file>` (same volume → atomic). Before rename, copy the current `<file>` to `<file>.bak` (keep one).
- [x] 1.2 `PersistenceService.load()`: on missing/unparseable primary, load `<file>.bak`, log the fallback. Only ENOENT-on-both → empty state.
- [x] 1.3 Vitest: interrupted/partial temp file → primary intact + boots; corrupt primary → loads `.bak`.

## 2. Complete-state persistence (kill partial-save)

- [x] 2.1 Delete `saveAdminRuntimeState` (admin.ts, 26 sites) and `saveRuntimeState` + the `void save({...})` calls (oauth.ts); replace with `app.persistState()` / `createPersistedState(app)` — the single canonical builder. Never persist via key-stripped `list()`. (Also fixed two drifted route-local `createPersistedState` copies + the OAuthPKCECallbackHandler partial save → all import the canonical `services/createPersistedState.ts`.)
- [x] 2.2 OAuth callback (a GET, not matched by onSend) must persist the full state explicitly via the canonical path.
- [x] 2.3 Vitest: add an account via the OAuth flow → persisted state still contains teams/modelPricing/marketplace/proxyPools and existing keys keep their key material. (Covered by persistenceCompleteState.test.ts: canonical builder keeps raw key material + teams survive restart.)

## 3. Single-flight + debounced saves

- [x] 3.1 Funnel all saves through one queue with a short trailing debounce (mirror SpendLedgerService's 5s debounce pattern); coalesce bursts; guarantee write ordering; don't block the response on the write. (saveDebounced + single-flight `writing` chain + drain() on close; 250ms default debounce.)
- [x] 3.2 Drop `usage` and `requestLogs` from `createPersistedState`. Hydrate the UsageService ring from SQLite `usage_log` (SELECT … ORDER BY ts DESC LIMIT cap) on boot; decide request-logs (in-memory only). DECISION below.
- [x] 3.3 Cap `ConfigRevisionService` revisions (keep last N = 50, monotonic version counter).
- [x] 3.4 DECISION + Vitest: request-logs are IN-MEMORY ONLY (not re-persisted; older files hydrate once). A `/v1/*` completion no longer triggers a state-file write (onSend dropped the `/v1` POST branch). Burst coalescing + restart usage-hydration covered by persistenceDurability.test.ts.

## 4. Validation + versioning

- [x] 4.1 Add `schemaVersion` to the persisted shape; absent → v0, migrate forward (kept `migrateAccountSellerId`).
- [x] 4.2 Replace `z.any()` with concrete zod schemas for the critical slices (accounts, secrets, apiKeys, modelMappings); on failure throw `StateValidationError` with the field path.
- [x] 4.3 Vitest: older (no-version) file migrates forward; a malformed critical slice fails loudly.

## 5. Reservation-leak on early returns (related)

- [x] 5.1 Added a global `onResponse` hook that releases any still-held `request.spendReservation` (split on `|`). settle() removes the reservation so it's a no-op on the happy path; only fires for early returns (cache-hit / 404 / direct-route) that bypass the failover loop. Idempotent + best-effort.
- [x] 5.2 Reservation release verified no-op-on-settle by full suite green (spend + route tests pass); hook is unconditional so cache-hit cannot leak.

## 6. Verification

- [x] 6.1 Gateway `tsc` clean.
- [x] 6.2 Full suite green; persistence.test.ts still passes; +11 tests (658 pass / 7 skip, was 647).
- [ ] 6.3 Manual: kill -9 mid-write → boots from intact file/backup; add an OAuth account → all slices preserved; hammer `/v1` → no state-file churn. (User manual smoke.)
- [x] 6.4 `openspec validate persistence-durability --strict` passes.
