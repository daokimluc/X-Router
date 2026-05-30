## ADDED Requirements

### Requirement: Settlement conserves money

Settlement SHALL conserve money: for every settled marketplace request, the amount
credited to the seller plus the platform margin SHALL equal the amount actually
collected from the buyer. The seller SHALL NOT be credited more than was collected
for that request. When the buyer side cannot cover the full sell cost (e.g. a
wallet floored at zero), the
platform margin SHALL absorb the shortfall before the seller credit is reduced.

#### Scenario: Underfunded settle does not over-credit the seller

- **WHEN** a request's actual sell cost exceeds the buyer's remaining funds so the wallet floors at zero
- **THEN** the seller SHALL be credited no more than the collected amount, the platform margin SHALL be the remainder (possibly zero), and `collected = sellerCredit + platformMargin`

#### Scenario: Fully funded settle is unchanged

- **WHEN** the buyer's funds fully cover the sell cost
- **THEN** the seller credit and platform margin SHALL be exactly the cost-minus-commission split as before

### Requirement: Metered requests never settle free

A marketplace-metered request that held a plan or wallet reservation SHALL NOT be
settled to zero cost because of a missing listing price. When the routed cost is
unavailable, the gateway SHALL settle against a fallback cost (the house listing
cost for the base model, else the engine model cost) and SHALL log a warning.

#### Scenario: Unlisted leased account still charges the buyer

- **WHEN** a metered request is served by an account that has no listing cost (routed context unset)
- **THEN** the buyer SHALL be charged the fallback cost (not zero) and a warning SHALL be logged

#### Scenario: Non-metered request is untouched

- **WHEN** a request held no plan or wallet reservation (not a marketplace request)
- **THEN** settlement SHALL be a no-op

### Requirement: Refund and reversal primitives

The gateway SHALL provide audited primitives to refund a buyer wallet, reverse or
adjust a seller's accrued credit, and fully reverse a recorded settlement. Each
SHALL append a reason-tagged row to the durable settlement/payout log so the audit
trail shows the original movement and its reversal. A wallet SHALL NOT go negative
and a full settlement reversal SHALL be idempotent.

#### Scenario: Buyer refund credits the wallet and is logged

- **WHEN** an admin issues a refund of `$2.00` to a buyer's wallet with a reason
- **THEN** the wallet balance SHALL increase by `$2.00` and a reversal row SHALL be recorded

#### Scenario: Payout reversal restores unpaid

- **WHEN** a seller payout that was marked paid is reversed (e.g. the bank transfer failed)
- **THEN** the seller's unpaid balance SHALL increase by the reversed amount and the reversal SHALL be logged

#### Scenario: Full settlement reversal unwinds all three figures once

- **WHEN** a recorded settlement row is reversed
- **THEN** the buyer SHALL be refunded the collected amount, the seller credit and platform margin for that row SHALL be unwound, and reversing the same row again SHALL have no further effect

### Requirement: Solvency reconciliation

The gateway SHALL be able to reconcile, from the durable log, that each seller's
unpaid balance equals its summed credits minus payouts and reversals, and that the
platform never credits sellers more in total than it has collected. A detected
inconsistency SHALL be logged as an error and SHALL NOT fail the originating
request.

#### Scenario: Seller balance reconciles to the log

- **WHEN** reconciliation runs for a seller with a history of credits, a payout, and a reversal
- **THEN** the computed unpaid SHALL equal `Σ credits − Σ payouts − Σ reversals` and match the live aggregate

#### Scenario: Platform solvency holds

- **WHEN** platform reconciliation runs
- **THEN** total collected SHALL be greater than or equal to total seller credit, and the recorded platform margin SHALL equal collected minus seller credit
