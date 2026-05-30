## Context

`routes/openai.ts:285` and `routes/anthropic.ts:305/388` already call `spendLedgerService.settle(id, actualCost)` after a request completes, and `release(id)` on failure (`openai.ts:445`). `enforceKeyPolicy` reserves pre-flight. `marketplace-plans` added a `PaygDecision` interface with a no-op that returns `payg_not_implemented`. `lowest-cost-routing` stashes `{ sellerId, accountId, costPrice, sellRates }` on the request. `seller-supply` gives each seller a `commissionPct`. `usd-wallet` gives `reserveUsd/settleUsd/releaseUsd`.

So all inputs exist; this change connects them into a two-sided settle and implements the real PAYG decision.

## Goals / Non-Goals

**Goals:**
- One settlement step that, for a completed marketplace request, charges the buyer at sell price and credits the serving seller at `cost × (1 − commissionPct)`, with platform margin = the remainder.
- A buyer-debit path that is plan-bucket for in-plan-budget requests and wallet for PAYG requests, chosen at reserve time and honored at settle time (don't split one request across both).
- Real PAYG decision: month-overage and opt-in boost, same sell price, guarded by user PAYG daily limit + wallet funds.
- Seller earnings accrue in a ledger the website reads for payouts; house credits are internal (platform pays itself).

**Non-Goals:**
- Payouts / banking / VND conversion — website, via `payoutRef`. x-router only accrues and reports USD owed.
- Refund/chargeback flows — future.
- Cross-request batching/netting of seller credit — credit per request; reporting rolls it up.
- Emitting webhooks — the *numbers* are produced here; the actual HTTP emit is `provision-webhook` (#7).

## Decisions

### The money split (per request, on actual cost)
```
   actualSellCost   = sellRates  applied to actual tokens     ← buyer pays this
   actualBaseCost   = costPrice  applied to actual tokens     ← platform's cost from this seller
   sellerCredit     = actualBaseCost × (1 − seller.commissionPct)
   platformMargin   = actualSellCost − sellerCredit
                    = (actualSellCost − actualBaseCost)        // markup part
                    + actualBaseCost × commissionPct           // commission part
   house: commissionPct treated as 1.0 effectively (no external credit); platformMargin = actualSellCost
```
Worked: cinb cost `$0.0052`, sell `$0.0060` (markup .15), commission `.08`:
```
   sellerCredit   = 0.0052 × 0.92 = 0.004784
   platformMargin = 0.0060 − 0.004784 = 0.001216
   (= markup 0.0008 + commission 0.000416)
```

### Buyer-debit track is decided at reserve, honored at settle
A request is tagged `billTrack: "plan" | "payg"` when the reservation is made:
- `plan` → reserved against `key:<id>:grp:<group>` spend bucket; settle adjusts that bucket; **no wallet move**.
- `payg` → reserved against the wallet via `reserveUsd` (and the PAYG-daily bucket); settle adjusts the wallet.

A single request never spans both tracks (the "crossing the boundary" rule from discovery: if pre-flight upper-bound fits the month budget → whole request is `plan`; else → whole request is `payg`).

### Settlement flow (post-request)
```
   on success with actual tokens:
     actualSellCost = sellCostForRequest(routed.sellRates, tokens)
     if billTrack == plan:  spendLedger.settle(planRes, actualSellCost)
     if billTrack == payg:  wallet.settleUsd(walletRes, actualSellCost)
     if routed.sellerId != "house":
         actualBaseCost = baseCostForRequest(routed.costPrice, tokens)
         sellerEarnings.credit(routed.sellerId, actualBaseCost × (1 − commissionPct))
     emit-data: { buyer, baseModel, sellerId, tokens, actualSellCost, sellerCredit, platformMargin }
   on failure:
     billTrack == plan → spendLedger.release(planRes)
     billTrack == payg → wallet.releaseUsd(walletRes)
     no seller credit
```

### Real PaygDecision (replaces the stub)
Invoked when a plan request would breach a bucket:
```
   PaygDecision(reason, key, estimateSell):
     overage off?                          → block (carry the original 429/done)
     wallet not provisioned / insufficient → 402 insufficient_balance
     PAYG-daily-limit would be exceeded    → 429 + Retry-After(next day)   (user-set guard)
     else → { charge:true, billTrack:"payg" }  // reserve wallet + payg-daily bucket
```
- **Overage** (month budget spent) and **boost** (hour/day speed-limit, month budget remains) use the **same** decision and the **same** sell price. Difference: boost requires an explicit client opt-in signal (header `x-allow-boost: true` or a key flag), because the default for a speed-limit is **wait** (confirmed). Overage just requires `overageEnabled`.
- Boost does **not** touch the month budget — it's a pure wallet charge, so the buyer keeps their remaining $X for normal-speed use later.

### PAYG daily limit = a wallet-scoped day bucket
The user-set `paygDailyLimitUsd` is enforced with the same ledger, scope `wallet:<keyId>:payg`, day cap only. Hitting it → 429 (wait till next day), never a hard lockout. This is the "PAYG must still have a brake" safety rule.

### Seller earnings ledger
`SellerEarningsLedger`: `Map<sellerId, { dayKey, monthKey, day, month, lifetime, unpaid }>`. `credit(sellerId, usd)` adds to day/month/lifetime/unpaid. `markPaid(sellerId, usd)` (website calls after payout) reduces `unpaid`. Persisted. House is never credited (its "earnings" are just platform cost, tracked as platform margin instead).

## Risks / Trade-offs

- **Risk: double-charge or lost-credit on crash between settle steps.** Mitigation: settle buyer and credit seller in one synchronous block after the response is fully sent; both operate on persisted, debounced in-memory state; a crash mid-block loses at most the last <5s of debounced writes (same exposure the existing ledger already accepts). Idempotency by reservation id prevents re-settle.
- **Trade-off: per-request seller credit, no netting.** Simpler, auditable; reporting aggregates. Fine at expected volumes.
- **Risk: boost opt-in signal ambiguity.** Mitigation: explicit `x-allow-boost` header OR per-key `boostEnabled`; absent both → wait (429). Documented in the 429 message.
- **Risk: commissionPct missing on a seller** → treat as `0` (seller gets full cost; platform still keeps markup). Validated `0 ≤ commissionPct < 1`.

## Open Questions

- Should platform margin be persisted as its own running total, or always derived (`sell − sellerCredit`) from usage records? Lean: derive for reporting, but keep a cheap running counter for the admin dashboard. Decide in tasks.
- Boost opt-in: header per-request vs. sticky per-key toggle vs. both? Lean: both (header overrides key default). Confirm during implementation.
