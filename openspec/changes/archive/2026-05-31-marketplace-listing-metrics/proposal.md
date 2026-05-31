## Why

The Foza marketplace renders each listing card with six metrics — Requests, Success %,
Token, Context window, Latency, RPS — but the website has no per-listing data source, so
they show "—" or a hardcoded 100%. An audit of the website team's questions (answered in
`XRouter.ai/docs/ANSWERS_FROM_XROUTER_METRICS.md`) confirmed the underlying data already
exists inside X-Router but is scattered across three stores with mismatched grain and
freshness, and the only path that aggregates latency/success today is the **admin**
endpoint (`GET /admin/v1/metrics/latency`) — not appropriate for a public, end-user
display surface.

- Requests + tokens live in the durable SQLite `settlement_log` (group-able by
  `(sellerId, baseModel)`), and the website can already derive them from
  `usage.recorded` / `GET /provision/settlements` — but there is no single
  provision-key read that returns them keyed to a listing.
- Latency (p50/p95) lives in `LatencyTrackerService`, keyed by
  `(providerInstanceId, publicModel, accountId)` — a rolling 5-minute in-memory window —
  exposed only via the admin key.
- Success counts live in `ProviderAccount.runtime` (`totalRequests`/`failedRequests`,
  persisted, cumulative-lifetime) per account — not exposed to any provision endpoint.

A listing carries both `providerInstanceId` and `providerAccountId` (`SellerListing`), so
these sources CAN be joined down to one listing — there just is no endpoint that does it.

## What Changes

- **Add a provision-key read endpoint `GET /provision/listings/metrics`** that returns,
  per enabled listing, the metrics joined from the three existing sources keyed by the
  listing's `providerAccountId` + `(sellerId, baseModel)`:
  - `requests`, `promptTokens`, `completionTokens`, `totalTokens` — summed from
    `settlement_log` over an optional `since` window, excluding reversed rows, grouped by
    `(sellerId, baseModel)`.
  - `successRate` + `totalRequestsLifetime`/`failedRequestsLifetime` — from the listing
    account's `ProviderAccount.runtime` (clearly labeled **lifetime**, not windowed).
  - `latencyP50Ms`/`latencyP95Ms` + `rps` — from `LatencyTrackerService` filtered to the
    listing's `providerAccountId` (rolling 5-minute window; `rps = okCount/300`).
  - Each metric is null when its source has no data, never a fabricated value.
- **Add a per-`(sellerId, baseModel)` aggregate query to `SettlementLedger`**
  (`aggregateByModel({ since? })`) returning request count + token sums excluding
  reversed rows — so the endpoint sums rows in SQLite rather than paging all settlements.
- **Document the freshness/grain contract on the response** (a `meta` block) so the
  website does not blend three time horizons (settlement window vs lifetime success vs
  5-minute latency) into one misleading number. No metric is invented; missing → null.
- **No admin key, no money-path change, no new persisted state.** Provision-scope read
  only, composed from existing services.

## Capabilities

### New Capabilities
- `provision-listing-metrics`: the website can read, with the provision key alone,
  per-listing display metrics (requests, tokens, lifetime success, rolling latency, rps)
  joined from the settlement log, account runtime, and latency tracker — with an explicit
  freshness/grain contract and null (never fabricated) values when a source is empty.

## Impact

- New (marketplace): `GET /provision/listings/metrics` in
  `marketplace/routes/provision.ts`; `SettlementLedger.aggregateByModel()` in
  `marketplace/services/SettlementLedger.ts`.
- Reads (engine, one-way marketplace→engine, allowed): `app.latencyTracker.snapshot()`,
  `app.providerRuntimeRegistry.getAccount()`, `app.sellerService.listListings()`.
- Out of scope: context window (a static per-model attribute the website maintains —
  X-Router has no per-canonical-model context metadata); making latency/success durable or
  windowed beyond what the existing services already provide; realtime streaming
  (a few-minutes-stale card read is sufficient).
- No data migration. No admin coupling. Behind `MARKETPLACE_ENABLED` like all
  `/provision/*` routes.
