## Why

`lowest-cost-routing` (#5) shipped a `LowestCostStrategy`, a `MarketPricingService`,
and `SellerService.listingCostFor` — all unit-tested and correct — but the
cheapest-seller selection **never connects on the live request path**. Two breaks,
plus a layering mistake discovered now:

1. **`costFor` is never passed to the pool.** `routes/openai.ts:199` and
   `routes/anthropic.ts:191` call `accountPool.acquire({ model })` with no
   `costFor`. `LowestCostStrategy` therefore always receives `costFor === undefined`
   and returns `null`. `buildCostFor()` exists but is never invoked on a route.

2. **Provider instances default to `round_robin`,** not `lowest_cost`, so even if
   `costFor` were passed, the strategy wouldn't run unless each instance were
   reconfigured.

3. **The deeper issue — wrong layer.** Each seller listing registers a model
   mapping under a **distinct `providerInstanceId`** (the seller's own account
   host). So `ModelRegistry.getAll("gpt-5.5")` returns **one candidate per seller**,
   and `ModelResolver` orders them by **provider-instance priority**, not cost. The
   route then takes candidates in that order. `AccountPool`/`LowestCostStrategy`
   only ever sees the accounts **within a single seller's instance** — where the
   cost is uniform — so account-level cost selection cannot choose the cheapest
   *seller*. Cheapest-seller selection is inherently a **candidate-ordering**
   decision, one layer above where #5 put it.

Net effect: a pooled `gpt-5.5` request does **not** route to the cheapest seller.
Settlement still charges the right amount (it uses `routedContextForCheapest`, the
cheapest *listing*), but the request may actually run on a **more expensive
seller's account** — so "who served it" and "what we billed" diverge, and the
platform's core promise (route the cheapest supply, house as ceiling) is unmet.

## What Changes

- Add an engine seam `marketplaceSeam.rankCandidates?(model, candidates)` that the
  marketplace fills: given the resolved candidates for a pooled base model, return
  them **reordered cheapest-first** using `listingCostFor` (house naturally lands
  at or below any third-party, so it bounds the ceiling). Candidates with no listing
  cost keep their existing relative order, appended after costed ones.
- Wire it in `routes/openai.ts` + `routes/anthropic.ts`: after `modelResolver.resolve`,
  if the seam provides a ranker, reorder `route.candidates` before the failover loop.
  The existing `for (const candidate of route.candidates)` loop then tries cheapest
  first and **fails over to the next cheapest** automatically (unhealthy/circuit-open
  cheapest is skipped — exactly the spec's failover scenario).
- Set `request.routed` from the **actually-leased** candidate + account (after
  `accountPool.acquire` succeeds), replacing the enforce-time cheapest-listing
  approximation, so settlement credits the seller that truly served the request.
- Retire the account-level `lowest_cost` path as the pooled mechanism (keep the
  strategy + `costFor` context for any future single-instance multi-account cost
  case, but it is no longer the marketplace's selection seam). Document the layer
  decision.
- **BREAKING** none — the seam is empty when the marketplace is off; engine routing
  is unchanged for non-marketplace models.

## Capabilities

### New Capabilities
- (none — this completes the existing `lowest-cost-routing` capability's intent.)

### Modified Capabilities
- `lowest-cost-routing`: the selection mechanism moves from account-level strategy
  to candidate-level ranking (the layer where per-seller cost actually varies), and
  the routed `sellerId`/`accountId` captured for settlement reflects the account
  actually leased, not a pre-routing approximation.

## Impact

- Engine: `services/MarketplaceSeam.ts` (+`rankCandidates` hook), `routes/openai.ts`
  + `routes/anthropic.ts` (reorder candidates after resolve; set `request.routed`
  from the lease). Engine never imports marketplace — the ranker is injected.
- Marketplace: `marketplace/index.ts` registers the ranker built from
  `SellerService.listingCostFor` + `MarketPricingService`; `request.routed` capture
  moves from `captureRouted` (enforce-time) to the route's post-acquire point.
- No change to `MarketPricingService`, `SellerService`, or settlement math — only
  *which* candidate/account the request runs on and is attributed to.
- Depends on: `seller-supply` (#4, `listingCostFor`), `lowest-cost-routing` (#5,
  pricing), `two-sided-settlement` (#6, `request.routed` consumer).
