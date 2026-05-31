## Context

`provision-webhook` (#7) gave the website a provision key and a `/provision/*`
command surface, plus 5 HMAC-signed business webhooks. The surface is
write-only. The reads the website needs live behind `/admin/*` (admin-key auth):
`GET /admin/v1/plans`, `/admin/v1/sellers`, `/admin/v1/listings`,
`/admin/v1/markup`, `/admin/v1/api-keys/:id/wallet`,
`/admin/v1/earnings/seller/:id`, `/admin/v1/earnings/platform`,
`PUT /admin/v1/business-webhook`.

The website (verified in `D:\Project\XRouter.ai`) therefore either holds the
admin key or renders from mock data + an in-memory webhook-fed ledger that does
not survive restart and cannot be reconciled.

All the underlying data is already exposed by services decorated on `app`:
`WalletService.getUsd/isProvisioned`, `SellerEarningsLedger.snapshot/getPlatformMargin`,
`PlanService.list`, `SellerService.listSellers/listListings`,
`MarketPricingService.listMarkups`, `UsageService.query`,
`WebhookService.updateBusinessConfig/getBusinessConfig`.

## Goals / Non-Goals

**Goals:**
- A provision-key read surface that mirrors the admin reads the website needs,
  so the website runs on **one** auth dimension (provision) and never holds the
  admin key.
- A usage reconciliation endpoint so the website can rebuild its ledger after
  missed/duplicated webhooks (webhooks stay the real-time path; this is the
  catch-up path).
- Let the website configure its own business webhook target via the provision
  key (`PUT /provision/webhook`), not the admin key.

**Non-Goals:**
- No new aggregation/reporting beyond what `UsageService` already computes.
- No change to the write endpoints or to the 5 webhook events.
- No website-side code (separate repo) — that's a follow-up: drop `adminKey`,
  swap mock/ledger reads for live calls, add a reconciliation sweep.
- No pagination redesign — `GET /provision/usage` uses the existing
  `UsageService.query` filter/limit shape.

## Decisions

### Read endpoints are thin wrappers, same as the writes
Each GET validates params (zod) and calls one existing service read, returning
its shape. No endpoint computes prices or moves money.

```
   GET /provision/wallet/:keyId        → WalletService.getUsd + isProvisioned
   GET /provision/earnings/:sellerId   → SellerEarningsLedger.snapshot
   GET /provision/earnings/platform    → SellerEarningsLedger.getPlatformMargin
   GET /provision/plans                → PlanService.list
   GET /provision/sellers?status=      → SellerService.listSellers
   GET /provision/listings?baseModel=  → SellerService.listListings
   GET /provision/markup               → MarketPricingService.listMarkups
   GET /provision/usage?since=&keyId=&limit=  → UsageService.query
```

### Usage reconciliation maps to UsageService.query
`UsageService.query({ since, apiKeyHash?, limit })` already returns
`{ data, total }`. The website pulls records since its last-seen timestamp and
folds them into its ledger idempotently (it already dedupes webhook events).
Note: the engine's `UsageRecord` keys by `apiKeyHash`; the `keyId` filter
resolves to the key's hash before querying so the website can ask by either —
decide the exact param name in tasks (`keyId` is friendliest to the website).

### Settlement-grade fields vs. raw usage
`usage.recorded` webhooks carry settlement fields (`actualSellCost`,
`sellerCredit`, `platformMargin`). `UsageService.UsageRecord` carries tokens +
`estimatedCost`, not the sell/seller split. So `GET /provision/usage` is a
**reconciliation/audit** view (tokens, model, cost, timestamps), not a
byte-for-byte replay of the settlement payload. If the website needs exact
settlement replay, a small persisted settlement log is a separate, larger change
— flagged as an open question rather than silently overloading this endpoint.

### Webhook config via provision key
`PUT /provision/webhook` wraps `WebhookService.updateBusinessConfig`; a
companion `GET /provision/webhook` returns the config with the secret masked
(same masking as the admin route). This lets the website self-configure its
webhook target without the admin key. The admin route stays for dashboard use.

## Risks / Trade-offs

- **Risk: provision key now reads buyer balances + seller earnings.** It already
  *writes* those (top-up, mark-paid), so read access is a strictly smaller
  escalation; the key is server-side only on the website. Documented.
- **Trade-off: `GET /provision/usage` is reconciliation-grade, not settlement
  replay.** Accepted — webhooks remain the source for settlement amounts; the
  pull path covers tokens/cost for catch-up. Exact-replay is deferred.
- **Risk: high-volume usage pulls.** Mitigated by the existing `limit` + `since`
  filter; the website pulls deltas, not the full history.

## Open Questions

- Should `GET /provision/usage` filter by `keyId` (resolve to hash server-side)
  or expect the website to pass `apiKeyHash` directly? Lean: accept `keyId` and
  resolve — friendlier, hides the hashing detail. Confirm in tasks.
- Do we need a persisted, settlement-grade usage log for exact webhook replay
  (sellerCredit/platformMargin per record), or is reconciliation-grade enough?
  Lean: reconciliation-grade now; revisit if the website's billing needs exact
  replay. Separate change if so.
