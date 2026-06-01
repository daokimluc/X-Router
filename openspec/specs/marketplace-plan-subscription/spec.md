# marketplace-plan-subscription Specification

## Purpose
TBD - created by archiving change marketplace-plan-subscription. Update Purpose after archive.
## Requirements
### Requirement: Subscribing to a paid plan charges the wallet

The gateway SHALL charge the wallet when `POST /provision/grant` binds a plan with
`priceUsd > 0` to a key: it SHALL require the wallet to hold at least `priceUsd`, debit
`priceUsd` (recording an audited `wallet_ledger` charge with reason
`plan_subscribe:<planId>`), set the subscription period, and only then bind the plan —
as one atomic operation. A plan SHALL NOT be bound if the charge does not succeed. A
`priceUsd === 0` (Free) plan SHALL bind with no charge and no period.

#### Scenario: Underfunded wallet cannot subscribe to a paid plan

- **WHEN** a key with a `$0` wallet requests `POST /provision/grant` for a `$10` plan
- **THEN** the gateway SHALL respond HTTP 402 with `code: "insufficient_funds"`, SHALL NOT debit the wallet, and the key's `planId` SHALL remain unchanged

#### Scenario: Funded wallet subscribes and is charged once

- **WHEN** a key with a `$15` wallet subscribes to a `$10` plan
- **THEN** the wallet balance SHALL become `$5`, a `wallet_ledger` charge of `$10` with reason `plan_subscribe:<planId>` SHALL be recorded, the key SHALL be bound to the plan, and `planPeriodEnd`/`planChargedAt` SHALL be set

#### Scenario: Free plan binds without charge

- **WHEN** a key subscribes to a `priceUsd: 0` plan
- **THEN** the plan SHALL bind, the wallet SHALL be untouched, and no subscription period SHALL be set

#### Scenario: Re-granting the same active plan does not re-charge

- **WHEN** a key already bound to a `$10` plan with a future `planPeriodEnd` requests `POST /provision/grant` for that same plan
- **THEN** the gateway SHALL return the key as-is with `idempotent: true` and SHALL NOT debit the wallet again

### Requirement: A paid plan auto-renews monthly from the wallet

A key bound to a `priceUsd > 0` plan SHALL be renewed once per subscription period: at
`now >= planPeriodEnd` the gateway SHALL debit `priceUsd` (audited reason
`plan_renew:<planId>`), advance `planPeriodEnd` by one calendar month from the prior
period end, reset the plan's monthly quota bucket(s), and emit a `plan.renewed` webhook.
If the wallet cannot cover `priceUsd`, the gateway SHALL downgrade the key to Free
(`planId = null`, clearing the period), emit a `plan.downgraded` webhook, and the
renewal-triggering request SHALL be rejected HTTP 402 with `code: "plan_renewal_failed"`.

#### Scenario: Funded renewal charges and resets the period

- **WHEN** a plan-bound key's `planPeriodEnd` has passed and its wallet holds at least `priceUsd`
- **THEN** the wallet SHALL be debited `priceUsd` with reason `plan_renew:<planId>`, `planPeriodEnd` SHALL advance one calendar month, the plan's monthly bucket SHALL reset to zero, and a `plan.renewed` webhook SHALL fire

#### Scenario: Underfunded renewal downgrades to Free

- **WHEN** a plan-bound key's `planPeriodEnd` has passed and its wallet cannot cover `priceUsd`
- **THEN** the key's `planId` SHALL be cleared to Free, `planChargedAt`/`planPeriodEnd` SHALL be cleared, a `plan.downgraded` webhook with `reason: "renewal_underfunded"` SHALL fire, and the triggering request SHALL be rejected HTTP 402 with `code: "plan_renewal_failed"`

#### Scenario: Renewal never double-charges

- **WHEN** a lazy renewal and the background monitor both observe the same expired period
- **THEN** exactly one charge SHALL occur — whichever advances `planPeriodEnd` first wins, and the other SHALL observe the advanced period and treat the key as not due

### Requirement: Lazy and background renewal cover both trafficked and idle keys

The gateway SHALL renew due subscriptions in two ways that share one renewal routine:
lazily within `marketplacePolicyCheck` (evaluated before the model-scope and bucket
checks) for keys that send traffic, and via a background `PlanRenewalMonitor` that
periodically scans all plan-bound keys for those past `planPeriodEnd`. Both SHALL call
the same `renewIfDue` routine, which SHALL re-check `now >= planPeriodEnd` so the two
paths never act on the same period twice.

