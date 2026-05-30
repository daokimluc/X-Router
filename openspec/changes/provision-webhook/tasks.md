## 1. Provision auth dimension

- [x] 1.1 Add `provisionApiKeys: string[]` to `AppConfig` (`config.ts`), default `[]`; load from env/config like `adminApiKeys`.
- [x] 1.2 Create `apps/gateway/src/middleware/provisionAuth.ts`: `createProvisionAuthMiddleware(config)` — `Bearer` token must be in `config.provisionApiKeys`, else 401 `invalid_provision_api_key`. Snapshot is fine (not runtime-mutable). Sets `request.provisionAuth = { apiKeyHash }`.
- [ ] 1.3 Persist `provisionApiKeys` via the same config/`PersistenceService` path as `adminApiKeys`; add `--set-provision-key` flag to `bin/x-router.js` (writes config.json + exits).
- [x] 1.4 Vitest: valid provision key passes; admin key rejected on `/provision/*`; provision key rejected on `/admin/*` and `/v1/*`; missing key → 401.

## 2. Provision route group

- [x] 2.1 Create `apps/gateway/src/routes/provision.ts`, mounted under `/provision` with the provision-auth preHandler. Register in app.ts.
- [x] 2.2 Seller lifecycle: `POST /provision/seller` (register → pending), `POST /provision/seller/:id/approve`, `POST /provision/seller/:id/suspend` → delegate to `SellerService` (#4). zod-validate bodies.
- [x] 2.3 Listing lifecycle: `POST /provision/listing` (sellerId, baseModel, costPrice, providerAccountId), `PATCH /provision/listing/:id` (cost/enabled), `DELETE /provision/listing/:id` → `SellerService` listing ops (#4).
- [x] 2.4 `POST /provision/grant` (keyId, planId, bucket overrides?, overageEnabled?, paygDailyLimitUsd?) → `PlanService` assign-plan-to-key (#3). Idempotent: same keyId+planId returns current grant unchanged.
- [x] 2.5 `POST /provision/wallet/topup` (keyId, usd) → `WalletService.topUp` (#1). Returns new balance.
- [x] 2.6 `POST /provision/key` (label, planId?, …) → `ApiKeyService.create`; returns the new key once (plaintext) + id.
- [x] 2.7 `PUT /provision/markup` (global default and/or per-base-model map) → `MarketPricingService` markup setters (#5).
- [x] 2.8 `POST /provision/earnings/:sellerId/mark-paid` (usd, payoutRef?) → `SellerEarningsLedger.markPaid` (#6); returns updated snapshot.
- [x] 2.9 Log every call with action + hashed provision-key id (mirror admin action logging).
- [x] 2.10 Vitest (endpoint-level): each endpoint delegates to its service and returns the expected shape; grant is idempotent; topup increases balance; mark-paid reduces unpaid; bad body → 400.

## 3. Business webhook channel

- [x] 3.1 Extend `WebhookService`: add the five business events to `WebhookEvent` (`usage.recorded`, `grant.exhausted`, `wallet.low`, `quota.blocked`, `supply.unhealthy`) and a separate `businessConfig: { enabled, url, secret, events }` with `getBusinessConfig`/`updateBusinessConfig`.
- [x] 3.2 `notifyBusiness(event, data)`: POST raw `WebhookPayload` JSON to `businessConfig.url` with `X-Provision-Signature: sha256=<hmac-sha256 hex>` over the exact serialized body using `businessConfig.secret`; 5s timeout; swallow failures (like `notify`). Skip if disabled or event not subscribed.
- [x] 3.3 Persist `businessConfig` (url/secret/enabled/events) alongside the existing ops webhook config.
- [x] 3.4 Vitest: signature is HMAC-SHA256 of the exact body under the secret; disabled config / unsubscribed event → no POST; payload envelope = `{ event, timestamp, data }`.

## 4. Wire emit points

- [x] 4.1 `usage.recorded` — in the `two-sided-settlement` settlement block, call `notifyBusiness("usage.recorded", settlementDataObject)` after a billable request settles (the data object from #6 task 5.3).
- [ ] 4.2 `grant.exhausted` — when a plan group's month bucket reaches 0 (SpendLedger/PlanService boundary), emit once per exhaustion with `{ keyId, planId, group, monthUsd }`.
- [ ] 4.3 `wallet.low` — when `WalletService` balance crosses the low-water threshold (global default, optional per-key override), emit `{ keyId, balanceUsd, thresholdUsd }`.
- [x] 4.4 `quota.blocked` — when `enforceKeyPolicy` rejects with no boost/overage escape (429/402), emit `{ keyId, reason, httpStatus, group? }`.
- [ ] 4.5 `supply.unhealthy` — when `ProviderHealthMonitor` marks a seller's account unhealthy, emit `{ sellerId, providerAccountId, reason }`.
- [x] 4.6 Vitest: settlement triggers `usage.recorded` with the settlement payload; a 429 reject triggers `quota.blocked`; emissions are best-effort (a throwing webhook does not fail the request).

## 5. Admin/config surface for business webhook

- [x] 5.1 Admin endpoints to read/update `businessConfig` (url, secret, enabled, events) — reuse the existing webhook settings pattern; mask the secret on read.
- [x] 5.2 Endpoint test for get/update of business webhook config.

## 6. Verification

- [x] 6.1 Gateway `tsc` clean.
- [x] 6.2 Test suite green; expect +~16 tests.
- [x] 6.3 Manual: set a provision key + business webhook URL/secret pointing at a local listener; drive `POST /provision/key` → `POST /provision/grant` → `POST /provision/wallet/topup`; make a billable request; confirm a signed `usage.recorded` arrives and the signature verifies; exhaust a bucket and confirm `grant.exhausted`/`quota.blocked`.
- [x] 6.4 `openspec validate provision-webhook --strict` passes.
