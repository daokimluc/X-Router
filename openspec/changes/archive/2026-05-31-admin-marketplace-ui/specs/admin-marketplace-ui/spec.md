## ADDED Requirements

### Requirement: Operator dashboard for marketplace management

The dashboard SHALL provide an admin-authenticated Marketplace section that lets
an operator manage plans, sellers, listings, earnings/payouts, wallets, markup,
canonical base models, and the business webhook by driving the existing admin
endpoints. The section SHALL render only when the marketplace is enabled and SHALL
NOT appear in the community (flag-off) build.

#### Scenario: Operator creates a plan from the dashboard

- **WHEN** an operator opens the Plans panel and creates a plan with model groups and hour/day/month buckets
- **THEN** the plan SHALL be created via the admin API and appear in the plan list

#### Scenario: Marketplace section hidden when disabled

- **WHEN** the gateway runs with the marketplace flag off
- **THEN** the dashboard SHALL NOT render the Marketplace section or its nav entry

### Requirement: Seller approval and term management in the dashboard

The dashboard SHALL present a seller approval queue and SHALL let the operator
approve, reject, suspend, and reactivate sellers, edit a seller's commission and
payout reference, and view each seller's earnings and unpaid balance.

#### Scenario: Operator approves a pending seller

- **WHEN** the operator approves a pending seller from the queue
- **THEN** the seller's status SHALL become approved and its listings SHALL become eligible for routing

### Requirement: Destructive money actions are confirmed and reasoned

Wallet refund/debit and payout/settlement reversal screens SHALL require an
explicit confirmation and a reason before submitting, and SHALL display the
resulting balance or unpaid amount after the action.

#### Scenario: Refund requires confirmation and reason

- **WHEN** the operator initiates a wallet refund
- **THEN** the UI SHALL require a confirmation and a reason before calling the API, and SHALL show the new balance afterward
