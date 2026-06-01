## Why

A deep read-only audit of the marketplace money paths (after shipping subscription
v0.5.0 + token-packs v0.6.0) found two CRITICAL and four HIGH defects that move real
money incorrectly. They were verified in live code. Root theme: durable money state
(SQLite wallet + seller earnings) and its integrity guards (subscription period, wallet
snapshot, PAYG reservations) are committed **non-atomically** across two stores, so a
restart, a cache hit, or a payout retry can double-charge, leak funds, or hide a loss.

The operational instance has not yet restarted onto v0.6.0, so enforcement is not live —
there is a window to fix before any buyer is charged.

## What Changes

- **C1 — Subscription renewal no longer double-charges on restart.** The renewal charge
  and its idempotency guard now commit in **one SQLite transaction**: a new `plan_charges`
  table with `UNIQUE(key_id, plan_id, period_end, kind)` is the durable idempotency token,
  written inside the same `tx()` as the wallet debit. A replayed renew for a period already
  charged is absorbed by the constraint (no second debit), even though the in-memory
  `planPeriodEnd` is stale after a restart. Closes the subscribe crash-window too.
- **C2 — Token-pack value no longer inflates wallet solvency.** `reconcilePlatform` now
  excludes `bill_track='tokenpack'` rows (the buyer paid the website off-platform; that
  sell-value was never wallet cash). A separate `reconcilePacks()` proves prepaid-pack
  health (`Σ recognized sell-value ≤ Σ pricePaid`). Pack platform-margin is tracked apart
  from wallet margin so `getPlatformMargin()` is not polluted by unbacked value. The seller
  is still credited for pack supply consumed (correct, real liability).
- **H1 — Held PAYG/plan/pack reservations are released on early-return paths.** A cache hit
  (and direct-route-404 / no-provider returns) previously bypassed the settlement hook,
  leaking a real wallet reservation until the next boot sweep. The engine's `onResponse`
  backstop now releases all marketplace reservation kinds via a neutral seam helper.
- **H2 — Seller payouts are idempotent + capped.** `markPaid` dedupes on `payoutRef`
  (UNIQUE), refuses an amount exceeding `unpaid`, and never logs a phantom payout for an
  unknown seller. A provision-webhook retry can no longer double-pay.
- **H3 — Clawback-after-payout is detectable.** `reconcileSeller` stops flooring the
  expected balance at zero; when the platform has paid out more than it now owes (an
  unrecoverable clawback), it reports `ok=false` + `overPaidUsd` instead of silently
  agreeing.
- **H4 — Stale wallet snapshot is no longer a recovery source.** The boot path that
  reseeded a wallet from the denormalized `walletMicroUsd` key field is removed; SQLite
  `wallets` is the sole money authority.

## Capabilities

### New Capabilities
- `marketplace-money-hardening`: the marketplace money paths commit each charge and its
  idempotency guard atomically and durably, keep prepaid-pack value out of wallet-solvency
  accounting, release every held reservation on all exit paths, make seller payouts
  idempotent and bounded, and surface (rather than hide) an over-payout — so a restart,
  cache hit, or retry cannot double-charge, leak, or mask a loss.

## Impact

- Modified (engine): `services/Database.ts` (v7: `plan_charges` + `payouts.payout_ref`
  UNIQUE index); `services/MarketplaceSeam.ts` (+`releaseLeakedReservations` no-op seam);
  `app.ts` (`onResponse` backstop calls the seam helper).
- Modified (marketplace): `services/WalletService.ts` (+`chargeForPeriod`);
  `services/PlanSubscriptionService.ts` (use `chargeForPeriod`); `services/SettlementLedger.ts`
  (reconcile split + `reconcilePacks`); `services/SellerEarningsLedger.ts` (`markPaid`
  idempotent/capped/guard-order; signed reconcile); `policy/settlementHook.ts` (pack margin
  separation + comment fix); `routes/earningsAdmin.ts` + `routes/provision.ts` (mark-paid
  cap; books-health pack line); `marketplace/index.ts` (drop snapshot reseed; register seam
  helper).
- Behind `MARKETPLACE_ENABLED`. Engine→marketplace boundary unchanged (engine gains only a
  neutral table + a neutral seam method).
- **Out of scope (deferred, lower severity — listed in tasks):** token-pack crash loses
  in-flight reserved tokens (needs persisted pack reservations + boot sweep); conservation
  micro-rounding; unlisted-route zero-cost floor; pack-reversal token re-credit;
  findUsable expiry order; pack over-run free tokens; calendar-month anchor drift;
  grandfather-free-month via create-with-planId / admin assign-plan; refundUsd idempotency;
  input upper bounds (topup / pack tokens / expiresAt).
