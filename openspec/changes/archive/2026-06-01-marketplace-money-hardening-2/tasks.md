# Tasks — marketplace-money-hardening-2

Test after each: `cd apps/gateway && rtk proxy npx vitest run --root .`

## 1. Database v8 (engine substrate)
- [x] 1.1 `Database.ts`: SCHEMA_VERSION→8; v8 migration: `token_grant_reservations(id, grant_id, est_tokens, created_at)`; `CREATE UNIQUE INDEX idx_wallet_ledger_idem ON wallet_ledger(reason) WHERE ...` — NO, use a dedicated `idempotency_key` column: `ALTER TABLE wallet_ledger ADD COLUMN idempotency_key TEXT` + `CREATE UNIQUE INDEX idx_wallet_ledger_idem ON wallet_ledger(idempotency_key) WHERE idempotency_key IS NOT NULL`.
- [x] 1.2 Migration test: fresh DB v8; both objects exist; v7→v8 additive.

## 2. M1 — persisted pack reservations + boot sweep
- [x] 2.1 `TokenGrantService.reserve`: also INSERT a `token_grant_reservations` row in the same tx as the decrement (id = reservationId).
- [x] 2.2 `settle`/`release`: DELETE the reservation row in the same tx (keep the in-memory Map for the est lookup; on a hit, delete row too). For robustness, read est from the ROW when the Map misses (post-restart settle), so a settle after restart still corrects correctly.
- [x] 2.3 `sweepReservations(olderThanMs=0)`: release all (or aged) reservation rows back to their grant (`tokens_remaining += est_tokens`, capped at tokens_total) + delete the rows; return count. Mirror WalletService.
- [x] 2.4 `marketplace/index.ts`: call `tokenGrantService.sweepReservations()` at boot (next to `walletService.sweepReservations()`).
- [x] 2.5 Update the class doc comment (currently claims in-memory/acceptable-loss — now durable).
- [x] 2.6 Tests: reserve→"restart" (new service, same DB)→sweep→tokens restored; settle-after-restart reads est from row.

## 3. M2 — exact conservation
- [x] 3.1 `settlementHook`: compute the split in integer micro. `collectedMicro = usdToMicro(collected)`; `creditMicro = min(usdToMicro(intendedCredit), collectedMicro)` for non-house else 0; `marginMicro = collectedMicro - creditMicro`. Credit the seller exactly `microToUsd(creditMicro)`; record margin `microToUsd(marginMicro)`; pass `collected`, `sellerCredit`, `platformMargin` to record as the micro-consistent values.
- [x] 3.2 `SettlementLedger.record`: assert `collected_micro === sellerCredit_micro + platformMargin_micro` (throw/log on violation — the doc claims it asserts). Use the passed values, not re-rounding.
- [x] 3.3 Test: a sub-micro collected/credit settlement → stored micros sum exactly; reconcilePlatform.marginMatches stays true across many rows.

## 4. M3 — fallback floor
- [x] 4.1 `config.ts`: `fallbackCostPer1kUsd` (env `FALLBACK_COST_PER_1K_USD`, small non-zero default e.g. 0.001). Thread into settlementHook deps.
- [x] 4.2 `settlementHook.fallbackCostPrice`: when no house listing AND no modelPricing, return a non-zero CostPrice derived from the floor (per-M = per-1k×1000), not {0,0}. Keep the warn log.
- [x] 4.3 Test: unlisted + unpriced metered request → actualSellCost > 0.

## 5. M4 — pack reversal re-credit
- [x] 5.1 `settlement_log`: record the consumed pack tokens + grant id. Reuse existing columns where possible — store consumed tokens in `prompt_tokens`+`completion_tokens` (already there) and add `grant_id TEXT` (v8 ALTER, nullable). `SettlementRecord` + record() carry `grantId?`, `consumedTokens?` (sum). settlementHook passes them on the tokenpack branch.
- [x] 5.2 `reverseSettlement`: when `bill_track='tokenpack'` and `grant_id` present, re-credit `prompt_tokens+completion_tokens` to the grant via a TokenGrantService method `recredit(grantId, tokens)` (capped at tokens_total). Inject TokenGrantService into SettlementLedger (constructor) OR pass a recredit callback. Prefer constructor dep (it already takes wallet/earnings/spendLedger).
- [x] 5.3 Tests: pack settle then reverse → grant remaining restored by consumed tokens; non-pack reverse unaffected.

