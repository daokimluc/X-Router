## Context

A paid plan today is bound by `POST /provision/grant`, which only calls
`apiKeyService.update({ planId })`. `plan.priceUsd` is display metadata read by no
money path, so a `$0` wallet gets `plan_claude`'s `$20/month` quota for free. The
website (Foza) cannot fix this: the provision surface has no debit-on-subscribe
command — the charge must live in the gateway money path, next to `WalletService`.

The product model is a **monthly subscription**: charge `priceUsd` on subscribe,
then auto-renew each month (debit again if funded; downgrade to Free if not). The
published `buckets.{hour,day,month}Usd` is the usage allowance the fee unlocks, and
the monthly allowance must reset **with the subscription period**, not on the UTC
calendar month.

This is BREAKING for the "subscribe = free" behavior and lands entirely inside
`marketplace/` behind `MARKETPLACE_ENABLED`. The engine gains only two neutral,
marketplace-agnostic additions (two persisted key fields + one ledger method + two
webhook event names); the marketplace drives all subscription logic.

## Goals / Non-Goals

Goals:
- No paid plan granted without a successful wallet charge.
- Deterministic monthly renewal that never double-charges, covering both
  trafficked and idle keys.
- The plan's monthly quota bucket resets in lockstep with the subscription period.

Non-Goals (explicitly out of scope, v1):
- Proration or refund on switch/cancel.
- Per-group independent subscription periods (one period per key).
- Changing reserve/settle accounting itself — renewal is additive.
- A subscription dashboard UI (Foza drives it via the provision API + webhooks).

## Decisions

### D1 — Subscription period: one calendar month, same day, Stripe-style clamp

`planPeriodEnd = addOneCalendarMonth(now)`: same day-of-month next month, clamped to
the month's last day when the source day overflows (subscribe Jan 31 → period ends
Feb 28/29; the *next* renewal returns toward the 31st where the month allows, anchored
off the new period end each time). Implemented as a pure helper
`addOneCalendarMonth(fromMs: number): number` in
`marketplace/utils/subscriptionPeriod.ts` so it is unit-testable independent of wall
clock. Periods are stored as **epoch-ms numbers**, not `Date` — they round-trip
through JSON and `ConfigStore` with no date-revival entry needed (`reviveDates` only
touches a fixed key list; numbers pass through `.passthrough()` cleanly).

### D2 — Two new key fields on the engine record, stored as epoch-ms

`ApiKeyService.InternalApiKeyRecord` gains:
- `planChargedAt?: number` — epoch-ms of the last successful subscribe/renew charge.
- `planPeriodEnd?: number` — epoch-ms at which the current period ends (renewal due).

These are neutral data fields the engine persists; the engine reads neither. They are
threaded through `update()` (patch keys `planChargedAt`/`planPeriodEnd`, `null` clears)
and surface on `list()` via the existing `structuredClone`. Free/plan-less keys leave
both undefined.

### D3 — Charge-on-subscribe is atomic and idempotent

`POST /provision/grant` for a `priceUsd > 0` plan:
1. Resolve plan + key (existing 400/404 paths unchanged).
2. **Idempotent guard:** if the key already has this `planId` AND `planPeriodEnd` is
   in the future, return as-is with `idempotent: true` — no re-charge. (Today's guard
   also skips when overage/payg are unset; preserved.)
3. Funds check `walletService.hasFundsUsd(keyId, priceUsd)` → `402 insufficient_funds`
   (plan NOT bound) if short.
4. `walletService.debitUsd(keyId, priceUsd)` with ledger reason `plan_subscribe:<planId>`.
5. Set `planPeriodEnd = addOneCalendarMonth(now)`, `planChargedAt = now`, bind `planId`.
6. Reset the plan's monthly quota bucket(s) for the key (D5).

The debit + field-set + bind happen as a single logical unit: the wallet debit is the
only durable money mutation and runs first; if it returns `ok:false` we never bind. A
`$0` (Free) plan skips steps 3–4 and binds directly (no period needed — Free never
renews).

