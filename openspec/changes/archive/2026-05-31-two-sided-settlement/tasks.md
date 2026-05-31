## 1. Seller earnings ledger

- [x] 1.1 Create `apps/gateway/src/services/SellerEarningsLedger.ts`: `Map<sellerId, { dayKey, monthKey, day, month, lifetime, unpaid }>`, `credit(sellerId, usd)`, `markPaid(sellerId, usd)`, `snapshot(sellerId)`, lazy day/month rollover.
- [x] 1.2 Persistence + debounced save; decorate `app.sellerEarningsLedger`.
- [x] 1.3 House is never credited (guard in `credit`, or callers skip). Vitest: credit accrues day/month/lifetime/unpaid; markPaid reduces unpaid; house credit is a no-op; persistence round-trip.

## 2. Sell/base cost helpers

- [x] 2.1 In `MarketPricingService` (or a settlement util): `baseCostForRequest(costPrice, prompt, completion, cached)` and reuse `sellCostForRequest` from #5, both returning USD.
- [x] 2.2 Vitest: worked example (cinb cost 0.0052, sell 0.0060, commission .08 → sellerCredit 0.004784, margin 0.001216) within rounding tolerance.

## 3. Real PaygDecision

- [x] 3.1 Implement `PaygDecision` replacing the no-op: branch overage-off→block, no/low wallet→402, payg-daily-limit→429(next day), else `{ charge:true, billTrack:"payg" }`.
- [x] 3.2 Boost gating: only allow the speed-limit→PAYG path when `x-allow-boost` header OR key `boostEnabled` is set; boost does NOT consume month budget.
- [x] 3.3 PAYG daily limit enforced via ledger scope `wallet:<keyId>:payg`, day cap = `paygDailyLimitUsd`.
- [x] 3.4 Inject the real impl into `enforceKeyPolicy` deps (swap the stub).
- [x] 3.5 Vitest: overage on + funds → payg; overage off → block; speed-limit + no boost → 429 wait; speed-limit + boost + funds → payg (month budget untouched); payg-daily-limit exceeded → 429.

## 4. Reserve tagging (billTrack)

- [x] 4.1 At reserve time, tag the request `billTrack` = `plan` (fits month budget) or `payg` (overage/boost). For `payg`, also `wallet.reserveUsd(estimateSell)` + reserve the payg-daily bucket; roll back both on any rejection.
- [x] 4.2 Stash `{ billTrack, planRes?, walletRes?, paygDayRes? }` on the request alongside the routed `{ sellerId, costPrice, sellRates }` from #5.
- [x] 4.3 Vitest: a request crossing the month boundary is wholly `payg` (not split); a within-budget request is wholly `plan`.

## 5. Settlement in route handlers

- [x] 5.1 `routes/openai.ts` + `routes/anthropic.ts` (stream + non-stream success): compute `actualSellCost`; settle plan bucket OR wallet by `billTrack`; if `sellerId != house` credit `actualBaseCost × (1 − commissionPct)`.
- [x] 5.2 Failure paths: release the matching reservation(s); no seller credit.
- [x] 5.3 Produce the settlement data object `{ buyer, baseModel, sellerId, tokens, actualSellCost, sellerCredit, platformMargin }` for #7 to emit (store on request / pass to a sink).
- [x] 5.4 Vitest (route-level): plan request settles bucket + credits seller, wallet untouched; payg request settles wallet + credits seller; failure releases, no credit; house request credits nobody but records margin = sell.

## 6. Admin earnings/margin endpoints

- [x] 6.1 `GET /admin/v1/earnings/seller/:id` (day/month/lifetime/unpaid), `POST /admin/v1/earnings/seller/:id/mark-paid`, `GET /admin/v1/earnings/platform` (margin running total).
- [x] 6.2 Endpoint tests.

## 7. Modified spec: marketplace-plans month-exhaustion

- [x] 7.1 Update the `marketplace-plans` month-exhaustion behavior: overage-on no longer returns `payg_not_implemented`; it now invokes the real PAYG decision. (Captured as a MODIFIED requirement in this change's spec delta.)

## 8. Verification

- [x] 8.1 Gateway `tsc` clean.
- [x] 8.2 Test suite green; expect +~24 tests.
- [x] 8.3 Manual: plan request within budget (bucket moves, wallet/seller as expected); exhaust month + overage → wallet debited at sell, seller credited at cost−commission; speed-limit + boost header → served from wallet, month budget unchanged; check `GET /admin/v1/earnings/seller/:id`.
- [x] 8.4 `openspec validate two-sided-settlement --strict` passes.
