# marketplace-money-hardening Specification

## Purpose
TBD - created by archiving change marketplace-money-hardening. Update Purpose after archive.
## Requirements
### Requirement: Subscription charges are idempotent per billing period and durable

The gateway SHALL record each subscription charge (subscribe or renew) with a durable,
unique idempotency token `(keyId, planId, periodEnd, kind)` written in the **same database
transaction** as the wallet debit. A charge whose token already exists SHALL NOT debit the
wallet a second time, regardless of process restarts or the in-memory subscription period
being stale.

#### Scenario: A renewal is charged once per period despite a restart

- **WHEN** a key's subscription renews (wallet debited for `periodEnd = P`), the process restarts before the new period is persisted, and the renewal is evaluated again for the same period `P`
- **THEN** the gateway SHALL NOT debit the wallet again, because the `(keyId, planId, P, "renew")` charge token already exists

#### Scenario: A repeated subscribe does not double-charge

- **WHEN** a subscribe charge commits but the plan binding is lost to a crash, and the buyer re-subscribes to the same plan and period
- **THEN** the gateway SHALL NOT debit the wallet again for that period

### Requirement: Prepaid token-pack value is excluded from wallet solvency accounting

The platform wallet-solvency reconciliation SHALL count only money that entered the wallet
system (plan and PAYG tracks). Token-pack settlement value SHALL be excluded from
`totalCollected` and from the wallet platform-margin total, because a pack is paid to the
website off-platform. Prepaid-pack health SHALL be reconciled separately: the recognized
pack sell-value SHALL NOT exceed the total `pricePaidUsd` of granted packs.

#### Scenario: Pack traffic does not inflate wallet solvency

- **WHEN** requests are served from prepaid token packs (no wallet money moved)
- **THEN** the wallet `reconcilePlatform` `totalCollected` and platform margin SHALL be unchanged by those requests

#### Scenario: Pack reconciliation is reported separately

- **WHEN** the books-health endpoint is read
- **THEN** it SHALL report wallet solvency and prepaid-pack solvency as distinct lines, and pack solvency SHALL hold when recognized pack value does not exceed total `pricePaidUsd`

### Requirement: A served pack request still credits the seller

A token-pack request that consumes a non-house seller's supply SHALL credit that seller
for the supply consumed (cost minus commission), exactly as on other tracks. Excluding pack
value from wallet solvency SHALL NOT remove the seller's earned credit.

#### Scenario: Seller credited for pack-backed supply

- **WHEN** a pack-backed request to a commissioned seller completes
- **THEN** the seller's accrued credit SHALL increase by the supply value minus commission

### Requirement: Held reservations are released on every request exit path

The gateway SHALL release any wallet (PAYG/boost), plan-bucket, or token-pack reservation
held during enforcement when the response finishes, including on early-return paths (cache
hit, direct-account 404, no-provider) that bypass the settlement hook. No reservation SHALL
remain held past the end of the request that created it.

#### Scenario: Cache hit releases a held wallet reservation

- **WHEN** a request reserves wallet funds during enforcement and then returns early from a cache hit (never reaching settlement)
- **THEN** the held wallet reservation SHALL be released and the reserved funds restored before the next request

### Requirement: Seller payouts are idempotent and bounded

`markPaid` SHALL be idempotent on the payout reference: a repeated payout with the same
reference SHALL log one payout and reduce `unpaid` once. It SHALL reject an amount greater
than the seller's current `unpaid`, and SHALL NOT log a payout for an unknown seller.

#### Scenario: Duplicate payout reference is a no-op

- **WHEN** `markPaid` is called twice with the same `payoutRef`
- **THEN** exactly one payout SHALL be recorded and `unpaid` SHALL be reduced only once

#### Scenario: Over-payout is rejected

- **WHEN** an admin marks paid an amount greater than the seller's `unpaid`
- **THEN** the gateway SHALL reject the request with HTTP 400 and SHALL NOT record the payout

### Requirement: An over-payout (unrecoverable clawback) is reported, not hidden

The gateway SHALL report an over-payout rather than hide it: when a settlement is reversed
after the seller was already paid out, seller reconciliation SHALL report `ok=false` and
surface the over-paid amount, rather than flooring the expected balance to zero and
reporting agreement.

#### Scenario: Clawback after payout is detected

- **WHEN** a seller is credited, paid out in full, and then the settlement is reversed
- **THEN** `reconcileSeller` SHALL report `ok=false` and an `overPaidUsd` greater than zero

### Requirement: The SQLite wallet balance is the sole money authority on boot

The gateway SHALL NOT reseed a wallet balance from the denormalized `walletMicroUsd` key
snapshot at boot. A wallet's authoritative balance SHALL be the SQLite `wallets` row; the
snapshot SHALL be used for display only.

#### Scenario: A stale snapshot does not restore phantom funds

- **WHEN** a key record carries `walletMicroUsd` but the SQLite wallet row is absent at boot
- **THEN** the wallet SHALL remain unprovisioned (zero) and SHALL NOT be reseeded from the snapshot