> **Charge primitive — `debitUsd` vs a ledgered charge.** `WalletService.debitUsd`
> floors at zero and writes no `wallet_ledger` row. For an auditable subscription
> charge we add `WalletService.chargeUsd(keyId, usd, reason)` that debits **only if
> fully funded** (no partial/floored charge — a subscription is all-or-nothing) and
> appends a `wallet_ledger` row with `kind:'charge'`. `hasFundsUsd` + `chargeUsd` are
> called inside one `tx()` to avoid a check-then-act race.

### D4 — Renewal: lazy (source of truth) + background monitor (covers idle keys)

Two paths that agree via the `planPeriodEnd` guard so they never double-charge:

**Lazy renewal** in `marketplacePolicyCheck`, evaluated for a plan-bound key
**before** the model-scope/bucket checks: when `now >= planPeriodEnd`, attempt renewal
via a shared `PlanSubscriptionService.renewIfDue(keyId)`:
- Funded → `chargeUsd(priceUsd, 'plan_renew:<planId>')`, advance
  `planPeriodEnd = addOneCalendarMonth(planPeriodEnd)` (anchor off the old end, not
  `now`, so periods don't drift forward on a late check), set `planChargedAt = now`,
  reset the monthly bucket(s) (D5), emit `plan.renewed`. Request then proceeds.
- Underfunded → set `planId = null` (downgrade to Free), clear period fields, emit
  `plan.downgraded`, reject the request `402 plan_renewal_failed`. (The key keeps its
  wallet; the next request runs as plan-less.)

**Background `PlanRenewalMonitor`** (modeled on `SupplyHealthMonitor`: `setInterval`
+ `unref()`, public `scan()`, `start()`/`stop()` wired in `registerMarketplace`).
Periodically (~hourly) scans all keys with `planId` set and `now >= planPeriodEnd`,
calling the **same** `renewIfDue`. Lazy is the source of truth for trafficked keys;
the monitor only catches keys with no traffic. Because both call `renewIfDue` and that
method re-checks `now >= planPeriodEnd` under the period guard, a key renewed lazily a
millisecond before the scan is a no-op in the scan (its period already advanced).

> **Concurrency:** `renewIfDue` does its read-decide-charge inside a single
> `walletService` transaction-bounded section keyed off `planPeriodEnd`, then advances
> the period. Two concurrent lazy checks (or a lazy check racing the monitor) both read
> the *old* `planPeriodEnd`; the first charge advances it, the second sees the advanced
> period and returns "not due". The period field is the idempotency token.

### D5 — Quota resets with the renewal, not the calendar month

On a successful subscribe/renew, reset the plan's **monthly** bucket for the key to
zero so the published monthly allowance tracks the subscription period. Hour/day
buckets stay calendar-based (they are rate limits, not the monthly allowance).

Add `SpendLedgerService.resetMonth(scope)`: zero the `month` field (and `monthKey`) of
the scope's entry, leaving `hour`/`day` untouched. The plan bucket scope is
**per-group** (`key:<keyId>:grp:<group>` — see `marketplacePolicyCheck.ts:109`), and a
plan may grant several groups, so the reset iterates every group in the plan:
`for (const g of expandPlanGroups(plan.modelGroups)) resetMonth("key:<id>:grp:"+g)`.
Wildcard (`["*"]`) plans reset the key's known group scopes (those an entry exists for)
— a never-used group has a zero bucket already, so no reset is needed.

> **Why not touch `monthKey` calendar logic.** `SpendLedgerService` keys its month
> window off the UTC calendar (`monthKey()`); rewriting that to per-subscription
> windows would ripple into the admin spend-cap path that shares the ledger.
> `resetMonth` is a surgical "zero this scope's month counter now" that the
> subscription path calls at the renewal instant — calendar rollover still applies
> between renewals for any scope the subscription doesn't reset.

### D6 — Switch and cancel (v1)

- **Switch** (grant a different `planId`): treated as a fresh subscribe — charge the
  new plan's full `priceUsd`, set a new period, reset buckets. No proration/refund of
  the old plan's unused period.
- **Cancel** (`POST /provision/grant` with `planId: null`, or the existing key update):
  bind `planId = null`, clear `planChargedAt`/`planPeriodEnd`. Stops renewal. No refund
  of the current period (the buyer keeps quota until they stop sending traffic; with no
  plan the key falls to the plan-less wallet gate).

### D7 — Webhooks + read surface

- `WebhookService.WebhookEvent` union gains `"plan.renewed"` and `"plan.downgraded"`;
  add both to `BUSINESS_EVENTS` in `provision.ts` so they're subscribable.
  - `plan.renewed` data: `{ keyId, planId, priceUsd, periodEnd, walletUsd }`.
  - `plan.downgraded` data: `{ keyId, fromPlanId, reason: "renewal_underfunded", walletUsd }`.
- `GET /provision/keys` and `GET /provision/wallet/:keyId` add `planPeriodEnd` and
  `planChargedAt` (epoch-ms, `null` when unset) so Foza can render renewal dates.

## Architecture / Seam impact

```
engine (neutral, no subscription logic):
  ApiKeyService            +planChargedAt, +planPeriodEnd fields (data only)
  SpendLedgerService       +resetMonth(scope)
  WebhookService           +2 event names in the union
  WalletService(*)         +chargeUsd(keyId, usd, reason)   (*lives in marketplace/)

marketplace (drives everything, behind MARKETPLACE_ENABLED):
  utils/subscriptionPeriod.ts      addOneCalendarMonth(fromMs)
  services/PlanSubscriptionService subscribe(keyId, plan) / renewIfDue(keyId) / cancel(keyId)
  services/PlanRenewalMonitor      timer → scan() → renewIfDue for each due key
  routes/provision.ts              POST /provision/grant rewritten; GET reads +period
  policy/marketplacePolicyCheck.ts lazy renewIfDue before scope/bucket checks
  index.ts                         construct + decorate service, start/stop monitor
```

`WalletService` already lives under `marketplace/`, so `chargeUsd` is a marketplace
addition (the design note in D2 lists it under "engine" only for the money-primitive
grouping — it does not cross the boundary). The engine→marketplace boundary
(`test/marketplaceBoundary.test.ts`) is unchanged: the engine only gains neutral data
fields and a generic ledger method; nothing in the engine imports `marketplace/`.

## Risks / Trade-offs

- **Clock dependence.** `renewIfDue` and the monitor read `Date.now()`. Mitigated by
  isolating the period math in `addOneCalendarMonth` (pure, testable) and injecting a
  `now` into `PlanSubscriptionService` for tests.
- **Downgrade is silent to an in-flight buyer.** A renewal-underfunded key is downgraded
  mid-traffic and the triggering request gets 402. The `plan.downgraded` webhook lets
  Foza notify the buyer; acceptable for v1.
- **Monitor vs lazy double-fire window.** Bounded by the `planPeriodEnd` guard (D4);
  worst case is a redundant "not due" no-op, never a double charge.
- **Wildcard quota reset.** A `["*"]` plan only resets group scopes that already have a
  ledger entry; correct because an unseen group starts at zero. Documented in D5.

## Migration

No data migration. Existing plan-bound keys have no `planPeriodEnd`; on their next
request the lazy check sees `planPeriodEnd === undefined`. Treat "plan bound but no
period" as **legacy-grandfathered**: set a period one month out **without charging**
(they were granted under the old free-subscribe behavior; we don't retroactively bill).
Subsequent renewals then charge normally. This one-shot backfill happens inside
`renewIfDue` when `planId` is set and `planPeriodEnd` is absent.

## Open Questions

None — all resolved with Foza (see proposal "confirmed" notes). Token-packs are a
separate change (`marketplace-token-packs`).
