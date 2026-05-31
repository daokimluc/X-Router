# hourly-spend-buckets Specification

## Purpose
TBD - created by archiving change hourly-spend-buckets. Update Purpose after archive.
## Requirements
### Requirement: Hour spend window with lazy rollover

The spend ledger SHALL track an hourly spend window keyed by UTC hour (`YYYY-MM-DDTHH`) for each scope, alongside the existing day and month windows. The hourly total SHALL reset to zero lazily when the current UTC hour differs from the entry's stored hour key, with no scheduled job.

#### Scenario: Hour total resets on hour change

- **WHEN** a scope spent `$0.30` during hour `2026-05-29T14`, and the next access occurs during hour `2026-05-29T15`
- **THEN** the hour total SHALL be `0` for the new hour while the day and month totals SHALL be unchanged

#### Scenario: Day total unaffected by hour rollover

- **WHEN** a scope spent `$0.30` in hour `T14` and `$0.20` in hour `T15` of the same UTC day
- **THEN** the hour total at `T15` SHALL reflect only `$0.20` while the day total SHALL be `$0.50`

### Requirement: Hour cap enforced in reservation, checked before day and month

`reserve` SHALL accept an optional `hourCap`. When the current hour total plus the estimate would exceed `hourCap`, the reservation SHALL be rejected with `reason: "hour_cap_exceeded"`. The check order SHALL be hour, then day, then month, so the shortest breached window is reported first.

#### Scenario: Hour cap breached rejects before day/month considered

- **WHEN** a reserve has `hourCap = 0.30` with `$0.29` already spent this hour and an estimate of `$0.05`, while day and month caps are not breached
- **THEN** the reservation SHALL be rejected with `reason: "hour_cap_exceeded"`

#### Scenario: Hour cap omitted preserves prior day/month behavior

- **WHEN** `reserve` is called with no `hourCap` and only `dayCap`/`monthCap`
- **THEN** behavior SHALL be identical to the day/month-only ledger (no hour enforcement)

#### Scenario: Settle and release adjust the hour window

- **WHEN** a reservation of `$0.20` against an hour window is settled to actual `$0.05`
- **THEN** the hour total SHALL be reduced by `$0.15` (refund of the unused estimate), never below `0`

### Requirement: Snapshot reports the hour window

`snapshot` SHALL include the hour window with `spent`, `cap`, and `remainingPct` (computed like day/month), in addition to day and month.

#### Scenario: Snapshot includes hour spend and remaining

- **WHEN** a scope has spent `$0.15` this hour under an `hourCap` of `$0.30`
- **THEN** the snapshot's hour window SHALL report `spent = 0.15`, `cap = 0.30`, `remainingPct = 50`

### Requirement: Per-model-group scope independence

The ledger SHALL treat the scope string as opaque, so a caller MAY compose a model-group dimension (e.g. `key:abc:grp:claude`) to meter spend independently per group. Distinct scope strings SHALL maintain fully independent hour/day/month totals.

#### Scenario: Two groups under one key meter independently

- **WHEN** `key:abc:grp:claude` has spent `$1.00` and `key:abc:grp:codex` has spent `$2.00`
- **THEN** a snapshot of `key:abc:grp:claude` SHALL report `$1.00` and a snapshot of `key:abc:grp:codex` SHALL report `$2.00`, each unaffected by the other

### Requirement: Hourly Retry-After helper

The gateway SHALL provide a helper returning the whole seconds remaining until the next UTC hour boundary, used to set the `Retry-After` header when a request is rejected for an hour-cap breach.

#### Scenario: Seconds until next hour

- **WHEN** the current time is `14:30:00 UTC`
- **THEN** the helper SHALL return `1800`

### Requirement: Persistence tolerates entries without hour fields

Loading a persisted ledger entry that predates the hour window (no `hourKey`/`hour`) SHALL NOT error; such an entry SHALL be treated as a fresh hour with total `0`.

#### Scenario: Old-shape entry loads as fresh hour

- **WHEN** a persisted entry has `day`/`month` totals but no `hourKey`/`hour`
- **THEN** loading SHALL succeed and the entry's hour total SHALL be `0` for the current UTC hour

