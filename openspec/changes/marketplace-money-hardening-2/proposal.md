## Why

The first money-hardening pass (v0.6.1) fixed the 2 CRITICAL + 4 HIGH revenue defects.
This pass clears the deferred MEDIUM/LOW findings from the same audit — correctness,
leak-on-crash, and unvalidated-input issues that don't move money on the happy path but
can lose buyer-paid value, serve unpaid supply, or accrue unbounded liability under crash,
edge-token-counts, or bad privileged input.

## What Changes

- **M1 — Token-pack reservations survive a crash.** Pack `reserve` decremented the SQLite
  balance but held the reservation only in memory, with no boot sweep — a crash between
  reserve and settle permanently lost buyer-paid tokens (worst case: a whole pack). Pack
  reservations are now persisted (`token_grant_reservations`, Database v8) and swept at
  boot (released back to the grant), mirroring the wallet's `sweepReservations`.
- **M2 — Conservation is exact, by construction.** The settlement split derived
  `sellerCredit` and `platformMargin` as independently-rounded micros that need not sum to
  `collected`. Margin is now `collected_micro − sellerCredit_micro` from already-rounded
  integers, and `SettlementLedger.record` asserts the invariant the doc promised.
- **M3 — An unlisted route never serves free.** `fallbackCostPrice` returned `{0,0}` when a
  route had no listing and no model price, charging the buyer $0. It now falls back to a
  configurable non-zero floor rate so a metered request is always charged something.
- **M4 — Pack reversal re-credits the tokens.** Reversing a token-pack settlement now
  restores the consumed tokens to the originating grant (the consumed count + grant id are
  recorded on the settlement row), instead of leaving the buyer short with no refund.
- **M5 — Packs burn down soonest-expiry first.** `findUsable` now prefers the
  soonest-expiring pack that still covers the request (falling back to most-remaining),
  so near-expiry buyer-paid tokens are consumed before they lapse.
- **M6 — A pack over-run is not served free.** When the actual token count exceeds the
  reserved estimate and the pack can't absorb it, the settlement records the over-delivery
  rather than silently flooring to zero; the reserve estimate also gets a safety headroom
  so realistic CJK/code requests don't under-reserve.
- **Grandfather is bounded.** The "legacy plan-bound key with no period → free month"
  branch now only applies to keys created before this change's cutoff; a paid plan bound
  via `/provision/key` (create-with-planId) or `/admin/v1/keys/:id/plan` after the cutoff
  no longer gets a free month — it is charged on its first renewal evaluation.
- **refundUsd is idempotent.** The admin wallet-refund route accepts an optional
  idempotency key (UNIQUE in `wallet_ledger`); a retried refund credits once.
- **Privileged input is bounded.** Topup USD, pack `tokens`, and pack `expiresAt` are
  capped to sane maxima; `SellerService.register` clamps `commissionPct` to `[0,1]` like
  `updateSeller` already does.

Out of scope (intentional, documented): the calendar-month period anchor "ratchets
earlier" after a clamped short month — confirmed correct Stripe-style behavior, not a
revenue defect, left as-is.

## Capabilities

### New Capabilities
- `marketplace-money-hardening-2`: the marketplace money paths preserve buyer-paid token
  packs across a crash, recognize money conservation exactly, never serve a metered request
  free, re-credit reversed pack tokens, consume packs before they expire, and reject or
  bound unvalidated privileged input — clearing the residual correctness/leak findings from
  the revenue audit.

## Impact

- Modified (engine): `services/Database.ts` (v8: `token_grant_reservations`,
  `wallet_ledger` idempotency index); `config.ts` (fallback floor rate, input caps —
  optional, defaulted).
- Modified (marketplace): `services/TokenGrantService.ts` (persisted reservations + boot
  sweep + findUsable order + over-run record); `services/SettlementLedger.ts` (exact margin
  + assertion + pack-token re-credit on reverse + record consumed tokens/grant id);
  `policy/settlementHook.ts` (exact split, fallback floor, pass consumed tokens); `services/
  SellerService.ts` (commission clamp); `services/PlanSubscriptionService.ts` (bounded
  grandfather); routes `provision.ts` + `walletAdmin.ts` (input caps, refund idempotency);
  `marketplace/index.ts` (token reservation boot sweep).
- Behind `MARKETPLACE_ENABLED`. Engine→marketplace boundary unchanged. All additive /
  backward-compatible; no data migration beyond additive v8 tables/indexes.
