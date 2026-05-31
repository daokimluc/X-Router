## 1. Candidate-ranking seam (engine)

- [x] 1.1 Add `rankCandidates?` to `MarketplaceSeam`: `(model: string, candidates: ResolvedModelCandidate[]) => ResolvedModelCandidate[]` + a setter `setCandidateRanker(fn)`. Empty/unset → identity.
- [x] 1.2 The seam must not import marketplace types; it takes/returns the engine's `ResolvedModelCandidate[]` and a model string only.
- [x] 1.3 Vitest: seam with no ranker returns candidates unchanged; with a ranker, applies it.

## 2. Wire into the routes (engine)

- [x] 2.1 `routes/openai.ts` + `routes/anthropic.ts`: after `modelResolver.resolve(...)`, if `app.marketplaceSeam.rankCandidates` is set, reorder `route.candidates` with it before the failover loop.
- [x] 2.2 Leave the existing failover loop untouched (it already skips disabled/circuit-open/empty-pool candidates → next-cheapest).
- [x] 2.3 Vitest (route-level or seam-level): given 3 candidates costed [2.4, 2.1, 2.3-house], the loop tries 2.1 first; if its instance is disabled, tries 2.3 (house) before 2.4.

## 3. Marketplace ranker

- [x] 3.1 `marketplace/policy/marketplaceRouting.ts`: `createCandidateRanker(sellerService, marketPricingService)` → returns `(model, candidates)` that sorts by `listingCostFor(model)` cost scalar (inputPerM+outputPerM); candidates whose `providerInstanceId` has no listing cost keep relative order and are appended last. Stable sort.
- [x] 3.2 Register it in `index.ts` via `app.marketplaceSeam.setCandidateRanker(...)`.
- [x] 3.3 Vitest: cheapest-first ordering; house (lowest) ranks at/below third-party; uncosted candidate appended.

## 4. request.routed from the lease (move off enforce-time approximation)

- [x] 4.1 In both routes, after `accountPool.acquire(...)` returns a lease, set `request.routed` from the leased candidate's base model + `lease.account.id` + that account's listing cost (`listingCostFor(model)` matched by accountId) + `marketPricingService.sellPriceFor`. Expose a helper `routedContextForAccount(sellerService, pricing, model, accountId)` in `marketplaceRouting.ts`.
- [x] 4.2 Remove the enforce-time `captureRouted` call + `routedContextForCheapest` usage (keep the function or delete — decide; the ranker + per-account capture supersede it).
- [x] 4.3 If the leased account has no listing cost, leave `request.routed` unset (settlement no-routed fallback unchanged).
- [x] 4.4 Vitest: pooled request leased on seller B's account → `request.routed.sellerId === B`, sell rates from B's cost; settlement credits B (not the cheapest-by-guess).

## 5. Verification

- [x] 5.1 Gateway `tsc` clean.
- [x] 5.2 Full suite green; expect +~8 tests. Existing #5/#6 tests still pass (strategy + pricing unchanged).
- [x] 5.3 Manual: pool `gpt-5.5` with house $2.30 + hoang $2.40 + cinb $2.10 → request routes cinb; disable cinb's instance → routes house (cheaper than hoang); confirm `GET /provision/usage` / settlement attributes the served seller.
- [x] 5.4 `openspec validate lowest-cost-routing-wiring --strict` passes.

## 6. Cleanup / docs

- [x] 6.1 Note in code (LowestCostStrategy + types `costFor`) that the pooled selection mechanism is candidate-level ranking; the account-level strategy is retained only for a possible future single-instance multi-account case.
- [x] 6.2 If `docs/MARKETPLACE_INTEGRATION.md` describes routing, add a line that pooled names route cheapest-seller-first with house as ceiling and automatic failover.
