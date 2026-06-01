## Why

A buyer with a $0 wallet can subscribe to a paid plan ("Claude $10") for free: `POST
/provision/grant` only `apiKeyService.update({planId})` — it never charges. `plan.priceUsd`
is display-only metadata, used nowhere to take money. So a key gets the plan's quota
without paying for it. The website (Foza) cannot fix this — there is no debit-the-wallet
command on the provision surface; the charge must live in the gateway money path.

The product model (confirmed): a paid plan is a **monthly subscription** — charge
`priceUsd` from the wallet on subscribe, then **auto-renew each month** (debit again if the
wallet has funds; downgrade to Free if it does not). The published quota
(`buckets.hour/day/month`) is the usage allowance granted by paying, and the
period must reset **together with the renewal** (one month from the subscribe date, for
both the fee and the quota), not on the UTC calendar month.

## What Changes

- **Charge on subscribe.** `POST /provision/grant` for a `priceUsd > 0` plan: require funds
  (`402 insufficient_funds` otherwise, plan NOT granted), `debitUsd(priceUsd)` (wallet
  ledger reason `plan_subscribe`), set the period, then bind the plan — atomically. Free
  ($0) unchanged. Re-granting the same plan within the current period does not re-charge
  (idempotent).
- **Monthly auto-renew.** Each key carries `planChargedAt` + `planPeriodEnd` (one calendar
  month from subscribe, same day-of-month, clamped to month end). Renewal happens two ways
  that agree via the `planPeriodEnd` guard so they never double-charge:
  - **Lazy** (source of truth): in `marketplacePolicyCheck`, when `now >= planPeriodEnd`,
    renew immediately — debit `priceUsd` (reason `plan_renew`), advance the period, and
    reset the plan's monthly quota buckets; if underfunded, downgrade the key to Free and
    reject the request 402.
  - **Background `PlanRenewalMonitor`** (covers idle keys with no traffic): periodically
    scan keys past `planPeriodEnd`, renew or downgrade, emit a webhook.
- **Quota resets with the renewal (not the calendar month).** On a successful
  subscribe/renew, the plan's per-group monthly bucket for the key is reset to zero
  (`SpendLedgerService.resetMonth(scope)`), so the published monthly allowance tracks the
  subscription period. Hour/day speed-limit buckets stay calendar-based (they are rate
  limits, not the monthly allowance).
- **New webhook events** `plan.renewed`, `plan.downgraded`. `planPeriodEnd`/`planChargedAt`
  surfaced on `GET /provision/keys`.
- **Switch / cancel (v1):** switching plans charges the new plan's full price and resets
  the period (no proration/refund of the old). Cancel (`planId=null`) stops renewal with no
  refund of the current period.

`priceUsd` and `buckets` are independent: `priceUsd` is the per-period fee; `buckets` is
the usage allowance that fee unlocks (e.g. pay $10, use up to $20 of token value/period;
overage debits the wallet via the existing PAYG path).

## Capabilities

### New Capabilities
- `marketplace-plan-subscription`: paid plans are monthly subscriptions — charged on
  subscribe, auto-renewed from the wallet each period (downgrade to Free when underfunded),
  with the published quota resetting in lockstep with the renewal and no plan granted
  without payment.

## Impact

- Modified (marketplace): `POST /provision/grant` (charge + period); `marketplacePolicyCheck`
  (lazy renew/downgrade before the bucket check); new `PlanRenewalMonitor`
  (registerMarketplace start/stop); `GET /provision/keys` (+period fields).
- Modified (engine): `services/ApiKeyService.ts` (+`planChargedAt`,`planPeriodEnd` fields,
  persisted); `services/SpendLedgerService.ts` (+`resetMonth(scope)`); `services/WebhookService.ts`
  (+2 events). Engine→marketplace boundary unchanged (engine adds neutral fields/method;
  marketplace drives the policy).
- No change to reserve/settle accounting itself; renewal is additive. Behind
  `MARKETPLACE_ENABLED`. Out of scope: proration, refund-on-cancel.
