## ADDED Requirements

### Requirement: Plan presets sold by the platform

The gateway SHALL maintain a set of `Plan` presets, each defining `{ id, name, priceUsd, modelGroups, buckets: { hourUsd, dayUsd, monthUsd }, overageEnabled, paygDailyLimitUsd? }`. It SHALL seed four defaults — `free`, `claude`, `codex`, `pro` — and SHALL allow an admin to create, update, and delete plans. Persisted plan edits SHALL NOT be overwritten by re-seeding on restart.

#### Scenario: Default plans are seeded on first run

- **WHEN** the gateway starts with no persisted plans
- **THEN** plans `free`, `claude`, `codex`, and `pro` SHALL exist, with `pro` granting all model groups (`"*"`)

#### Scenario: Admin edits survive restart

- **WHEN** an admin changes `claude` plan's `monthUsd` to `25.00`, the gateway persists and restarts
- **THEN** the `claude` plan SHALL still have `monthUsd = 25.00` and SHALL NOT be reset to the seed value

### Requirement: Deterministic model-to-group mapping

The gateway SHALL provide `modelGroupOf(model)` returning a stable group label for any model name, and a plan SHALL grant access to one or more groups (or `"*"` for all). The mapping SHALL be pure and deterministic.

#### Scenario: Claude model maps to claude group

- **WHEN** `modelGroupOf("claude-sonnet-4-6")` is evaluated
- **THEN** it SHALL return `"claude"`

#### Scenario: Wildcard plan matches every group

- **WHEN** a plan has `modelGroups: ["*"]` and a request uses any model
- **THEN** the model SHALL be considered in scope

### Requirement: A key bound to a plan is gated by the plan's model scope

When an API key has a `planId`, a request whose model's group is not in the plan's `modelGroups` (and the plan is not wildcard) SHALL be rejected with HTTP 403 and `code: "model_not_in_plan"`, before any provider is called.

#### Scenario: Out-of-scope model rejected

- **WHEN** a key bound to the `claude` plan makes a request for a Codex-group model
- **THEN** the gateway SHALL respond HTTP 403 with `code: "model_not_in_plan"` and SHALL NOT call any provider

#### Scenario: In-scope model proceeds

- **WHEN** a key bound to the `claude` plan makes a request for `claude-sonnet-4-6` within its caps
- **THEN** the request SHALL proceed to routing

### Requirement: Plan spend buckets enforced per model group

For a plan-bound key, the gateway SHALL reserve the request's upper-bound estimate against the plan's hour, day, and month caps using a per-group ledger scope (`key:<id>:grp:<group>`). Spend in one group SHALL NOT consume another group's budget.

#### Scenario: Hour speed-limit breach makes the buyer wait

- **WHEN** a plan-bound request would exceed the plan's `hourUsd` cap for its group, while day and month budgets remain
- **THEN** the gateway SHALL respond HTTP 429 with `code: "spend_limit_exceeded"` and a `Retry-After` header counting to the next UTC hour, and SHALL NOT auto-charge the wallet

#### Scenario: Day speed-limit breach makes the buyer wait

- **WHEN** a plan-bound request would exceed the plan's `dayUsd` cap while the month budget remains
- **THEN** the gateway SHALL respond HTTP 429 with a `Retry-After` counting to the next UTC day

#### Scenario: Independent buckets per group

- **WHEN** a `pro`-plan key has spent its full `dayUsd` in the `claude` group
- **THEN** a request in the `codex` group under the same key SHALL still be allowed (separate day bucket)

### Requirement: Month-budget exhaustion respects the overage flag

When a plan-bound request would exceed the plan's `monthUsd` budget for its group, the gateway SHALL consult the effective overage setting (key override, else plan default). If overage is disabled, the request SHALL be blocked. If overage is enabled, the gateway SHALL hand off to the pay-as-you-go decision; until that decision is implemented, the gateway SHALL respond HTTP 402 with a clear `payg_not_implemented` message.

#### Scenario: Month budget spent, overage off, request blocked

- **WHEN** a plan-bound key has spent its full `monthUsd` for the group and overage is disabled
- **THEN** the request SHALL be rejected and SHALL NOT call any provider

#### Scenario: Month budget spent, overage on, defers to PAYG

- **WHEN** the same key has overage enabled and the PAYG decision is not yet implemented
- **THEN** the gateway SHALL respond HTTP 402 with `code: "payg_not_implemented"`

### Requirement: Per-key override of overage and PAYG daily limit

A key MAY override the plan's `overageEnabled` and SHALL carry a user-set `paygDailyLimitUsd`. Effective values SHALL resolve as key override first, plan default second.

#### Scenario: Key enables overage despite plan default off

- **WHEN** a plan defaults `overageEnabled: false` but the key sets `overageEnabled: true`
- **THEN** the effective overage SHALL be `true`

### Requirement: Keys without a plan keep legacy enforcement

A key with no `planId` SHALL be enforced exactly as before this change — admin-set per-key/team caps only, no plan scope, no per-group bucketing.

#### Scenario: Plan-less key unaffected

- **WHEN** a key with no `planId` and an admin `dailySpendLimitUsd` makes a request
- **THEN** enforcement SHALL use the admin daily cap and SHALL NOT apply any plan scope or group bucket
