## MODIFIED Requirements

### Requirement: Atomic, recoverable state writes

The gateway SHALL persist non-money state in the transactional SQLite store (the
same `Database` substrate used for money/metering), with row-level reads and writes,
an id index per entity, and migration-versioned schema. Durability SHALL be provided
by the store's transactional, journaled writes rather than by a whole-document
rewrite; a crash or concurrent write SHALL NOT corrupt the state, and the gateway
SHALL boot from the store without a whole-file parse. Existing JSON state files SHALL
be imported once, idempotently, on first boot and then no longer used as the source
of truth.

#### Scenario: Crash mid-write does not brick startup

- **WHEN** a state write is interrupted (process crash)
- **THEN** the SQLite store SHALL remain consistent (committed rows intact, the interrupted transaction rolled back) and the gateway SHALL boot from it

#### Scenario: One-time JSON import is idempotent

- **WHEN** the gateway boots with an existing legacy JSON state file and no prior import marker
- **THEN** it SHALL import the JSON rows into SQLite once, set the marker, and on subsequent boots SHALL NOT re-import or double-insert

#### Scenario: Row-level update does not rewrite the whole state

- **WHEN** a single config entity (one account, key, or mapping) is changed
- **THEN** only that row SHALL be written, not the entire state document
