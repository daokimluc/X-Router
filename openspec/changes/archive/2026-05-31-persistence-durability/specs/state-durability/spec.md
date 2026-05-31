## ADDED Requirements

### Requirement: Atomic, recoverable state writes

The gateway SHALL persist non-money state with an atomic write (write to a temp
file, then rename over the target) and SHALL retain a single previous-good backup.
On load, if the primary state file is missing or unparseable, the gateway SHALL
fall back to the backup rather than failing to start. A crash or concurrent write
SHALL NOT be able to leave the gateway unable to boot from a truncated/partial file.

#### Scenario: Crash mid-write does not brick startup

- **WHEN** a state write is interrupted (process crash) leaving a partial temp file
- **THEN** the target state file SHALL remain the last fully-written version (the rename never happened), and the gateway SHALL boot from it

#### Scenario: Corrupt primary falls back to backup

- **WHEN** the primary state file is present but unparseable
- **THEN** the gateway SHALL load the most recent backup and start, logging the fallback, instead of throwing during boot

### Requirement: Complete-state persistence

Every persistence path SHALL serialize the complete gateway state, never a subset.
Persisting SHALL NOT drop any state slice (teams, pricing, proxy pools, marketplace,
etc.), and SHALL NOT strip raw API-key material. Adding an account via the OAuth
callback SHALL persist the same complete state as any admin mutation.

#### Scenario: OAuth account addition preserves all slices

- **WHEN** an account is added through the OAuth callback flow
- **THEN** the persisted state SHALL still contain all previously-stored slices (teams, model pricing, marketplace, proxy pools, …) and the existing API keys SHALL retain their key material

#### Scenario: No partial-shape save path exists

- **WHEN** any code path triggers a state save
- **THEN** it SHALL persist the full state shape produced by the single canonical state builder

### Requirement: Saves do not block or race on the request path

State saves SHALL be coalesced and serialized: concurrent or rapid mutations SHALL
NOT issue overlapping file writes, write ordering SHALL be preserved (no stale
snapshot overwriting a newer one), and a routine LLM proxy request (`/v1/*`) SHALL
NOT trigger a full-state rewrite. Metering data already durable elsewhere
(`usage_log` in SQLite) SHALL NOT be re-persisted into the JSON state on the hot
path, and config revision history SHALL be bounded.

#### Scenario: Burst of mutations coalesces

- **WHEN** several state-mutating requests complete in quick succession
- **THEN** the writes SHALL coalesce/serialize through a single-flight path with no overlapping or out-of-order file writes

#### Scenario: Proxy request does not rewrite config state

- **WHEN** a normal `/v1/*` completion is served
- **THEN** it SHALL NOT trigger a full rewrite of the non-money state file

#### Scenario: Revision history is bounded

- **WHEN** config is published repeatedly over time
- **THEN** the retained revision history SHALL be capped, not grow without limit

### Requirement: State file validation and versioning

The persisted state SHALL carry a schema version. On load the gateway SHALL validate
the critical slices (accounts, secrets, API keys, model mappings) and SHALL report a
clear error (with the offending location) when they are structurally invalid, rather
than loading silently-wrong data or crashing later far from the load site. Older
versioned files SHALL be migrated forward.

#### Scenario: Older file migrates forward

- **WHEN** a state file without a schema version (older format) is loaded
- **THEN** it SHALL be treated as the baseline version and migrated forward without data loss

#### Scenario: Structurally invalid critical slice fails loudly

- **WHEN** a critical slice in the state file is malformed
- **THEN** load SHALL fail with a message identifying the slice/field, not silently load a broken shape
