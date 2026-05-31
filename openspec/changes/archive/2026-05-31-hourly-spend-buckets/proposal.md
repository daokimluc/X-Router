## Why

A marketplace plan controls spending with three rolling windows: **hour**, **day**, **month**. The hour and day windows are *speed limits* (mobile-data style — they pace usage so one buggy app can't drain a month's budget in an afternoon); the month window is the *budget* (the advertised "$20"). `SpendLedgerService` today tracks only **calendar day and calendar month**, and only as hard caps scoped to a key or team. The marketplace needs a third **hourly** window, and it needs spend scoped per **model group** (a plan that is "Claude only" must meter Claude spend independently of Codex spend) so a plan can gate access by scope.

This change extends the existing ledger rather than replacing it. It is the metering substrate that `marketplace-plans` (the plan presets) builds on.

## What Changes

- Extend `LedgerEntry` with an **hour** window (`hourKey` = `YYYY-MM-DDTHH` UTC, `hour: number`) alongside the existing day/month, with lazy hourly rollover.
- Extend `reserve` to accept an optional `hourCap` and return `reason: "hour_cap_exceeded"` when the hourly window would be breached.
- Extend `snapshot` to report the hour window (`spent`, `cap`, `remainingPct`, plus seconds-until-next-hour for `Retry-After`).
- Allow a **model-group dimension** in the scope key so spend can be metered per plan-scope, e.g. `key:abc:grp:claude`. The grouping function (model → group) is provided by the caller; the ledger stays agnostic.
- Add a `secondsUntilNextHourUTC()` helper for `Retry-After` on hourly blocks.
- **BREAKING** none — new fields default to absent; existing day/month behavior is unchanged when `hourCap` is omitted.

## Capabilities

### New Capabilities
- `hourly-spend-buckets`: An hour-granularity rolling spend window added to the spend ledger, plus per-model-group scoping, enabling plans to enforce hour/day/month speed limits independently per model scope.

### Modified Capabilities
- (none published — `spending-caps` lives in `openspec/changes/` not yet archived to `openspec/specs/`. This change supersedes the hour-less ledger described there; once both archive, the ledger spec is the union.)

## Impact

- Modified service: `apps/gateway/src/services/SpendLedgerService.ts` — add hour window to `LedgerEntry`, `rollover`, `reserve`, `settle`, `release`, `snapshot`, persistence shape.
- Modified: `apps/gateway/src/middleware/enforceKeyPolicy.ts` — pass `hourCap`, handle `hour_cap_exceeded` → 429 with hourly `Retry-After`. (Plan-driven caps are wired in `marketplace-plans`; this change only teaches the ledger and the rejection path.)
- New util: `secondsUntilNextHourUTC()` next to the existing `secondsUntilNextDayUTC`/`secondsUntilNextMonthUTC`.
- Persistence: `PersistedLedger` entries gain `hourKey`/`hour`; load tolerates old entries lacking them (treated as a fresh hour).
- Admin spend snapshot endpoint reports the hour window too.
