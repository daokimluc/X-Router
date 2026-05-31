## 1. Provision read endpoints

- [x] 1.1 `GET /provision/wallet/:keyId` → `{ keyId, walletUsd, provisioned }` via `WalletService.getUsd` + `isProvisioned`.
- [x] 1.2 `GET /provision/earnings/:sellerId` → `SellerEarningsLedger.snapshot(sellerId)`.
- [x] 1.3 `GET /provision/earnings/platform` → `{ platformMarginUsd }`.
- [x] 1.4 `GET /provision/plans` → `{ plans: PlanService.list() }`.
- [x] 1.5 `GET /provision/sellers?status=` → `{ sellers: SellerService.listSellers(status?) }` (zod-validate status enum).
- [x] 1.6 `GET /provision/listings?baseModel=` → `{ listings: SellerService.listListings(baseModel?) }`.
- [x] 1.7 `GET /provision/markup` → `MarketPricingService.listMarkups()`.
- [x] 1.8 All under the existing `provisionAuth` preHandler; reuse the `opts` in `provision.ts`.

## 2. Usage reconciliation

- [x] 2.1 `GET /provision/usage?since=<ISO>&keyId=<id>&limit=<n>` → `UsageService.query`. Resolve `keyId` → `apiKeyHash` server-side (via `ApiKeyService.findById`) before querying; `since` → filter; default + max `limit`.
- [x] 2.2 Response `{ data: UsageRecord[], total }` (the existing query shape). Document it as reconciliation-grade (tokens/model/cost/timestamps), NOT settlement replay.
- [x] 2.3 Vitest: pull by keyId returns only that key's records; `since` filters older records out; limit honored.

## 3. Self-service webhook config

- [x] 3.1 `PUT /provision/webhook` (enabled/url/secret/events) → `WebhookService.updateBusinessConfig`; validate events against the 5 business events.
- [x] 3.2 `GET /provision/webhook` → config with the secret masked (mirror the admin route's masking).
- [x] 3.3 Vitest: provision key can set + read (masked) the business webhook config.

## 4. Tests + verification

- [x] 4.1 Endpoint tests: each GET returns the expected shape with the provision key; admin/client keys are rejected (401) on these `/provision/*` reads.
- [x] 4.2 Wallet/earnings reads reflect prior provision writes (topup then GET wallet; credit then GET earnings).
- [x] 4.3 Gateway `tsc` clean; full suite green; expect +~10 tests.
- [x] 4.4 `openspec validate provision-read-api --strict` passes.

## 5. Website follow-up (separate repo — out of scope here, listed for tracking)

- [ ] 5.1 Drop `XROUTER_ADMIN_KEY` / `config.adminKey` from the website.
- [ ] 5.2 Switch `getUsage()` + wallet/earnings/plans console reads from mock+ledger to live `/provision/*` GETs.
- [ ] 5.3 Add a reconciliation sweep that pulls `GET /provision/usage?since=<lastSeen>` and folds into the ledger idempotently.
- [ ] 5.4 Move business-webhook setup from `/admin/v1/business-webhook` to `PUT /provision/webhook`.
