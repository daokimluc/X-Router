# Tasks — marketplace-plan-subscription

## 1. Engine neutral additions (no subscription logic)
- [x] 1.1 `ApiKeyService`: add `planChargedAt?: number` + `planPeriodEnd?: number` to `InternalApiKeyRecord`; thread both through `update()` patch (keys accept `number | null`, `null` clears) and `create()` (not settable on create — leave undefined). Confirm `list()`/`listWithKeys()` carry them via `structuredClone`.
- [x] 1.2 `SpendLedgerService.resetMonth(scope)`: zero the scope entry's `month` (and set `monthKey` to the current month) leaving `hour`/`day`/`hourKey`/`dayKey` untouched; no-op when the scope has no entry; `scheduleSave()`.
- [x] 1.3 `WebhookService.WebhookEvent` union: add `"plan.renewed"` and `"plan.downgraded"`.
- [x] 1.4 Verify period fields round-trip: they are epoch-ms numbers → `apiKeySchema.passthrough()` carries them and `reviveDates` ignores them (no date revival). Add a persistence round-trip test asserting both survive a save→load through `ConfigStore`/`parsePersistedState`.

## 2. Marketplace money + period primitives
- [x] 2.1 `marketplace/utils/subscriptionPeriod.ts`: pure `addOneCalendarMonth(fromMs: number): number` with same-day + last-day clamp (Jan 31 → Feb 28/29).
- [x] 2.2 `WalletService.chargeUsd(keyId, usd, reason)`: all-or-nothing debit inside one `tx()` — funds-check + debit + `wallet_ledger` row `kind:'charge'`; returns `{ ok, newBalanceUsd }`; `ok:false` (no mutation) when underfunded.

## 3. PlanSubscriptionService (drives subscribe/renew/cancel)
- [x] 3.1 New `marketplace/services/PlanSubscriptionService.ts` with injected deps (`apiKeyService`, `walletService`, `planService`, `spendLedgerService`, `webhookService`, optional `now: () => number` for tests).
- [x] 3.2 `subscribe(keyId, plan)`: idempotent guard (same plan + future period → `{ idempotent: true }`); funds-check → `{ ok:false, reason:"insufficient_funds" }` if short; `chargeUsd(priceUsd, "plan_subscribe:<planId>")`; set `planPeriodEnd = addOneCalendarMonth(now)`, `planChargedAt = now`, bind `planId`; reset monthly bucket(s) for every granted group. Free (`priceUsd===0`) → bind, no charge, no period.
- [x] 3.3 `renewIfDue(keyId)`: re-read the key; if no `planId` or plan missing → noop. If `planPeriodEnd` absent (legacy) → set period one month out, NO charge, return `{ renewed:false, grandfathered:true }`. If `now < planPeriodEnd` → noop `{ due:false }`. Else funded → `chargeUsd("plan_renew:<planId>")`, advance period off the OLD `planPeriodEnd`, reset month bucket(s), emit `plan.renewed`, return `{ renewed:true }`; underfunded → `planId=null` + clear period fields, emit `plan.downgraded` (`reason:"renewal_underfunded"`), return `{ downgraded:true }`.
- [x] 3.4 `cancel(keyId)`: bind `planId=null`, clear `planChargedAt`/`planPeriodEnd`, no refund.
- [x] 3.5 Helper `resetPlanMonthBuckets(keyId, plan)`: iterate `expandPlanGroups(plan.modelGroups)` (reuse `modelGroup.ts` helpers; wildcard → reset only group scopes with an existing ledger entry) calling `spendLedgerService.resetMonth("key:"+keyId+":grp:"+group)`.

## 4. Wire into the request + provision paths
- [x] 4.1 `POST /provision/grant`: route `priceUsd>0` and switch/cancel through `PlanSubscriptionService.subscribe`/`cancel`; map `insufficient_funds` → 402 `code:"insufficient_funds"` (plan NOT bound); preserve existing 400 (bad plan) / 404 (bad key); keep `audit("provision.grant", …)`; return `{ id, planId, planPeriodEnd, planChargedAt, walletUsd, idempotent? }`.
- [x] 4.2 `marketplacePolicyCheck`: BEFORE the model-scope/bucket logic for a plan-bound key, call `planSubscriptionService.renewIfDue(keyId)`; on `downgraded` return 402 `code:"plan_renewal_failed"`; otherwise fall through to the existing checks (re-reading `record.planId` since renewal may have cleared it → treat as plan-less). Inject the service via `MarketplacePolicyDeps`.
- [x] 4.3 `GET /provision/keys` + `GET /provision/wallet/:keyId`: add `planPeriodEnd`/`planChargedAt` (epoch-ms or null).
- [x] 4.4 `provision.ts` `BUSINESS_EVENTS`: add `"plan.renewed"`, `"plan.downgraded"`.

## 5. PlanRenewalMonitor + registration
- [x] 5.1 New `marketplace/services/PlanRenewalMonitor.ts` modeled on `SupplyHealthMonitor`: `setInterval` (default ~hourly) + `unref()`, public `scan()` (list plan-bound keys, call `renewIfDue` for each due key, swallow per-key errors), `start()`/`stop()`.
- [x] 5.2 `registerMarketplace` (`marketplace/index.ts`): construct `PlanSubscriptionService` (after planService + walletService + spendLedgerService + webhookService exist), decorate `app.planSubscriptionService`, pass it into `createMarketplacePolicyCheck` deps; construct + `start()` `PlanRenewalMonitor`, `stop()` on `onClose`.

## 6. Tests (run: `cd apps/gateway && rtk proxy npx vitest run --root .`)
- [x] 6.1 `subscriptionPeriod.test.ts`: Jan 31 → Feb 28/29 clamp; mid-month same-day; Dec → Jan year rollover.
- [x] 6.2 `walletCharge.test.ts`: `chargeUsd` all-or-nothing (underfunded → no mutation, no ledger row); funded → balance drops + `kind:'charge'` ledger row.
- [x] 6.3 `planSubscription.test.ts`: subscribe underfunded → 402, plan not bound, no debit; subscribe funded → charged once + period + bucket reset; Free → no charge; re-grant same active plan → idempotent no re-charge; switch → full new charge; cancel → fields cleared.
- [x] 6.4 `planRenewal.test.ts` (inject fixed `now`): due+funded → charge + period advance off old end + month bucket zeroed + `plan.renewed`; due+underfunded → downgrade + `plan.downgraded` + 402 `plan_renewal_failed`; legacy (no period) → grandfathered set-period-no-charge; double-fire (lazy + monitor) → exactly one charge.
- [x] 6.5 `resetMonth` unit: zeroes month only, leaves hour/day; multi-group plan resets each granted group.
- [x] 6.6 Engine persistence round-trip test (1.4).

## 7. Verify + ship
- [x] 7.1 `openspec validate marketplace-plan-subscription --strict` clean.
- [x] 7.2 Gateway `tsc` clean; full suite green (was 716 pass / 7 skip → 743 pass / 7 skip, +27); engine→marketplace boundary test green.
- [ ] 7.3 Manual smoke (user): subscribe a funded key → balance drops, period set; force `planPeriodEnd` into the past → next request renews or downgrades; confirm `plan.renewed`/`plan.downgraded` webhooks fire to the business target.
- [ ] 7.4 Commit (one `feat(marketplace): plan subscription charge + monthly auto-renew`), bump version, push; `openspec archive marketplace-plan-subscription`; update notes + memory.
