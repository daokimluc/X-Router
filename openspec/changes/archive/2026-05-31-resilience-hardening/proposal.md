## Why

Two independent reliability defects in the engine hot path can take a provider or
account permanently out of service with **no automatic recovery**, triggered by
something routine (token expiry). Both were found by a read-only audit and verified
in code.

1. **Circuit breaker gets stuck half-open forever.** `CircuitBreaker.beforeRequest`
   increments `halfOpenActiveRequests` for the probe request, but only
   `recordFailure`/`recordSuccess` decrement it — and the routes call `recordFailure`
   **only** for circuit-classified errors (`provider_rate_limited|timeout|unavailable`).
   When the single half-open probe fails with any other error — `provider_auth_error`
   (expired token), a non-`ProviderError` throw, a mid-stream error, or the
   auth-refresh `continue` path that skips `recordFailure` entirely — the counter is
   never decremented. `canRequest` then evaluates `halfOpenActiveRequests (1) <
   halfOpenMaxRequests (1)` = false **forever**; because the state is `half_open`
   (not `open`), the cooldown reset branch never runs again. The provider instance is
   dead until an admin `reset()` or a process restart.

2. **Three credential-refresh paths race with no mutual exclusion.** OAuth tokens
   are refreshed by (a) `AutoRefreshService` (60s loop), (b) a duplicate `setInterval`
   in `server.ts` (5-min loop), and (c) the on-401 refresh inside the routes. Their
   trigger windows overlap. `RefreshLockService` (a per-account `KeyedMutex`) was
   written and unit-tested **specifically to prevent this — but is never wired in**.
   For providers that rotate the refresh token on use, a concurrent refresh presents
   an already-consumed token and can invalidate the freshly issued one, killing the
   account. The read-decrypt-modify-write of the secret is also racy (last-writer-wins
   → lost token update).

These are pre-existing engine defects, independent of the marketplace layer. They
must be closed before relying on the gateway for sustained unattended operation.

## What Changes

- **Circuit breaker self-heals.** Pair every admitted request with exactly one
  terminal accounting call so `halfOpenActiveRequests` is always decremented when the
  probe finishes, regardless of error class. A half-open probe that fails for ANY
  reason returns the circuit to `open` (restarting the cooldown), and a half-open
  probe that succeeds closes it. The counter can never strand above zero.
- **All credential refreshes serialize per account.** Route every refresh — both
  background loops and the on-401 path — through `RefreshLockService.runForAccount`,
  and re-check expiry inside the lock so a refresh already performed by another path
  is skipped rather than repeated. Collapse the duplicate `server.ts` refresh loop
  into the single `AutoRefreshService`.
- **No behavior change to healthy paths** — only failure/expiry paths are corrected.

## Capabilities

### New Capabilities
- `circuit-breaker-resilience`: the provider circuit breaker recovers automatically
  from a failed half-open probe and never strands a provider in a permanently
  un-admittable state.
- `credential-refresh-safety`: concurrent credential refreshes for one account are
  serialized and de-duplicated so token rotation cannot self-invalidate.

## Impact

- Modified (engine): `services/CircuitBreaker.ts` — decrement-on-terminal semantics;
  `routes/openai.ts` + `routes/anthropic.ts` — pair `beforeRequest` with a single
  mandatory record on every admitted-request exit (success or any failure, incl. the
  auth-refresh `continue`).
- Modified (engine): `services/AutoRefreshService.ts` + `server.ts` (collapse the
  duplicate loop) + the routes' on-401 refresh — all funnel through
  `services/RefreshLockService.ts` (wire the existing dead code).
- No data migration. No marketplace coupling.
- Risk: touching the breaker state machine + the refresh path; mitigated by the
  existing `circuitBreaker`/`refreshLock` unit tests plus new ones for the stuck
  half-open and concurrent-refresh scenarios.
