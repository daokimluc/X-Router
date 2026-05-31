## MODIFIED Requirements

### Requirement: Payout marking provisioning

The gateway SHALL expose `POST /provision/earnings/:sellerId/mark-paid` to record
that a seller payout has been settled off-platform, delegating to the seller
earnings ledger, reducing the seller's `unpaid` balance and returning the updated
snapshot. The endpoint SHALL accept the payout amount and SHALL persist the
optional `payoutRef` on the recorded payout (it SHALL NOT be silently dropped).
The amount field SHALL accept the canonical name `usd`; the legacy `amountUsd`
name MAY also be accepted during deprecation.

#### Scenario: Mark a payout paid reduces unpaid and persists the reference

- **WHEN** the website calls mark-paid with an amount equal to the seller's `unpaid` and a `payoutRef`
- **THEN** the seller's `unpaid` SHALL become zero, lifetime earnings SHALL be unchanged, and the `payoutRef` SHALL be persisted on the payout record

#### Scenario: Privileged provision routes are rate-limited

- **WHEN** mark-paid (a privileged route) is called past the configured rate cap
- **THEN** further calls SHALL be rejected HTTP 429 until the window resets
