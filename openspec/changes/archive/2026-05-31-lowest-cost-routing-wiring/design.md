## Context

How a pooled request flows today (openai.ts / anthropic.ts):

```
  modelResolver.resolve("gpt-5.5")
     └─ ModelRegistry.getAll("gpt-5.5")  → 1 mapping per SELLER listing
        (each mapping has a distinct providerInstanceId = that seller's host)
     └─ applyPrioritySort(candidates)    → ordered by instance PRIORITY, not cost
  for (const candidate of route.candidates):   ← tries in priority order
     accountPool = getAccountPool(candidate.providerInstanceId)
     lease = accountPool.acquire({ model })     ← NO costFor; pool is one seller's
                                                   accounts → cost is uniform here
```

`LowestCostStrategy` (from #5) lives at `accountPool.acquire` — inside a single
seller's instance. But every seller is a *separate* instance, so that layer never
compares sellers. The cost spread is **between candidates**, not between accounts
within one candidate. That's the layering mistake.

`request.routed` is currently set at enforce-time by `captureRouted` →
`routedContextForCheapest` (the cheapest *listing*), an approximation that can
disagree with whichever candidate the failover loop actually leases.

## Goals / Non-Goals

**Goals:**
- Pooled requests try sellers **cheapest-first** and fail over to the next cheapest
  on unhealthy/circuit-open/no-account.
- House (true wholesale) bounds the ceiling automatically (it's just the min, and
  always present).
- `request.routed` reflects the seller/account **actually leased**, so settlement
  credits the right seller.
- Engine stays marketplace-agnostic — ranking is injected via a seam.

**Non-Goals:**
- Direct namespaced requests (`hoang/gpt-5.5`) — already pin one seller; no ranking
  needed (single candidate). Unchanged.
- Changing the cost scalar or pricing math (#5 stands).
- Load-balancing/weighting across equal-cost sellers beyond the existing tie-breaks.
- Removing `LowestCostStrategy`/`costFor` — kept for a possible future
  single-instance multi-account cost case; just no longer the pooled mechanism.

## Decisions

### Rank at the candidate layer, via a seam
Add `MarketplaceSeam.rankCandidates?(model, candidates) => candidates`. The engine,
right after `resolve`, calls it (if present) to reorder `route.candidates` before
the failover loop. Empty/absent when the marketplace is off → engine order
(priority) preserved.

```
  route = modelResolver.resolve(model)
  if (seam.rankCandidates) route.candidates = seam.rankCandidates(model, route.candidates)
  for (const candidate of route.candidates) { ...existing failover... }
```

The marketplace ranker:
```
  rankCandidates(model, candidates):
     costs = listingCostFor(model)            // accountId/providerInstanceId → costPrice
     score(c) = cost(c.providerInstanceId)?.inputPerM + outputPerM  (∞ if no listing)
     stable-sort candidates by score asc; uncosted keep relative order, appended last
```
Because the candidate carries `providerInstanceId` and a listing maps 1:1 to an
instance, the ranker matches candidate→listing by instance id. House, priced at
wholesale, sorts at or below any third-party → ceiling holds with no special case.

### Why candidate-level beats account-level here
| Layer | Sees | Can compare sellers? |
|---|---|---|
| ModelResolver candidates | one entry per seller instance | **Yes** — cost varies here |
| AccountPool (per instance) | accounts of ONE seller | No — cost uniform within |

The cheapest-seller decision must be where seller cost varies: the candidate list.

### Failover falls out for free
The existing loop already `continue`s past disabled instances, open circuit
breakers, and empty pools. Ordering candidates cheapest-first means failover
naturally goes to the next-cheapest — satisfying the #5 spec scenario "cheapest
unhealthy → next cheapest (incl. house)" with no new failover code.

### request.routed from the lease, not a pre-guess
Move the `routed` capture out of enforce (`captureRouted`) to the route, right
after `accountPool.acquire` returns a lease: build it from the leased
`candidate.publicModel`/base model + `lease.account.id` + that account's listing
cost + derived sell rates. This makes settlement attribute the seller that served
the request. The enforce-time approximation is removed.

Edge: if the leased account has no listing cost (non-marketplace account that
happens to serve a pooled name), `routed` is left unset and settlement falls back
to its no-routed path (settle reservation, no seller credit) — same as today.

## Risks / Trade-offs

- **Risk: ranking cost on every pooled request.** `listingCostFor` is an in-memory
  map filter; candidate counts are small (sellers per model). Negligible. Cache not
  needed.
- **Risk: a seller priced just under house wins but is flaky.** Failover + circuit
  breaker already handle it (next-cheapest, house backstops). The health-driven
  `supply.unhealthy` event surfaces it to the website.
- **Trade-off: `request.routed` now set later (post-acquire) than enforce.** If a
  request is rejected before acquire (policy/enforce), there's no routed context —
  correct, since nothing was served. Settlement only runs on completion anyway.
- **Risk: priority vs cost conflict.** Cost ranking replaces priority ordering for
  pooled marketplace models. Direct/non-marketplace models keep priority. Documented;
  if an operator needs priority to override cost for a specific pool, that's a future
  knob, not this change.

## Open Questions

- Should equal-cost sellers tie-break by least-busy (needs per-instance load at the
  candidate layer) or stay stable/priority order? Lean: stable order now (simple),
  revisit if one cheap seller gets hammered.
- Do we ever want a per-pool "prefer house" or "prefer priority over cost" override?
  Not now — cheapest-first is the locked product decision. Note for later.
