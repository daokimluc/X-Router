## MODIFIED Requirements

### Requirement: Month-budget exhaustion respects the overage flag

When a plan-bound request would exceed the plan's `monthUsd` budget for its group, the gateway SHALL consult the effective overage setting (key override, else plan default). If overage is disabled, the request SHALL be blocked. If overage is enabled, the gateway SHALL invoke the pay-as-you-go decision, which charges the wallet at the sell price when funds and the PAYG daily limit allow, and otherwise rejects with 402 (no funds) or 429 (PAYG daily limit).

#### Scenario: Month budget spent, overage off, request blocked

- **WHEN** a plan-bound key has spent its full `monthUsd` for the group and overage is disabled
- **THEN** the request SHALL be rejected and SHALL NOT call any provider

#### Scenario: Month budget spent, overage on, charged via PAYG

- **WHEN** the same key has overage enabled, a funded wallet, and is within its PAYG daily limit
- **THEN** the request SHALL proceed and be charged to the wallet at the sell price
