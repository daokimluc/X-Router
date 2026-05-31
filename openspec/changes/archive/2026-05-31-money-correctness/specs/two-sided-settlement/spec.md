## MODIFIED Requirements

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
