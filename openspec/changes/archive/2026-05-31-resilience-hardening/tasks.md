## 1. Circuit breaker self-heal

- [x] 1.1 Make the half-open in-flight counter decrement on every admitted-request terminal outcome. Cleanest: a single `recordResult(instanceId, ok)` (or a mandatory release paired with `beforeRequest`) called once per admitted request in the route `finally`, replacing the current "only on circuit-classified failure" decrement. Remove the side-effecting reset from `canRequest` (predicate shouldn't mutate).
- [x] 1.2 Half-open + success → close; half-open + any failure → reopen + restart cooldown. Closed-state failure threshold logic unchanged.
- [x] 1.3 Routes (openai.ts, anthropic.ts): ensure the auth-refresh `continue` path and every non-circuit failure path still resolve the breaker for the admitted request.
- [x] 1.4 Vitest: half-open probe fails with a non-circuit error → reopens, admits again after cooldown (currently strands); half-open probe succeeds → closes; auth-refresh-retry on a half-open probe does not strand. Confirm existing circuitBreaker tests still pass.

## 2. Credential-refresh serialization

- [x] 2.1 Wire `RefreshLockService` (currently dead code) into `AutoRefreshService` and the on-401 refresh in both routes: wrap each `adapter.refreshSession` + secret write in `refreshLock.runForAccount(account, …)`.
- [x] 2.2 Inside the lock, re-read the credential and skip if it was refreshed by another path (expiry now in the future / token changed).
- [x] 2.3 Collapse the duplicate `server.ts` refresh `setInterval` into `AutoRefreshService` (single loop, cleared on close).
- [x] 2.4 Vitest: two concurrent refresh calls for one account → only one `refreshSession` runs; the other skips. Background + on-401 within the window → single refresh. Confirm existing refreshLock tests still pass.

## 3. Verification

- [x] 3.1 Gateway `tsc` clean.
- [x] 3.2 Full suite green; +~6 tests (half-open recovery, refresh serialization). (+10: 647 pass / 7 skip, was 637.)
- [ ] 3.3 Manual: force a provider into half-open, fail the probe with an auth error, confirm it recovers after cooldown (not stuck). Confirm a single refresh loop in logs. (User manual smoke.)
- [x] 3.4 `openspec validate resilience-hardening --strict` passes.
