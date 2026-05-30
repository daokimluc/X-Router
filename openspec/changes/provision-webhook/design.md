## Context

Every prior change built a service the website needs to drive or observe: `usd-wallet` (`reserveUsd/settleUsd/topUp`), `marketplace-plans` (`PlanService`, plan-on-key), `seller-supply` (`SellerService`, `SellerListing`), `lowest-cost-routing` (`MarketPricingService` markup), `two-sided-settlement` (`SellerEarningsLedger` + the settlement data object). What's missing is the **wire** between the website (control-plane) and x-router (engine): a way for the website to issue commands in, and a way for x-router to push results out.

x-router already has two auth dimensions — `config.adminApiKeys` (read live, mutated by `AdminKeyService`) and the legacy `internalApiKeys` (snapshotted) — and a `WebhookService` that currently fires Discord/Slack-formatted messages for ops events (`circuit_breaker.open`, `account.cooldown`, …). This change adds a **third** auth dimension for machine-to-machine provisioning and **extends** `WebhookService` to carry structured, signed business events.

## Goals / Non-Goals

**Goals:**
- A single `/provision/*` route group the website calls to drive the engine: seller lifecycle, plan grants, wallet top-ups, key creation, markup, payout marking.
- A dedicated **provision API key** dimension, distinct from admin and internal keys, so the website's automation credential is separable and revocable on its own.
- Outbound **signed** business events (`usage.recorded`, `grant.exhausted`, `wallet.low`, `quota.blocked`, `supply.unhealthy`) the website can verify and act on (invoice, pay out, notify).
- No new billing logic — this change only transports commands in and events out; the numbers come from #1–#6.

**Non-Goals:**
- Buyer/seller identity, plan-catalog UI, VND/QR payment, FX, payout banking — all website-side. x-router speaks USD and plan/seller IDs only.
- A generic pub/sub or retry-queue system — events are best-effort HTTP POST with signing; durable delivery (DLQ, replay) is future.
- Replacing the existing Discord/Slack ops webhooks — those stay; business events are a new, separately-targeted channel.
- Mutual TLS / OAuth between website and x-router — a shared provision key + HMAC payload signing is the agreed trust model for this phase.

## Decisions

### Provision auth is a third key dimension, snapshot-style
Add `config.provisionApiKeys: string[]`, mirroring `internalApiKeys` (a startup snapshot is fine — unlike the admin password, the provision key is not changed from the dashboard at runtime). A `createProvisionAuthMiddleware(config)` checks `Bearer` against `config.provisionApiKeys` and 401s otherwise. The provision key is **never** accepted by admin or client routes, and admin/internal keys are **never** accepted by `/provision/*` — the dimensions are isolated so a leaked dashboard password can't drive provisioning and vice-versa.

```
   /admin/v1/*     ← adminApiKeys      (dashboard, runtime-mutable)
   /v1/*           ← client API keys   (ApiKeyService, per-buyer)
   /provision/*    ← provisionApiKeys  (website automation, this change)
```

### `/provision/*` is a thin wrapper, not new logic
Each endpoint validates input (zod), calls exactly one existing service method, and returns its result. No endpoint computes prices, meters usage, or moves money beyond delegating to the owning service. This keeps the contract auditable and means the engine's invariants (e.g. house-never-credited, sell = cost × (1+markup)) are enforced in one place regardless of caller.

