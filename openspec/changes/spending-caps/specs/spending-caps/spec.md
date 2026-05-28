## ADDED Requirements

### Requirement: Per-key daily and monthly USD spend limit

`ApiKey` SHALL support optional fields `dailySpendLimitUsd` and `monthlySpendLimitUsd` (number, USD). When set to `null` or `undefined` for a given key, no cap from that key applies.

When a request is authenticated against a key with either cap set, the gateway SHALL compute an upper-bound cost estimate for the upcoming request and SHALL reject the request with HTTP 429 and `code: "spend_limit_exceeded"` if the estimate plus the current period spend would exceed the cap.

#### Scenario: Day cap breached pre-flight rejects with 429

- **WHEN** a request authenticates against a key whose `dailySpendLimitUsd` is `5.00`, the key has spent `4.95` today, and the request's upper-bound estimate is `0.10`
- **THEN** the gateway SHALL respond HTTP 429 with body containing `error.code = "spend_limit_exceeded"` and SHALL NOT call any provider adapter

#### Scenario: Day cap not breached → request proceeds

- **WHEN** the same key has spent `4.50` today and the request's upper-bound estimate is `0.10`
- **THEN** the request SHALL proceed to the adapter

#### Scenario: Day key rolls over at UTC midnight

- **WHEN** a key spent `9.99` yesterday (UTC) under a `10.00` daily cap, and a request arrives at `00:01 UTC` the next day with estimate `0.50`
- **THEN** the day total SHALL be reset to 0 and the request SHALL proceed (current day spend `0.00` + estimate `0.50` < `10.00`)

### Requirement: Per-team caps inherited when key caps missing

`Team` SHALL support `dailySpendLimitUsd` and `monthlySpendLimitUsd`. When a key has no own daily cap and is bound to a team that has a daily cap, the team's cap SHALL apply. Same for monthly. The team's per-period spend SHALL be tracked separately from any single key's spend; both totals SHALL be checked.

#### Scenario: Key inherits team daily cap

- **WHEN** a key with `dailySpendLimitUsd = null` belongs to a team with `dailySpendLimitUsd = 50.00`, and the team has spent `49.95` today
- **THEN** a request whose estimate is `0.10` SHALL be rejected with HTTP 429

#### Scenario: Key own cap overrides team cap

- **WHEN** a key has `dailySpendLimitUsd = 1.00` and belongs to a team with `dailySpendLimitUsd = 100.00`
- **THEN** the gateway SHALL enforce the key cap (`1.00`) and ignore the team cap for daily checks

### Requirement: Ledger increments after request completes successfully

After a request is completed AND the response carries a billable cost (`estimatedCost > 0`) AND the response was an HTTP success, the gateway SHALL increment the per-key spend by `estimatedCost` and (if the key is in a team) also increment the team's spend by the same amount.

#### Scenario: Successful billable request increments key and team ledger

- **WHEN** a request authenticated as `key=A team=T` completes with `estimatedCost = 0.42`
- **THEN** the day and month totals for both `key:A` and `team:T` SHALL each increase by `0.42`

#### Scenario: Failed request does not increment

- **WHEN** a request fails with HTTP 502 from the provider
- **THEN** neither key nor team ledger SHALL change

#### Scenario: Pre-flight rejection does not increment

- **WHEN** a request is rejected with `spend_limit_exceeded` before reaching the adapter
- **THEN** neither key nor team ledger SHALL change

### Requirement: Ledger persists across gateway restart

The ledger state (current dayKey, monthKey, daily total, monthly total per scope) SHALL be persisted to disk through `PersistenceService` and restored on startup. Persistence writes SHALL be debounced (max 1 write per 5 seconds) to bound I/O.

#### Scenario: Restart preserves day total

- **WHEN** a key has spent `3.50` today, the gateway is shut down cleanly, and the gateway restarts within the same UTC day
- **THEN** the next request authenticated against that key SHALL see the day total `3.50` (not `0`)

#### Scenario: Restart across midnight resets day total

- **WHEN** the persisted day total was `3.50` for `dayKey=2026-05-27`, and the gateway restarts at `2026-05-28T05:00 UTC`
- **THEN** the day total SHALL be reset to `0` for `dayKey=2026-05-28` while the month total SHALL be preserved

### Requirement: Hold-and-settle pattern for concurrent requests

When two requests both pass the pre-flight check at near-cap, the gateway SHALL increment the ledger atomically with the **upper estimate** before dispatch and SHALL adjust to the actual cost on completion (refunding the difference). This SHALL prevent two concurrent requests from each individually fitting under the cap but together exceeding it.

#### Scenario: Two concurrent requests near the cap — one is rejected

- **WHEN** the daily cap is `10.00`, current spend is `9.50`, and two requests with upper-bound estimates of `0.40` each arrive concurrently
- **THEN** exactly one request SHALL pass the check (incrementing ledger to `9.90`); the other SHALL fail the check (because `9.90 + 0.40 > 10.00`) and receive HTTP 429
