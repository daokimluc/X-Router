## Context

`AccountPool.acquire` filters healthy/available accounts then delegates to an `AccountSelectionStrategy.select(accounts, context)`. `strategyFactory` maps a strategy name to an implementation; `lowest_latency` and `lowest_error_rate` currently return `RoundRobinStrategy` (acknowledged stubs). `PriorityStrategy` sorts by `account.priority`. `AccountSelectionContext` already carries `model`, `now`, and a `quotaFilter`. `seller-supply` (#4) exposes `listingCostFor(baseModel) → [{accountId, sellerId, costPrice}]` and guarantees a house candidate.

The sell price model is settled: **one price = cheapest_cost × (1 + markup)**, markup per base model with a global default. This is what the buyer is metered at (plan bucket) and charged at (PAYG/boost).

## Goals / Non-Goals

**Goals:**
- Select the cheapest healthy candidate for a pooled base model; house cost is the natural ceiling.
- Deterministic tie-breaking (equal cost → least-busy → priority → stable order).
- Compute the buyer sell price from the routed candidate's cost and a per-model markup.
- Keep the strategy decoupled from `SellerService` (inject a cost lookup, don't import the service).
- Direct (namespaced) requests bypass selection — they're already pinned to one seller.

**Non-Goals:**
- Moving money / crediting sellers / commission — `two-sided-settlement` (#6).
- Latency/error-rate routing — separate, still stubbed.
- Predictive cost (token-count-weighted blended cost across providers) — we sort on per-1M cost; the request's actual token mix is settled afterward.
- Dynamic markup (surge pricing, per-buyer markup) — single per-model markup + global default for now.

## Decisions

### Selection algorithm
```
   candidates = pool.available(baseModel)            // already health/concurrency-filtered
   costed     = candidates.map(c => ({ c, cost: context.costFor(c.id) }))
                           .filter(x => x.cost != null)   // no cost ⇒ not routable as marketplace supply
   pick = min by cost
          tie → min activeRequests (least busy)
          tie → min priority
          tie → first (stable)
```
Because the house candidate is always present (when healthy) and priced at the platform's true wholesale, `min by cost` can never exceed the house cost — house is the ceiling automatically, no special-casing.

```
   gpt-5.5 pool:   cinb $2.10   hoang $2.40   house $2.30
                      ▲ pick (cheapest)            (ceiling)
   if cinb unhealthy → hoang $2.40 vs house $2.30 → pick house
```

### Sell price
`MarketPricingService.sellPriceFor(baseModel, costPerM) → costPerM × (1 + markup(baseModel))`. `markup(baseModel)` = per-model entry, else global default (e.g. `0.15`). Applied to each of input/output/cached rates. The *request's* sell cost is then `ModelPricingService.calculateCost`-style math but using sell rates derived from the routed candidate's cost rates.

```
   routed cinb cost {in 2.10, out 6.30}   markup(gpt-5.5)=0.15
   sell {in 2.415, out 7.245}
   request (1000 in, 500 out) → sell = 0.0024 + 0.0036 = 0.0060  ← buyer metered/charged at this
   cinb credit base = cost = 0.0021 + 0.0031 = 0.0052            ← seller side, computed in #6
```

### Cost lookup injection
`AccountSelectionContext` gains `costFor?: (accountId: string) => CostPrice | null`. The routing entry point builds this from `seller-supply`'s `listingCostFor(baseModel)` keyed by accountId. The strategy never imports `SellerService` — testable with a plain map.

### Pooled vs direct
- **Pooled** (`gpt-5.5`, an alias to the multi-mapping group): build the cost context, select via `lowest_cost`, then price with markup.
- **Direct** (`hoang/gpt-5.5`, single mapping): no selection; use that listing's cost; sell = its cost × (1+markup). Buyer "pinned a shop."

### What "no cost" means
A candidate the cost lookup returns `null` for is not marketplace supply (e.g. a legacy provider account never given a listing). For a **pooled** request it is filtered out (can't price it). For a **direct** request to a namespaced listing, cost always exists (the listing defines it). A pool that ends up with zero costed candidates → `NoAvailableAccountError` (house should prevent this).

## Risks / Trade-offs

- **Trade-off: sort on per-1M cost, not blended expected cost.** A provider cheap on input but dear on output could be mispicked for an output-heavy request. Accepted for v1 (simpler, house bounds worst case); a blended cost using the request's prompt size is a future refinement.
- **Risk: cost lookup stale vs. pool membership.** Mitigation: build the lookup at request time from the same source the pool was built from; a candidate without a cost entry is skipped, not crash.
- **Risk: markup misconfig → selling below cost.** Mitigation: markup is multiplicative and validated `>= 0`; default `0.15`; admin endpoint validates. Even markup 0 sells *at* cost, never below.

## Open Questions

- Should ties prefer **third-party over house** (to favor draining seller supply / keeping sellers happy) or **house over third-party** (max platform margin)? Default: cheapest wins; on exact tie prefer least-busy regardless of seller. Revisit if seller retention needs a thumb on the scale.
- Per-buyer or per-plan markup later? Out of scope; single per-model markup now.