| Endpoint | Delegates to |
|---|---|
| `POST /provision/seller`, `…/:id/approve`, `…/:id/suspend` | `SellerService` (#4) |
| `POST /provision/listing`, `PATCH /…/:id`, `DELETE /…/:id` | `SellerService` listing ops (#4) |
| `POST /provision/grant` | `PlanService` assign-plan-to-key (#3) |
| `POST /provision/wallet/topup` | `WalletService.topUp` (#1) |
| `POST /provision/key` | `ApiKeyService.create` |
| `PUT /provision/markup` | `MarketPricingService` markup setters (#5) |
| `POST /provision/earnings/:sellerId/mark-paid` | `SellerEarningsLedger.markPaid` (#6) |

`POST /provision/grant` is the website's "buyer bought plan X" command: it sets `planId` + bucket overrides + `overageEnabled` + `paygDailyLimitUsd` on the target key, replacing any existing grant idempotently (same key + same planId → no-op return of current state).

### Business events extend WebhookService, kept separate from ops events
`WebhookEvent` gains five business events. Rather than overload the single Discord/Slack `config.url`, business events go to a **separate target** with a **shared secret**:

```
   WebhookService.config (existing): { enabled, url, events }           ← ops, Discord/Slack formatted
   WebhookService.businessConfig (new): { enabled, url, secret, events } ← business, JSON + HMAC
```

`notifyBusiness(event, data)` POSTs the raw `WebhookPayload` JSON (not Discord/Slack-shaped) to `businessConfig.url` with header `X-Provision-Signature: sha256=<hex>` = HMAC-SHA256 of the exact JSON body under `businessConfig.secret`. The website verifies the signature before trusting the event. This separation means the website gets machine-parseable JSON while humans still get Discord/Slack ops alerts.

### Event → emit-point mapping
```
   usage.recorded    ← two-sided-settlement settlement block (the data object from #6.5.3)
   grant.exhausted   ← SpendLedger month bucket reaches 0 for a plan group (#2/#3)
   wallet.low        ← WalletService balance crosses a configurable low-water threshold (#1)
   quota.blocked     ← enforceKeyPolicy rejects (429/402) with no boost/overage escape (#3/#6)
   supply.unhealthy  ← ProviderHealthMonitor marks a seller's account unhealthy (#4)
```
`usage.recorded` is the high-volume event (one per billable request); the other four are edge-triggered. All carry the same `WebhookPayload` envelope `{ event, timestamp, data }`; `data` shape is per-event (specified in the `marketplace-webhooks` delta).

### Signing covers the exact serialized body
The HMAC is computed over the exact bytes sent (`JSON.stringify(payload)`), not a re-serialization, so the website verifies against the raw request body it receives. Timestamp is inside the signed payload, letting the website reject stale events (replay window is the website's policy).

### Persistence
`provisionApiKeys` and `businessConfig` (url, secret, enabled, event subscriptions) persist via the existing config / `PersistenceService` path that already stores `adminApiKeys` and the ops webhook config. A `bin/x-router.js` flag (`--set-provision-key`) and/or an admin endpoint can rotate the provision key; out of scope to fully build here beyond persisting the field.

## Risks / Trade-offs

- **Risk: provision key leak = full control-plane access** (create keys, grant plans, top up wallets). Mitigation: separate dimension (revoke without touching the dashboard password), `Bearer`-only, recommend the website hold it in a secret store and rotate. Documented as a security note.
- **Risk: `usage.recorded` volume** — one POST per billable request could overwhelm the website or x-router's outbound. Mitigation: business webhook is best-effort and fire-and-forget (5s timeout, failures swallowed like the existing `notify`); if volume is a problem the website subscribes only to edge events and pulls usage via a future batch endpoint. Noted as an open question.
- **Risk: unsigned/forged events** if the website skips verification. Mitigation: always send `X-Provision-Signature`; document that the website MUST verify. x-router can't enforce the receiver's diligence.
- **Trade-off: best-effort delivery, no durable queue.** A website outage drops events in that window. Accepted for this phase; the website can reconcile via `/provision` pull endpoints (e.g. earnings snapshot) rather than relying solely on push. Durable delivery is future work.
- **Risk: provision endpoints bypass dashboard audit.** Mitigation: every `/provision/*` call is logged with the (hashed) provision key id and action, same as admin actions.

## Open Questions

- Should `usage.recorded` be per-request or batched (e.g. flush every N seconds / M records)? Lean: per-request now for simplicity and real-time website ledgers; add an opt-in batch mode if volume bites. Decide during implementation.
- One provision key or many (per-environment / per-purpose)? Lean: an array like `adminApiKeys`, so multiple are allowed; the website uses one. Confirm.
- Should `wallet.low` threshold be global or per-key? Lean: global default with optional per-key override (mirrors overage/paygDailyLimit being per-key). Confirm during implementation.