## 6. M5 — findUsable expiry order
- [x] 6.1 `findUsable(keyId, baseModel, estTokens?)`: when `estTokens` given, prefer the soonest-expiring pack with `tokens_remaining >= estTokens` (`ORDER BY expires_at ASC`), falling back to most-remaining when none individually covers it. Caller (marketplacePolicyCheck) passes the estimate.
- [x] 6.2 Test: two covering packs, different expiry → soonest used; when neither covers, most-remaining used.

## 7. M6 — over-run record + reserve headroom
- [x] 7.1 `estimateUpperBoundTokens` (marketplacePolicyCheck): add a safety multiplier on inputTokens (e.g. ×1.3) so CJK/code under-count is less likely to exceed the reserve. Document it.
- [x] 7.2 `TokenGrantService.settle`: when `actualTokens > est + remaining-headroom` so the grant floors at 0 with an unmet remainder, record the over-delivered count (return it or log it). Simplest: return the over-delivered tokens count from settle (0 normally) so the hook can note it; floor stays at 0.
- [x] 7.3 Test: pack 100, reserve est 100, actual 150 → remaining 0 + settle reports 50 over-delivered.

## 8. Grandfather cutoff
- [x] 8.1 `PlanSubscriptionService.renewIfDue`: the grandfather branch (no period → free month) only when the key predates the cutoff. Use a cutoff timestamp: a key whose `createdAt` is before a constant `GRANDFATHER_CUTOFF` (set to this change's ship date) is legacy; a newer paid-plan-bound key with no period → charge immediately (call the same charge path with periodEnd=addOneCalendarMonth(now), kind:"subscribe") or downgrade if underfunded. (createdAt is on the engine key record — read it.)
- [x] 8.2 Tests: pre-cutoff key no period → grandfathered (no charge); post-cutoff key no period + funded → charged; post-cutoff underfunded → downgraded.

## 9. refundUsd idempotency
- [x] 9.1 `WalletService.refundUsd(keyId, usd, reason?, idempotencyKey?)`: when key given, INSERT the ledger row with idempotency_key; if it already exists (UNIQUE) → no-op, return current balance. (SELECT-first in the tx like chargeForPeriod.)
- [x] 9.2 `walletAdmin` refund route: accept optional `idempotencyKey` in body, pass through.
- [x] 9.3 Test: same idempotencyKey refund twice → credited once.

## 10. Input bounds + commission clamp
- [x] 10.1 `config.ts`: `maxTopupUsd` (default e.g. 100000), `maxPackTokens` (default e.g. 1e10), `maxPackHorizonMs` (default ~2y). Defaults generous but finite.
- [x] 10.2 `provision.ts` token-pack route: reject `tokens > maxPackTokens`, `expiresAt > now + maxPackHorizonMs` (400). `walletAdmin` topup + provision topup: reject `usd > maxTopupUsd` (400).
- [x] 10.3 `SellerService.register`: clamp `commissionPct` to [0,1] (like updateSeller).
- [x] 10.4 Tests: over-cap topup → 400; over-cap pack tokens → 400; far-future expiry → 400; register with commissionPct 1.5 → stored 1.

## 11. Verify + ship
- [x] 11.1 Each new regression test fails-before / passes-after where practical.
- [x] 11.2 Gateway tsc clean; full suite green (was 783/7 → 795/7, +12); boundary green.
- [x] 11.3 `openspec validate marketplace-money-hardening-2 --strict` clean.
- [ ] 11.4 Commit, bump v0.6.2, archive, push, publish, `npm i -g .`, update notes+memory. ⚠️ user restarts global x-router.
