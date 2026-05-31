# two-sided-settlement Specification

## Purpose
TBD - created by archiving change two-sided-settlement. Update Purpose after archive.
## Requirements
### Requirement: Two-sided settlement on request completion

On successful completion of a marketplace request, the gateway SHALL settle the
buyer side first and credit the serving seller from the amount **actually
collected**, not from the intended sell price. The seller credit SHALL be the
lesser of `actualBaseCost × (1 − commissionPct)` and the collected amount; the
platform margin SHALL be the remainder, absorbing any shortfall before the seller
credit is reduced, so that `collected = sellerCredit + platformMargin`. The house
seller SHALL receive no external credit; for house-served requests the full
collected amount SHALL be platform margin. A metered request whose routed cost is
unavailable SHALL be settled against a fallback cost, never zero.

#### Scenario: Third-party request splits collected funds

- **WHEN** a request served by a third-party seller settles and the buyer's funds fully cover the sell cost of `$0.0060` with `actualBaseCost $0.0052` and `commissionPct 0.08`
- **THEN** the seller SHALL be credited `$0.004784` and the platform margin SHALL be `$0.001216`, summing to the `$0.0060` collected

#### Scenario: Shortfall reduces margin before seller credit

- **WHEN** the buyer wallet can only cover `$0.0050` of a `$0.0060` sell cost
- **THEN** `sellerCredit + platformMargin` SHALL equal the `$0.0050` collected, with the platform margin reduced first

#### Scenario: House request credits no seller

- **WHEN** a request served by the house seller settles with collected `$0.0060`
- **THEN** no external seller credit SHALL be recorded and the platform margin SHALL be `$0.0060`

#### Scenario: Failed request settles nothing to the seller

- **WHEN** a marketplace request fails before producing a billable completion
- **THEN** the seller SHALL NOT be credited and the buyer's reservation SHALL be released

### Requirement: Buyer-debit track is fixed at reservation time

Each request SHALL be tagged at reservation as either `plan` (metered against the plan's per-group spend bucket) or `payg` (charged against the USD wallet). A single request SHALL NOT be split across both tracks; the track chosen at reservation SHALL be the track settled at completion.

#### Scenario: Within-budget request settles the plan bucket only

- **WHEN** a request's upper-bound estimate fits within the remaining month budget and it is tagged `plan`
- **THEN** completion SHALL settle the plan group bucket and SHALL NOT debit the wallet

#### Scenario: Overage request settles the wallet only

- **WHEN** a request is tagged `payg` because the month budget is exhausted
- **THEN** completion SHALL settle the wallet reservation and SHALL NOT move any plan bucket

### Requirement: Seller earnings accrue for payout reporting

The gateway SHALL maintain a per-seller earnings ledger accruing credited USD across day, month, and lifetime, plus an `unpaid` balance. The website SHALL be able to read a seller's snapshot and to mark an amount paid, which SHALL reduce `unpaid`. House SHALL never accrue earnings.

#### Scenario: Credit increases unpaid and rolls up

- **WHEN** seller `cinb` is credited `$0.004784`
- **THEN** the seller's day, month, lifetime, and unpaid totals SHALL each increase by `$0.004784`

#### Scenario: Marking paid reduces unpaid only

- **WHEN** `cinb` has `unpaid = $10.00` and a payout of `$10.00` is marked paid
- **THEN** `unpaid` SHALL become `$0.00` while lifetime SHALL be unchanged

### Requirement: Pay-as-you-go decision for overage and boost

When a plan-bound request would breach a bucket, the gateway SHALL apply a PAYG decision: if overage is disabled it SHALL block; if the wallet is unprovisioned or has insufficient funds it SHALL respond HTTP 402 `insufficient_balance`; if charging would exceed the user-set PAYG daily limit it SHALL respond HTTP 429 with a `Retry-After` to the next UTC day; otherwise it SHALL charge the wallet at the sell price. Overage (month budget spent) and boost (hour/day speed-limit with month budget remaining) SHALL use the same sell price.

#### Scenario: Overage charges the wallet at sell price

- **WHEN** the month budget is exhausted, overage is enabled, and the wallet has sufficient funds within the PAYG daily limit
- **THEN** the request SHALL proceed and be charged to the wallet at the sell price

#### Scenario: PAYG daily limit makes the buyer wait

- **WHEN** a PAYG charge would push today's PAYG spend past the user-set `paygDailyLimitUsd`
- **THEN** the request SHALL be rejected HTTP 429 with a `Retry-After` to the next UTC day, and the wallet SHALL NOT be charged

#### Scenario: Insufficient wallet returns 402

- **WHEN** overage is enabled but the wallet cannot cover the upper-bound estimate
- **THEN** the request SHALL be rejected HTTP 402 `insufficient_balance`

### Requirement: Boost is opt-in and does not consume the month budget

A request rejected for an hour or day speed-limit SHALL proceed via PAYG only when boost is explicitly enabled (request header `x-allow-boost` or a per-key boost flag). A boost charge SHALL debit the wallet and SHALL NOT reduce the plan's remaining month budget.

#### Scenario: Speed-limit without boost waits

- **WHEN** an hour speed-limit is hit, the month budget remains, and neither the boost header nor the key boost flag is set
- **THEN** the request SHALL be rejected HTTP 429 (wait) and the wallet SHALL NOT be charged

#### Scenario: Speed-limit with boost serves from wallet and preserves month budget

- **WHEN** an hour speed-limit is hit, boost is enabled, and the wallet has funds within the PAYG daily limit
- **THEN** the request SHALL proceed charged to the wallet, and the plan's remaining month budget SHALL be unchanged

