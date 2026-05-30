## 1. Settle-then-credit (conservation)

- [ ] 1.1 Make `WalletService.settleUsd` and `SpendLedgerService.settle` return the actual amount applied (the delta moved), not void. Update existing callers.
- [ ] 1.2 `settlementHook`: reorder to settle the buyer side first, capture `collected`, then derive `sellerCredit = min(actualBaseCost×(1−commission), collected)` and `platformMargin = collected − sellerCredit`. House → `platformMargin = collected`, no seller credit.
- [ ] 1.3 Guarantee `collected === sellerCredit + platformMargin` for every settle (assert in tests).
- [ ] 1.4 Vitest: wallet underfunded so flooring occurs → seller credit ≤ collected, margin absorbs shortfall first, conservation holds; fully funded → unchanged from current amounts.

## 2. No free unlisted-route requests

- [ ] 2.1 In `settlementHook`, when a reservation was held but `request.routed` is unset: settle against a fallback cost — house listing cost for the base model if present, else `ModelPricingService` model cost — never $0.
- [ ] 2.2 Emit a `warn` log (model, accountId, "unlisted supply served metered request"). Optionally emit `supply.unhealthy` if appropriate.
- [ ] 2.3 Confirm a genuinely non-marketplace request (no reservation) is still a no-op (early return preserved).
- [ ] 2.4 Vitest: metered request with routed unset → buyer charged the fallback (not $0); non-metered request → untouched.

## 3. Refund / reversal primitives

- [ ] 3.1 `WalletService.refundUsd(keyId, usd, reason)`: credit funds back, append an audited reversal row to the durable log (distinct from `topupUsd`). Never negative.
- [ ] 3.2 `SellerEarningsLedger.reverse(sellerId, usd, reason)` (increase unpaid back / clawback) + `adjust(sellerId, deltaUsd, reason)`; both logged. House guarded.
- [ ] 3.3 `reverseSettlement(logId, reason)`: full reversal of one settlement_log row — refund the buyer the collected amount AND reverse the seller credit + margin for that row. Idempotent (a row can be reversed once).
- [ ] 3.4 Vitest: refund credits wallet + logs; reverse increases unpaid; reverseSettlement unwinds all three figures and is idempotent.

## 4. Solvency invariant + reconciliation read

- [ ] 4.1 Helper `reconcileSeller(sellerId)`: `unpaid == Σ settlement_log.seller_credit − Σ payouts − Σ reversals`; returns {expected, actual, ok}.
- [ ] 4.2 Helper `reconcilePlatform()`: `Σ collected ≥ Σ seller_credit`; `platformMargin_total == Σ collected − Σ seller_credit`; returns {ok, details}.
- [ ] 4.3 Log an error (not a request failure) if an invariant is violated at settle time.
- [ ] 4.4 Vitest: a sequence of settles + payouts + a reversal reconciles exactly; an injected inconsistency is detected.

## 5. Verification

- [ ] 5.1 Gateway `tsc` clean.
- [ ] 5.2 Full suite green; existing two-sided-settlement tests updated for the new (correct) amounts where flooring applies; expect +~12 tests.
- [ ] 5.3 Manual: PAYG buyer with a tiny wallet makes a request whose actual cost exceeds the balance → wallet floors at 0, seller credited only the collected amount, margin = collected − credit ≥ 0, conservation holds; issue a refund → wallet credited + logged; reverse a payout → unpaid restored.
- [ ] 5.4 `openspec validate money-correctness --strict` passes.
