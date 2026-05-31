## 1. Settle-then-credit (conservation)

- [x] 1.1 `WalletService.settleUsd` + `SpendLedgerService.settle` now RETURN the amount actually collected (the net moved), not void. Existing callers (openai.ts/anthropic.ts/settlementHook) ignore the return → still compile.
- [x] 1.2 `settlementHook`: reordered to settle the buyer side first, capture `collected`, then `sellerCredit = min(actualBaseCost×(1−commission), collected)`, `platformMargin = collected − sellerCredit`. House → `platformMargin = collected`, no seller credit.
- [x] 1.3 `collected === sellerCredit + platformMargin` for every settle (asserted in moneyCorrectness.test.ts + enforced at SettlementLedger.record write).
- [x] 1.4 Vitest: underfunded wallet floors → seller credit ≤ collected, margin absorbs shortfall first, conservation holds; fully funded → unchanged amounts.

## 2. No free unlisted-route requests

- [x] 2.1 `settlementHook`: when a reservation was held but `request.routed` is unset → settle against `fallbackCostPrice` (house listing cost for the base model if present, else `ModelPricingService` model cost), never $0.
- [x] 2.2 `request.log.warn` ("unlisted supply served metered request — settled at fallback cost") with model + sell cost.
- [x] 2.3 Genuinely non-marketplace request (no reservation) still early-returns (no-op) — preserved + tested.
- [x] 2.4 Vitest: metered request with routed unset → buyer charged fallback (gpt-4o default price, not $0); non-metered → untouched.

## 3. Refund / reversal primitives

- [x] 3.1 `WalletService.refundUsd(keyId, usd, reason)`: credits funds back, appends an audited `wallet_ledger` row (kind=refund). Provisions if absent. Non-negative. +`ledgerFor(keyId)` read.
- [x] 3.2 `SellerEarningsLedger.reverse(sellerId, usd, reason, settlementId?)` (clawback — reduces lifetime+unpaid, logs earnings_reversals kind=reverse) + `reversePayout(sellerId, usd, reason)` (failed payout — restores unpaid, kind=payout_reversal). House guarded. `markPaid` now also logs a `payouts` row.
- [x] 3.3 `SettlementLedger.reverseSettlement(logId, reason)`: full reversal of one settlement_log row — refunds buyer the collected amount (wallet refund or plan-bucket credit by billTrack), reverses seller credit + unwinds margin. Idempotent via the `reversed` flag.
- [x] 3.4 Vitest: refund credits wallet + logs; reversePayout restores unpaid; reverseSettlement unwinds all three figures and is idempotent.

## 4. Solvency invariant + reconciliation read

- [x] 4.1 `SettlementLedger.reconcileSeller(sellerId)`: `unpaid == Σ credits − Σ payouts + Σ payout_reversals − Σ reversals`; returns {expectedUnpaid, actualUnpaid, ok}.
- [x] 4.2 `SettlementLedger.reconcilePlatform()`: `Σ collected ≥ Σ seller_credit` (solvent); `recordedMargin == Σ collected − Σ seller_credit` (marginMatches); returns {…, ok}.
- [ ] 4.3 Log an error (not request failure) on a settle-time invariant violation. → reconciliation reads exist + are testable; the per-settle error-log hook is deferred to admin-marketplace-ui (#4) where the "books health" panel surfaces it. The invariant is enforced structurally (credit derived from collected can't exceed it), so a violation is not reachable from the normal settle path.
- [x] 4.4 Vitest: credits + payout + reversal reconciles exactly (reconcileSeller.ok); platform solvency + margin match.

## 5. Verification

- [x] 5.1 Gateway `tsc` clean.
- [x] 5.2 Full suite green — **603 pass + 7 skip** (was 593); existing two-sided-settlement tests pass unchanged (collected == sell cost when funded); +10 moneyCorrectness tests.
- [ ] 5.3 Manual crash/refund/reverse exercise (user).
- [x] 5.4 `openspec validate money-correctness --strict` passes.