#### Scenario: Idle key is renewed by the monitor

- **WHEN** a plan-bound key sends no traffic and its `planPeriodEnd` passes
- **THEN** the background monitor's scan SHALL renew (or downgrade) it without requiring a request

#### Scenario: Trafficked key is renewed lazily on its next request

- **WHEN** a plan-bound key whose `planPeriodEnd` has passed makes a request
- **THEN** the gateway SHALL renew (or downgrade) the key before evaluating the request's model scope and spend buckets

### Requirement: The published monthly quota resets with the subscription period

On a successful subscribe or renewal, the gateway SHALL reset the plan's per-group
**monthly** spend bucket(s) for the key to zero via `SpendLedgerService.resetMonth(scope)`,
for every group the plan grants. Hour and day buckets SHALL remain calendar-based (they
are rate limits, not the monthly allowance). `resetMonth` SHALL zero only the month
counter of the named scope and SHALL NOT alter the calendar-month rollover used by other
ledger scopes.

#### Scenario: Renewal zeroes the monthly bucket

- **WHEN** a plan-bound key has consumed part of its monthly quota and its subscription renews
- **THEN** the key's per-group monthly bucket SHALL be reset to zero while its hour/day buckets remain on the UTC calendar

#### Scenario: Multi-group plan resets every granted group

- **WHEN** a plan granting two model groups renews for a key that has spent in both
- **THEN** both groups' monthly buckets for that key SHALL be reset to zero

### Requirement: Subscription period uses a one-calendar-month clamp

The subscription period SHALL advance one calendar month, preserving the day-of-month
and clamping to the last day of a shorter month, computed by a pure
`addOneCalendarMonth(fromMs)` helper independent of the wall clock. Periods SHALL be
stored as epoch-millisecond numbers on the key record so they persist through JSON and
the SQLite config store without date revival.

#### Scenario: End-of-month subscribe clamps to the shorter month

- **WHEN** a subscription period is computed from January 31
- **THEN** `addOneCalendarMonth` SHALL return February 28 (or 29 in a leap year), not March 2 or 3

### Requirement: Switching and cancelling a plan (v1, no proration)

Switching to a different plan SHALL charge the new plan's full `priceUsd`, set a new
period, and reset the buckets, with no proration or refund of the prior plan's unused
period. Cancelling (`planId = null`) SHALL stop renewal and clear the period fields with
no refund of the current period.

#### Scenario: Switching plans charges the new plan in full

- **WHEN** a key bound to a `$10` plan is granted a `$20` plan
- **THEN** the wallet SHALL be charged `$20`, a fresh period SHALL be set, and the old plan's unused period SHALL NOT be refunded

#### Scenario: Cancelling stops renewal without refund

- **WHEN** a key bound to a paid plan is granted `planId: null`
- **THEN** `planId` SHALL be cleared, `planChargedAt`/`planPeriodEnd` SHALL be cleared, renewal SHALL stop, and no refund SHALL be issued

### Requirement: Legacy plan-bound keys are grandfathered without a retroactive charge

The gateway SHALL grandfather a key bound to a plan before this change: such a key
carries no `planPeriodEnd`, and on its first renewal evaluation the gateway SHALL set a
period one calendar month out **without charging** (it was granted under the prior
free-subscribe behavior). Subsequent renewals SHALL charge normally.

#### Scenario: Pre-existing plan key is not billed retroactively

- **WHEN** a plan-bound key with no `planPeriodEnd` is first evaluated for renewal
- **THEN** the gateway SHALL set `planPeriodEnd` one calendar month out, SHALL NOT debit the wallet, and SHALL allow the request to proceed

### Requirement: Subscription state is exposed on the provision read surface

`GET /provision/keys` and `GET /provision/wallet/:keyId` SHALL include `planPeriodEnd`
and `planChargedAt` (epoch-ms, or `null` when unset) so the website can render renewal
dates. The webhook event union SHALL include `plan.renewed` and `plan.downgraded`, and
both SHALL be subscribable through the business webhook config.

#### Scenario: Provision keys list reports the renewal date

- **WHEN** the website calls `GET /provision/keys` for a key on a paid plan
- **THEN** each key entry SHALL include `planPeriodEnd` and `planChargedAt` reflecting the current subscription period

