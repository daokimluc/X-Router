# xrouter-money-ledger

A durable, idempotent buyer-billing and seller-payable ledger fed by the
`usage.recorded` webhook and reconciled against X-Router's per-record
`/provision/settlements` and total `/provision/earnings`. X-Router is the source of
truth; Foza keeps a reconciled local copy so money records survive missed webhooks
and gateway downtime without drifting.

## ADDED Requirements

### Requirement: Durable money ledger fed by usage.recorded

Foza SHALL record every settled request to a durable buyer-billing and (where
applicable) seller-payable ledger.

#### Scenario: Settlement recorded
- **WHEN** a signed `usage.recorded` event is received
- **THEN** Foza SHALL write one billing row for the buyer (charged `actualSellCost`)
  and, unless `sellerId="house"`, one payable row for the seller (`sellerCredit`)

#### Scenario: House excluded from payable
- **WHEN** the settled `sellerId` is `house`
- **THEN** no seller-payable row SHALL be written (platform supply, no external
  payout)

### Requirement: Idempotent ingest by settlementId

Recording SHALL be keyed by the `settlementId` carried in the `usage.recorded`
payload, never a content hash of the envelope.

#### Scenario: Dedupe on payload settlementId
- **WHEN** a `usage.recorded` event is received
- **THEN** Foza SHALL read `settlementId` from the payload and use it as the dedupe
  key, not `event:timestamp:JSON(data)`

#### Scenario: Re-delivered event
- **WHEN** the same `settlementId` is received more than once
- **THEN** the ledger SHALL reflect it exactly once

#### Scenario: Distinct settlements, identical envelope
- **WHEN** two settlements carry different `settlementId` but otherwise identical
  `{event,timestamp,data}`
- **THEN** both SHALL be recorded as separate rows

### Requirement: Reconciliation against X-Router

Foza SHALL be able to rebuild missed records and detect drift from X-Router.

#### Scenario: Missed event recovered
- **WHEN** a `usage.recorded` event was missed and reconciliation runs
- **THEN** Foza SHALL replay `GET /provision/settlements` since the last checkpoint
  and insert the missing rows keyed by `settlementId`

#### Scenario: Reconciliation is re-runnable
- **WHEN** reconciliation runs again over an already-recorded range
- **THEN** no row SHALL be duplicated and totals SHALL be unchanged

#### Scenario: Reversed settlement excluded
- **WHEN** a settlement is marked `reversed` in `/provision/settlements`
- **THEN** it SHALL be excluded from both the billing and payable totals

### Requirement: Earnings snapshot is the payout figure of record

Seller payout amounts SHALL be taken from X-Router's earnings snapshot, not from
Foza's own sum.

#### Scenario: Payout total
- **WHEN** the operator needs the amount owed to a seller
- **THEN** Foza SHALL use `GET /provision/earnings/:sellerId` as the figure of
  record, using its `payable_ledger` only for per-record detail

#### Scenario: Drift alert
- **WHEN** Foza's `payable_ledger` sum disagrees with the earnings snapshot for a
  seller
- **THEN** Foza SHALL surface a reconciliation alert rather than silently trusting
  its own sum

### Requirement: Correct money semantics

Billing SHALL use the amount actually collected, not a recomputed price.

#### Scenario: Bill by actualSellCost
- **WHEN** a buyer is billed for a request
- **THEN** Foza SHALL charge `actualSellCost` from the event and SHALL NOT recompute
  the charge from price × tokens
