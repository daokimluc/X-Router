## Why

This is where money actually moves. Every prior change set up the inputs: `usd-wallet` (buyer funds), `hourly-spend-buckets` + `marketplace-plans` (when a request is plan-metered vs. PAYG), `seller-supply` (who served it, at what cost), `lowest-cost-routing` (the routed cost + the sell price). What's missing is the **post-request settlement that debits the buyer and credits the seller in the same transaction**, plus the PAYG decision that `marketplace-plans` left as a stub.

Per the confirmed model: buyer is charged the **sell price** (`cost × (1+markup)`); the serving seller is credited their **cost minus commission** (`cost × (1 − commissionPct)`); the platform keeps `markup + commission`. The house seller's "credit" is just the platform's own cost (internal). Boost (hit a speed-limit, opt into PAYG while month budget remains) and overage (month budget spent) both charge the **same** sell price from the wallet, each guarded by the user-set PAYG daily limit.

## What Changes

- Introduce `SellerEarningsLedger` (`apps/gateway/src/services/SellerEarningsLedger.ts`): per-seller accrued, unpaid USD credit (day/month rolling for reporting), with `credit(sellerId, usd)` and `snapshot(sellerId)`. Distinct from the buyer-debit `usd-wallet`.
- Implement the real `PaygDecision` (the stub from `marketplace-plans`): on a plan bucket breach with overage on (or an out-of-scope model), decide to charge the wallet at sell price if the wallet has funds AND the user's `paygDailyLimitUsd` is not exceeded; else block (429 if PAYG-daily-limit, 402 if no funds).
- Wire the **settlement** into the request-completion path (`routes/openai.ts`, `routes/anthropic.ts`, where `SpendLedgerService.settle` already runs): compute actual sell cost from the routed sell rates and actual tokens, then:
  - **plan-metered request** → settle the plan's group bucket to actual sell cost (no wallet move).
  - **PAYG request** → settle the wallet reservation to actual sell cost.
  - **either way** → credit the serving seller `actualCost × (1 − commissionPct)` (skip for house).
- Boost path: when a request is rejected for an hour/day speed-limit AND the client opts into boost (header/flag) AND overage on AND wallet+PAYG-daily-limit allow → serve via PAYG instead of 429, without touching the month budget.
- Admin/reporting endpoints: seller earnings snapshot, platform margin snapshot.
- **BREAKING** none — settlement augments the existing post-request hooks; non-marketplace keys (no plan, no listing) settle exactly as today.

## Capabilities

### New Capabilities
- `two-sided-settlement`: Atomic post-request settlement that charges the buyer at sell price (plan bucket or wallet) and credits the serving seller at cost minus commission, with the platform retaining markup plus commission.
- `payg-overage-boost`: The decision and wallet-charging path for pay-as-you-go — used both for month-budget overage and for opt-in boost past an hour/day speed limit, at the same sell price, guarded by a user-set PAYG daily limit.

### Modified Capabilities
- `marketplace-plans`: the PAYG handoff hook changes from the `payg_not_implemented` stub to the real decision. (Spec delta MODIFIES the month-exhaustion requirement.)

## Impact

- New service: `apps/gateway/src/services/SellerEarningsLedger.ts`.
- New module: real `PaygDecision` implementation injected into `enforceKeyPolicy` (replacing the no-op).
- Modified: `routes/openai.ts` + `routes/anthropic.ts` settlement blocks — split plan-bucket settle vs. wallet settle, add seller credit.
- Modified: `enforceKeyPolicy.ts` — overage/boost branch now calls the real PAYG decision; PAYG reserves against the wallet (`usd-wallet.reserveUsd`) and the user PAYG daily limit (a wallet-scoped day bucket).
- New admin endpoints: `GET /admin/v1/earnings/seller/:id`, `GET /admin/v1/earnings/platform`.
- Webhook emissions (the actual emit lands in `provision-webhook` #7, but the data — sellerCredit, platformMargin — is produced here).
- Depends on: #1 `usd-wallet`, #2 `hourly-spend-buckets`, #3 `marketplace-plans`, #4 `seller-supply`, #5 `lowest-cost-routing`.
