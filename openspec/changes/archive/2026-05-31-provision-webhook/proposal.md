## Why

The website is the control-plane: buyers and sellers act there, and those actions must reach x-router as commands, while x-router's metering/settlement results must flow back so the website can invoice, pay out, and notify. Everything until now built the *engine* (wallet, plans, buckets, sellers, routing, settlement); this change defines the **integration contract** — a dedicated `/provision/*` command surface for the website to drive, and a set of `WebhookService` events x-router emits with the settlement data produced in `two-sided-settlement`.

This is the last change in the sequence: it exposes the engine to the website and closes the loop. It introduces no new billing logic — it transports commands in and events out.

## What Changes

- Add a `/provision/*` route group, authenticated by a dedicated **provision API key** (separate from admin + internal keys), for the website to call:
  - `POST /provision/listing`, `PATCH /provision/listing/:id`, `DELETE /provision/listing/:id` — seller supply lifecycle (wraps `seller-supply`).
  - `POST /provision/seller`, `POST /provision/seller/:id/approve|suspend` — seller account lifecycle.
  - `POST /provision/grant` — assign/replace a plan on a key (`marketplace-plans`): scope + buckets + overage + paygDailyLimit.
  - `POST /provision/wallet/topup` — credit a key's USD wallet (called after the website confirms a VND/QR payment).
  - `POST /provision/key` — create an internal API key for a buyer.
  - `PUT /provision/markup` — set per-model markup + global default (`lowest-cost-routing`).
  - `POST /provision/earnings/:sellerId/mark-paid` — website reports a payout settled (`two-sided-settlement`).
- Emit `WebhookService` events with a signed payload: `usage.recorded`, `grant.exhausted`, `wallet.low`, `quota.blocked`, `supply.unhealthy`. Subscriptions/targets configurable.
- The settlement data object from `two-sided-settlement` becomes the `usage.recorded` payload.
- **BREAKING** none — new isolated route group + new events; existing admin/runtime endpoints untouched.

## Capabilities

### New Capabilities
- `provision-api`: A website-facing command surface (`/provision/*`) authenticated by a dedicated provision key, wrapping seller, plan, wallet, key, and markup operations so the website can drive x-router as a control-plane.
- `marketplace-webhooks`: Outbound signed events (`usage.recorded`, `grant.exhausted`, `wallet.low`, `quota.blocked`, `supply.unhealthy`) carrying settlement and quota state back to the website for invoicing, payout, and notification.

### Modified Capabilities
- (none published — composes existing services behind a new route group and emits via the existing `WebhookService`.)

## Impact

- New route group: `apps/gateway/src/routes/provision.ts` (or `routes/provision/*`), mounted with provision-key auth middleware.
- New auth: a `provisionApiKeys` config dimension + middleware, mirroring `internalApiKeys` (snapshot is fine — these don't change at runtime), distinct from admin keys.
- Modified: `WebhookService` usage — define the five event types + payloads; emit from the relevant points (settlement → `usage.recorded`; ledger thresholds → `grant.exhausted`/`wallet.low`; enforce reject → `quota.blocked`; health monitor → `supply.unhealthy`).
- Event signing: HMAC over the payload with a shared secret the website holds (so the website can verify authenticity).
- Persistence: provision key(s) + webhook targets/secret persisted via config/`PersistenceService`.
- Depends on: all of #1–#6 (it wraps their services and transports their outputs).
