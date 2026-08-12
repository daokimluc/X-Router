# foza-persistence

Durable, SQLite-backed storage for the state Foza owns (identity, user↔resource
mappings, top-up history, money ledgers, webhook event log), replacing the
in-memory `globalThis` stores so tenant-scoping and money correctness survive
restarts and concurrent writes. Catalog state (plans/sellers/listings/markup)
remains a live read from X-Router and is NOT stored here.

## ADDED Requirements

### Requirement: Durable store for Foza-owned state

Foza SHALL persist the state it owns to a transactional on-disk store, not to
process memory.

#### Scenario: State survives restart
- **WHEN** the Foza server restarts
- **THEN** users, user↔keyId/sellerId mappings, top-up history, money ledgers, and
  the webhook event log SHALL still be present

#### Scenario: No catalog duplication
- **WHEN** Foza needs plans, sellers, listings, or markup
- **THEN** it SHALL read them live from X-Router and SHALL NOT store a copy in its
  own database

### Requirement: Server-only database access

The database module SHALL be reachable only from server code.

#### Scenario: Server-only import
- **WHEN** the db module is imported from a client component
- **THEN** the build SHALL fail (the module is marked server-only)

#### Scenario: Not used in proxy
- **WHEN** the request passes through `proxy.ts`
- **THEN** the proxy SHALL perform only an optimistic cookie/JWT check and SHALL
  NOT query the database

### Requirement: Concurrency-safe writes

Concurrent writes SHALL NOT corrupt stored state.

#### Scenario: Concurrent webhook writes
- **WHEN** two `usage.recorded` events are processed at the same time
- **THEN** each SHALL be written atomically with no lost update or partial row

### Requirement: Idempotency keyed by settlementId

The webhook event log and money ledgers SHALL use `settlementId` as the dedupe /
primary key, never a content hash of the envelope.

#### Scenario: Identical-second duplicate request
- **WHEN** two genuinely distinct settlements would produce identical
  `{event,timestamp,data}` envelopes in the same second but carry different
  `settlementId`
- **THEN** both SHALL be stored as separate rows

#### Scenario: Re-delivered event
- **WHEN** the same `settlementId` arrives more than once
- **THEN** it SHALL be stored/processed exactly once

### Requirement: One-time migration from the file store

Existing file-backed users SHALL be migrated into the database without loss.

#### Scenario: Import on first run
- **WHEN** the database has no users and `.data/users.json` exists
- **THEN** each record SHALL be imported (passwordHash carried over verbatim) and
  the JSON file SHALL be left in place as a backup

#### Scenario: Migrated user can sign in
- **WHEN** a user that existed before migration signs in afterward
- **THEN** their existing password SHALL authenticate successfully

### Requirement: Stable module API for callers

Swapping in the database SHALL NOT change the signatures callers already use.

#### Scenario: Auth flow unchanged
- **WHEN** registration, verification, and login run after the swap
- **THEN** they SHALL behave identically to the file-backed version, with no
  caller-side changes beyond the store module itself
