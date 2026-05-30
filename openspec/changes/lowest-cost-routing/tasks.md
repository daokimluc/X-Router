## 1. Cost-aware selection context

- [x] 1.1 Extend `AccountSelectionContext` (account-pool/types.ts) with optional `costFor?: (accountId: string) => CostPrice | null` where `CostPrice = { inputPerM, outputPerM, cachedInputPerM? }`.
- [x] 1.2 Confirm `AccountPool.acquire` passes `costFor` through to the strategy unchanged.

## 2. LowestCostStrategy

- [x] 2.1 Create `apps/gateway/src/account-pool/LowestCostStrategy.ts`: filter candidates to those with a non-null cost, pick min by a cost scalar (default: `inputPerM + outputPerM`, documented), tie-break least-busy → priority → stable.
- [x] 2.2 Register `"lowest_cost"` in `strategyFactory.ts`.
- [x] 2.3 Vitest `lowestCostStrategy.test.ts`: cheapest picked; cheapest unhealthy → next cheapest (incl. house); equal cost → least busy; no costed candidate → null.

## 3. MarketPricingService

- [x] 3.1 Create `apps/gateway/src/services/MarketPricingService.ts`: per-base-model markup map + global default (`0.15`), `markupFor(baseModel)`, `sellPriceFor(baseModel, cost: CostPrice) → CostPrice` (apply `× (1+markup)` to each rate), validation `markup >= 0`.
- [x] 3.2 `sellCostForRequest(baseModel, cost, promptTokens, completionTokens, cachedTokens)` → USD using sell rates (reuse the calc shape from `ModelPricingService`).
- [x] 3.3 Persistence: markup table via `PersistenceService`.
- [x] 3.4 Decorate `app.marketPricingService`.
- [x] 3.5 Vitest `marketPricing.test.ts`: default markup applied; per-model override; markup 0 sells at cost; request sell cost math.

## 4. Routing entry wiring

- [x] 4.1 When the resolved model is a **pooled** alias, build `costFor` from `seller-supply`'s `listingCostFor(baseModel)` (accountId→cost), acquire via `lowest_cost`, then compute sell price for the routed candidate.
- [x] 4.2 When the resolved model is a **direct** namespaced listing, skip selection; use that listing's cost; compute sell price.
- [x] 4.3 Stash the routed `{ sellerId, accountId, costPrice, sellRates }` on the request for `two-sided-settlement` (#6) to settle against. (Here, no money moves.)
- [x] 4.4 Vitest: pooled request routes cheapest + carries sell rates; direct request pins seller + uses its cost.

## 5. Admin markup endpoint

- [x] 5.1 `GET/PUT /admin/v1/markup` (global default + per-model overrides), zod-validated, `markup >= 0`.
- [x] 5.2 Endpoint test: set per-model markup, read back; reject negative.

## 6. Verification

- [x] 6.1 Gateway `tsc` clean.
- [x] 6.2 Test suite green; expect +~14 tests.
- [x] 6.3 Manual: pool `gpt-5.5` with house $2.30 + hoang $2.40 + cinb $2.10 → request routes cinb; disable cinb → routes house (not hoang, since house cheaper); sell price = routed cost × 1.15.
- [x] 6.4 `openspec validate lowest-cost-routing --strict` passes.
