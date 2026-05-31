# persistence-sqlite Specification

## Purpose
TBD - created by archiving change persistence-sqlite. Update Purpose after archive.
## Requirements
### Requirement: Transactional money state is durable in SQLite

The gateway SHALL store transactional money and metering state — wallet balances,
wallet reservations, seller earnings, the platform margin total, spend-ledger
buckets, spend reservations, and a per-request settlement log — in an embedded
SQLite database written synchronously and atomically. A committed money mutation
SHALL survive process crash and power loss without a debounce window.
Configuration state (provider accounts, model mappings, plans, sellers, listings,
markup, webhook config) MAY continue to use the JSON persistence store.

#### Scenario: Settled charge survives an unclean restart

- **WHEN** a request settles a buyer charge and the process is killed without a clean shutdown
- **THEN** after restart the wallet balance SHALL reflect the settled charge (no debounce loss)

#### Scenario: Money mutation is atomic

- **WHEN** a reservation (check balance, debit, insert reservation row) is interrupted mid-operation
- **THEN** either all steps SHALL be applied or none, never a partial state

### Requirement: Reservations are persisted and survive restart

Active hold-and-settle reservations (wallet and spend-ledger) SHALL be stored
durably, so that a restart between reserve and settle does not orphan a debit. On
startup the gateway SHALL reconcile reservations that did not survive their
originating request by releasing them, returning the held funds.

#### Scenario: Held funds restored after a crash mid-request

- **WHEN** a wallet reservation debits the balance, then the process crashes before settle, then restarts
- **THEN** the reservation SHALL be present after restart and the startup reconciliation SHALL release it, returning the held amount to the balance

#### Scenario: Reserve then settle across a restart

- **WHEN** a reservation exists in SQLite and the gateway restarts before settling
- **THEN** a subsequent settle of that reservation SHALL adjust the balance correctly (or, if swept on boot, the funds SHALL already be released — never double-counted)

### Requirement: Per-request settlement log enables payout reconstruction

The gateway SHALL append one durable settlement-log row per billable settlement,
recording buyer key, base model, seller, tokens, sell cost, seller credit, and
platform margin. Seller earnings and unpaid balances SHALL be reconstructable by
aggregating the settlement log against recorded payouts, so a lost in-memory
aggregate or a missed `usage.recorded` webhook does not permanently lose payout
debt.

#### Scenario: Seller earnings rebuilt from the log

- **WHEN** the settlement log contains a seller's credited requests and the recorded payouts for that seller
- **THEN** the seller's lifetime and unpaid balances SHALL be recomputable from the log minus payouts, matching the live aggregate

### Requirement: One-time migration from legacy JSON money state

The gateway SHALL import legacy money state from JSON into SQLite exactly once on
first startup: when the SQLite money store is empty and a legacy JSON marketplace
or spend-ledger slice is present, it SHALL import wallet balances, seller earnings,
and spend buckets, then cease reading money from JSON. The import SHALL be
idempotent across restarts.

#### Scenario: Legacy balances imported once

- **WHEN** the gateway boots with SQLite empty and a JSON state holding wallet balances and seller earnings
- **THEN** those balances and earnings SHALL appear in SQLite with totals equal to the JSON values

#### Scenario: Re-boot does not double-import

- **WHEN** the gateway boots again after a successful import
- **THEN** balances SHALL be unchanged and the import SHALL NOT run a second time

