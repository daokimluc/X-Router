## 1. Ledger hour window

- [x] 1.1 Add `hourKey: string` and `hour: number` to `LedgerEntry`; `emptyEntry()` initializes them to the current hour / 0.
- [x] 1.2 Extend `rollover(entry)` to reset `hour`/`hourKey` when the UTC hour changes (in addition to day/month).
- [x] 1.3 Extend `reserve` to accept optional `hourCap`; check **hour → day → month** order; on hour breach return `{ ok:false, reason:"hour_cap_exceeded", cap, spent }` and set `lastBlocked`.
- [x] 1.4 `settle`/`release` adjust `hour` alongside `day`/`month` (floor at 0).
- [x] 1.5 Extend `snapshot` to include the `hour` window `{ spent, cap, remainingPct }`.

## 2. Persistence tolerance

- [x] 2.1 `toPersisted`/`load`: include `hourKey`/`hour`; on load, entries missing them get `hour=0` + current `hourKey` (normalized by first rollover).
- [x] 2.2 Vitest: load an old-shape entry (no hour fields) → no crash, hour treated as fresh.

## 3. Retry-After helper

- [x] 3.1 Add `secondsUntilNextHourUTC()` beside the existing day/month helpers (wherever `secondsUntilNextDayUTC` lives).
- [x] 3.2 Vitest: at `14:30:00Z` returns `1800`; at `14:59:59Z` returns `1`.

## 4. Model-group scope (ledger stays agnostic)

- [x] 4.1 No ledger code change for grouping — confirm `reserve`/`snapshot`/`settle` operate purely on the opaque scope string so `key:abc:grp:claude` works without special handling.
- [x] 4.2 Vitest: two reserves on `key:abc:grp:claude` and `key:abc:grp:codex` keep independent totals.

## 5. Middleware rejection path

- [x] 5.1 `enforceKeyPolicy.ts`: when `reserve` returns `hour_cap_exceeded`, respond 429 `spend_limit_exceeded` with `Retry-After: secondsUntilNextHourUTC()`. (Where the hour cap *comes from* — the plan — is wired in `marketplace-plans`; here just handle the new reason.)
- [x] 5.2 Vitest: a reserve returning `hour_cap_exceeded` produces 429 with an hourly `Retry-After` header.

## 6. Admin snapshot endpoint

- [x] 6.1 The spend snapshot endpoint (`GET /admin/v1/spend/...`) includes the `hour` window in its response.
- [x] 6.2 Vitest/endpoint test: response body carries `hour: { spent, cap, remainingPct }`.

## 7. Verification

- [x] 7.1 Gateway `tsc` clean.
- [x] 7.2 Test suite green; expect +~8 tests (hour rollover, hour cap reserve, retry helper, group independence, old-shape load).
- [x] 7.3 Existing `spending-caps` day/month tests still pass unchanged (hour omitted = no behavior change).
- [x] 7.4 `openspec validate hourly-spend-buckets --strict` passes.
