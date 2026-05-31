## 1. Settlement aggregate query

- [x] 1.1 Added `SettlementLedger.aggregateByModel({ since? })` → array of `{ sellerId, baseModel, requests, promptTokens, completionTokens }`, one SQL `GROUP BY (seller_id, base_model)` with `WHERE reversed = 0` (+ optional `ts >= since`). No row paging.
- [x] 1.2 Vitest (settlementAggregate.test.ts): groups by `(seller_id, base_model)`; excludes reversed rows; respects `since`.

## 2. Endpoint

- [x] 2.1 `GET /provision/listings/metrics` in `marketplace/routes/provision.ts` (provision `opts`, NOT admin). Query: `since?` (ISO, default = all-time / none), `baseModel?`.
- [x] 2.2 Per enabled listing join: requests/tokens ← settlement aggregate keyed `(sellerId, baseModel)`; successRate + lifetime counts ← `providerRuntimeRegistry.getAccount(providerAccountId).runtime` (null when account missing / totalRequests 0); latencyP50/P95 + rps ← `latencyTracker.snapshot()` tuples filtered to `accountId`.
- [x] 2.3 Every metric null when source empty (no fabricated 100%/0); `meta` block carries `{ settlementWindowSince, successHorizon:"lifetime", latencyWindowSeconds }`.
- [x] 2.4 DECISION: one account serving multiple publicModels → rps sums `ok.count` across the account's tuples (÷ windowSeconds); p50/p95 take the busiest tuple (so a high-traffic model's percentiles aren't diluted). Documented in the handler comment.

## 3. Verification

- [x] 3.1 Gateway `tsc` clean.
- [x] 3.2 Vitest (provisionListingMetrics.test.ts, marketplace-enabled): provision key → 200 one entry per listing; admin/client key → 401; no-traffic listing → null latency/rps/success but numeric counts; reversed settlement excluded.
- [x] 3.3 Full suite green (686 → 689 pass / 7 skip after +6 tests); engine→marketplace boundary test green (endpoint only READS engine services).
- [x] 3.4 `openspec validate marketplace-listing-metrics --strict` passes.
- [x] 3.5 Updated `docs/PROVISION_API_REFERENCE.md` + the website answer doc with the endpoint shape.

## 4. Out of scope (confirmed, not built)

- [x] 4.1 Context window per baseModel — website maintains a static table (X-Router has no per-canonical-model context metadata). Confirmed in the answer doc.
- [x] 4.2 Making latency/success durable/windowed beyond existing services — not in this change.
