# usd-wallet Specification

## Purpose
TBD - created by archiving change usd-wallet. Update Purpose after archive.
## Requirements
### Requirement: Per-key prepaid balance denominated in USD

The gateway SHALL maintain a per-key prepaid balance in US dollars, stored internally as an integer number of micro-USD (1 micro-USD = $0.000001). A key's wallet MAY be **unprovisioned** (no balance record), **provisioned and empty** (balance 0), or **funded** (balance > 0). A wallet balance SHALL never be negative.

#### Scenario: USD topup converts to micro-USD losslessly

- **WHEN** an admin tops up a key's wallet by `$20.00`
- **THEN** the stored balance SHALL be `20000000` micro-USD and `getUsd` SHALL return `20`

#### Scenario: Sub-cent debit floored at zero

- **WHEN** a funded wallet holding `$0.0003` is debited `$0.0004`
- **THEN** the resulting balance SHALL be `$0` (not negative) and the debit SHALL report `ok: false`

#### Scenario: Exact debit reaches zero and succeeds

- **WHEN** a wallet holding `$0.0004` is debited `$0.0004`
- **THEN** the balance SHALL be `$0` and the debit SHALL report `ok: true`

### Requirement: Funds check distinguishes unprovisioned from empty

`hasFundsUsd(keyId, requiredUsd)` SHALL return `false` for a key with no provisioned wallet AND for a provisioned wallet whose balance is less than `requiredUsd`. It SHALL return `true` only when a provisioned wallet's balance is greater than or equal to `requiredUsd`.

#### Scenario: Unprovisioned wallet has no funds

- **WHEN** `hasFundsUsd` is called for a key that has never been provisioned a wallet
- **THEN** it SHALL return `false`

#### Scenario: Provisioned but empty wallet has no funds

- **WHEN** `hasFundsUsd(key, 0.01)` is called for a key whose wallet was opened (balance `$0`)
- **THEN** it SHALL return `false`

#### Scenario: Funded wallet covering the requirement

- **WHEN** `hasFundsUsd(key, 0.01)` is called for a wallet holding `$0.50`
- **THEN** it SHALL return `true`

### Requirement: Hold-and-settle reservation in USD

The wallet SHALL support a hold-and-settle reservation so a request can reserve an upper-bound USD estimate before execution, then settle to the actual cost or release on failure. `reserveUsd` SHALL deduct the estimate immediately so concurrent requests cannot reserve the same funds twice. `settleUsd` SHALL refund the difference when the actual cost is less than the reserved estimate. `releaseUsd` SHALL refund the full reserved estimate.

#### Scenario: Reservation rejected when funds insufficient

- **WHEN** a wallet holding `$0.05` receives `reserveUsd({ estimateUsd: 0.10 })`
- **THEN** the result SHALL be `ok: false` with `reason: "insufficient_funds"` and the balance SHALL remain `$0.05`

#### Scenario: Reservation then settle refunds the unused estimate

- **WHEN** a wallet holding `$1.00` reserves `$0.20`, then settles with actual `$0.07`
- **THEN** after the reservation the balance SHALL be `$0.80`, and after settle the balance SHALL be `$0.93`

#### Scenario: Reservation then release refunds the full estimate

- **WHEN** a wallet holding `$1.00` reserves `$0.20`, then the request fails and the reservation is released
- **THEN** the balance SHALL return to `$1.00`

#### Scenario: Concurrent reservations cannot overspend

- **WHEN** a wallet holding `$0.15` receives two `reserveUsd({ estimateUsd: 0.10 })` calls before either settles
- **THEN** exactly one reservation SHALL succeed and the other SHALL fail with `insufficient_funds`

### Requirement: Wallet state persists across gateway restart

Wallet balances SHALL be persisted through `PersistenceService` and restored on startup, with writes debounced to at most one per 5 seconds. Active (unsettled) reservations need not survive restart.

#### Scenario: Balance survives restart

- **WHEN** a wallet holding `$12.34` is persisted and the gateway restarts and reloads state
- **THEN** `getUsd` SHALL return `12.34`

### Requirement: Legacy token balance migrated to a zero USD wallet

On loading persisted state, any key that carries the legacy token-based `balance` field and has no USD wallet SHALL be migrated to a provisioned wallet with balance `$0`, the legacy `balance` SHALL be dropped, and a warning SHALL be logged. The migration SHALL be idempotent across reloads. Legacy token counts SHALL NOT be converted to USD.

#### Scenario: Legacy token balance becomes a zero wallet with a warning

- **WHEN** the gateway loads a persisted key with legacy `balance: 50000` (tokens) and no `walletMicroUsd`
- **THEN** that key SHALL end with a provisioned `$0` wallet, the legacy `balance` SHALL no longer be present, and a `wallet-migration` warning SHALL be logged

#### Scenario: Migration is idempotent

- **WHEN** state already migrated (key has a USD wallet, no legacy `balance`) is loaded again
- **THEN** the wallet balance SHALL be unchanged and no migration warning SHALL be logged

