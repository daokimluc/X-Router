## Why

The marketplace pitch is "we route to the cheapest available source, so the platform price beats the vendor's." The account-pool has `priority`, `round_robin`, `weighted_round_robin`, and `least_busy` strategies, but `lowest_latency`/`lowest_error_rate` are stubs that fall back to round-robin, and there is **no cost-based strategy**. With `seller-supply` exposing per-listing cost, we can route a pooled request to the cheapest healthy candidate (including the house ceiling) and compute the buyer's **sell price** as `cheapest_cost × (1 + markup)` — the single platform price used everywhere (confirmed: one price for plan, boost, and overage).

This change adds the cost strategy and the sell-price computation. It does not move money — that's `two-sided-settlement` (#6); here we decide *who serves* and *what the sell price is*.

## What Changes

- Add `LowestCostStrategy` to the account-pool: among healthy candidates for a base model, pick the one with the lowest listing `costPrice` (tie-break by least-busy, then priority). Register it in `strategyFactory` for `selectionStrategy: "lowest_cost"`.
- Add a `MarketPricingService` (`apps/gateway/src/services/MarketPricingService.ts`): given a base model and the routed candidate's cost, compute `sellPrice = cost × (1 + markupPct)` using a **per-base-model markup** with a global default.
- Pooled requests (`gpt-5.5`) use `lowest_cost`; direct requests (`hoang/gpt-5.5`) pin the seller and use that listing's cost directly (sell = that seller's cost × (1+markup)).
- The house listing's cost is the ceiling: the strategy never selects a candidate more expensive than house when house is healthy (house is just the most expensive acceptable candidate, always present).
- Admin endpoint to set per-model markup; default markup configurable.
- **BREAKING** none — new strategy is opt-in per provider instance / per pool; existing strategies untouched.

## Capabilities

### New Capabilities
- `lowest-cost-routing`: A cost-minimizing account-selection strategy plus a market sell-price computation (`cheapest_cost × (1 + markup)`), with per-model markup and a house cost ceiling.

### Modified Capabilities
- (none published — extends the `account-pool` strategy set and adds pricing; the lossy stubs `lowest_latency`/`lowest_error_rate` remain as-is, separate concern.)

## Impact

- New strategy: `apps/gateway/src/account-pool/LowestCostStrategy.ts` + registration in `strategyFactory.ts`.
- The `AccountSelectionContext` gains an optional cost lookup (`costFor(accountId) → number`) fed from `seller-supply`'s `listingCostFor`, so the strategy stays decoupled from the seller service.
- New service: `apps/gateway/src/services/MarketPricingService.ts` (markup table + `sellPriceFor(baseModel, cost)`).
- Modified routing entry: when resolving a pooled model, build the cost-aware context and select via `lowest_cost`; when resolving a direct namespaced model, skip selection (single candidate).
- Admin route + persistence for per-model markup + global default.
- Depends on: `seller-supply` (#4) for cost data, `usd-wallet` (#1) for USD units. Consumed by `two-sided-settlement` (#6).
