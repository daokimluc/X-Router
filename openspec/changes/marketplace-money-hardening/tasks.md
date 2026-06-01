# Tasks — marketplace-money-hardening

## 1. Database v7 (engine substrate)
- [x] 1.1 `Database.ts`: bump SCHEMA_VERSION to 7; v7 migration: `CREATE TABLE plan_charges (id, key_id, plan_id, period_end INTEGER, kind TEXT, amount_micro INTEGER, ts INTEGER, UNIQUE(key_id, plan_id, period_end, kind))` + index on key_id; `CREATE UNIQUE INDEX idx_payouts_ref ON payouts(payout_ref) WHERE payout_ref IS NOT NULL`.
- [x] 1.2 Migration test: fresh DB at v7; plan_charges + the payout_ref unique index exist; v6→v7 additive.

## 2. C1 — renewal double-charge
- [x] 2.1 `WalletService.chargeForPeriod(keyId, usd, {planId, periodEnd, kind})`: one tx — funds-check + debit + wallet_ledger row + `INSERT` into plan_charges; on UNIQUE conflict (already charged this period) roll back / no-op the debit and return `{ ok:true, alreadyCharged:true, newBalanceUsd }`. Returns `{ ok, alreadyCharged?, newBalanceUsd }`. (Use a SELECT-for-existing inside the tx OR catch the constraint — pick the clean one for node:sqlite.)
- [x] 2.2 `PlanSubscriptionService.subscribe`: charge via `chargeForPeriod(.., {planId, periodEnd: newPeriodEnd, kind:"subscribe"})`. `alreadyCharged` → treat as idempotent success (bind plan, no second debit).
- [x] 2.3 `PlanSubscriptionService.renewIfDue`: charge via `chargeForPeriod(.., {planId, periodEnd: advancedPeriodEnd, kind:"renew"})`. `alreadyCharged` → advance in-memory period (catch-up), NO webhook, NO second debit. Funded new charge → normal renew + `plan.renewed`. Underfunded → downgrade (unchanged).
- [x] 2.4 Keep advancing `planChargedAt`/`planPeriodEnd` on the key record (fast guard + read surface) — now an optimization, plan_charges is the integrity boundary.
- [x] 2.5 Tests: renew same target period twice → one debit + one plan_charges row; simulate restart (new service, stale periodEnd, shared DB) → renewIfDue does NOT re-charge; subscribe replay idempotent; underfunded still downgrades.

## 3. C2 — token-pack solvency
- [x] 3.1 `SettlementLedger.reconcilePlatform`: cash sums `WHERE reversed=0 AND bill_track != 'tokenpack'`. Document the exclusion in the return/comment.
- [x] 3.2 `SettlementLedger.reconcilePacks()`: `Σ token_grants.price_paid_micro` vs `Σ collected_micro WHERE bill_track='tokenpack' AND reversed=0` (+ seller credit on those rows); return `{ totalPricePaid, recognizedValue, ok: recognized <= pricePaid }`. Needs the TokenGrantService DB / a join on token_grants — wire the table read.
- [x] 3.3 `settlementHook` tokenpack branch: credit seller as today; record pack platform-margin into a SEPARATE place (not the wallet `platform_margin` row) so `getPlatformMargin()` stays wallet-only. (Simplest: don't call `recordPlatformMargin` for tokenpack; derive pack margin from settlement_log on read in reconcilePacks.)
- [x] 3.4 Fix the false comment at `settlementHook.ts:172-175` ("zero platform margin on packs").
- [x] 3.5 Books-health endpoint(s) (`earningsAdmin`/`provision` reconcile/platform): add the pack solvency line.
- [x] 3.6 Tests: pack settle → wallet `reconcilePlatform.totalCollected` unchanged + `getPlatformMargin` unchanged; `reconcilePacks` recognized ≤ pricePaid; seller still credited.

## 4. H1 — reservation leak
- [x] 4.1 `MarketplaceSeam.releaseLeakedReservations(request)` (no-op when off): release `request.payg` (walletService.releaseUsd walletRes + spendLedger.release dayRes), `request.planReservation` (spendLedger.release), `request.tokenPack` (tokenGrantService.release); guard + null each. Register the implementation in `marketplace/index.ts` with the needed services.
- [x] 4.2 `app.ts` `onResponse` hook: after the existing spendReservation release, call `app.marketplaceSeam.releaseLeakedReservations(request)` best-effort (try/catch). Settlement hook already nulls these on the happy path → only fires on leaked early-returns.
- [x] 4.3 Tests: request with `request.payg` set, trigger onResponse without settle → wallet reservation released (balance restored); same for planReservation + tokenPack.

## 5. H2 + H3 — payout integrity
- [x] 5.1 `SellerEarningsLedger.markPaid`: move `if(!r)` guard BEFORE the payout INSERT (no phantom payout). Idempotent on payoutRef: `INSERT ... ` guarded by the UNIQUE index — on conflict, return snapshot without re-reducing unpaid (SELECT-existing-first or catch). Signature keeps `(sellerId, usd, payoutRef?)`.
- [x] 5.2 Route cap (`/admin/v1/earnings/seller/:id/mark-paid` + `/provision/earnings/:sellerId/mark-paid`): reject `usd > unpaid` with 400 `amount_exceeds_unpaid` (read snapshot first).
- [x] 5.3 `SettlementLedger.reconcileSeller`: signed `netOwed = credits − payouts + payoutReversals − reversals` (no floor); `ok = |expected − actual| < eps` where expected can be negative; expose `overPaidUsd = max(0, -netOwed)`.
- [x] 5.4 Tests: mark-paid same ref twice → one payout, unpaid reduced once; mark-paid > unpaid → 400; mark-paid unknown seller → no payout row; credit→mark-paid→reverse settlement → reconcileSeller ok=false + overPaidUsd>0.

## 6. H4 — snapshot reseed
- [x] 6.1 `marketplace/index.ts`: remove the `else if (key.walletMicroUsd !== undefined && !walletService.isProvisioned(key.id))` reseed branch. Keep the legacy token-balance migration branch. (Optionally sync `setWalletMicroUsd` on settle/release for display, but do NOT trust it.)
- [x] 6.2 Test: boot with key snapshot $10, no SQLite wallet row → wallet unprovisioned/$0, not reseeded.

## 7. Verify + ship
- [x] 7.1 Each new regression test FAILS before its fix, PASSES after (write failing-first where practical).
- [x] 7.2 Gateway tsc clean; full suite green (was 771/7 → 783/7, +12); engine→marketplace boundary green.
- [x] 7.3 `openspec validate marketplace-money-hardening --strict` clean.
- [ ] 7.4 Commit (per-fix or grouped C/H), bump v0.6.1, `openspec archive`, push, `npm publish`, `npm i -g .`, update notes+memory. ⚠️ User must restart global x-router.
