## Why

The website (Foza, `D:\Project\XRouter.ai`) is the control-plane and is wired to
x-router across a single auth dimension — the **provision key**. It maps all 11
`/provision/*` write commands and verifies all 5 business webhooks. But the
`/provision/*` surface is **write-only**: every route is `POST`/`PUT`/`PATCH`/
`DELETE`. There is no provision-authenticated way to *read* the state the
website must render.

The data the website needs to read (a buyer's wallet balance, a seller's
earnings, the plan catalog, sellers/listings, current markup) exists only behind
`/admin/*` (admin-key auth). This forces the website into two bad workarounds,
both visible in its code today:

- it carries the **admin key** (`config.adminKey`, "for /admin/* e.g.
  configuring the business webhook") purely to read — defeating the auth
  separation both sides designed for, and
- it falls back to **mock data** (`getUsage()` returns `mockUsage`) and an
  in-memory webhook-fed **ledger** as its record of truth, which is lost on
  restart and cannot be reconciled against the engine.

Webhooks are best-effort fire-and-forget. With no pull endpoint, any event the
website misses (downtime, deploy) is gone — there is no way to reconcile usage,
balances, or earnings back to the engine's authoritative state.

## What Changes

Add **read** endpoints to the `/provision/*` group (provision-key auth), thin
wrappers over services that already expose the data — mirroring the existing
write wrappers, no new business logic:

- `GET /provision/wallet/:keyId` → wallet balance (`WalletService.getUsd` / `isProvisioned`).
- `GET /provision/earnings/:sellerId` → seller earnings snapshot (`SellerEarningsLedger.snapshot`).
- `GET /provision/earnings/platform` → platform margin running total.
- `GET /provision/plans` → plan catalog (`PlanService.list`).
- `GET /provision/sellers?status=` → sellers (`SellerService.listSellers`).
- `GET /provision/listings?baseModel=` → listings (`SellerService.listListings`).
- `GET /provision/markup` → current markup table (`MarketPricingService.listMarkups`).
- `GET /provision/usage?since=&keyId=&limit=` → settled usage records for
  reconciliation/replay (`UsageService.query`), so the website can rebuild its
  ledger after missed webhooks.

Plus, to remove the admin-key dependency for the website's own setup:

- `PUT /provision/webhook` → set the business webhook target (url/secret/events)
  via the provision key, wrapping `WebhookService.updateBusinessConfig` (secret
  masked on the companion `GET`). Today this is only `PUT /admin/v1/business-webhook`.

- **BREAKING** none — purely additive routes on the existing group + auth.

## Capabilities

### New Capabilities
- `provision-read-api`: Provision-key-authenticated read + reconciliation surface
  (`GET /provision/*`) so the website can render wallet/earnings/plan/seller/
  markup state and replay missed usage without holding an admin key.

### Modified Capabilities
- (none — composes existing services behind new GET routes; the `provision-api`
  capability from `provision-webhook` is extended, not changed.)

## Impact

- Modified: `apps/gateway/src/marketplace/routes/provision.ts` — add the GET
  routes + `PUT /provision/webhook` under the same `provisionAuth` preHandler.
- Reuses: `WalletService`, `SellerEarningsLedger`, `PlanService`, `SellerService`,
  `MarketPricingService`, `UsageService.query`, `WebhookService` — all already
  decorated on `app`.
- Website (`D:\Project\XRouter.ai`, separate repo): can drop `config.adminKey`,
  switch `getUsage()` and the wallet/earnings/plans console reads from mock+ledger
  to live `/provision/*` reads, and add a reconciliation sweep on the
  `GET /provision/usage` endpoint. (Out of scope here — website-side follow-up.)
- Depends on: `provision-webhook` (#7) for the provision auth dimension + the
  services being read.
