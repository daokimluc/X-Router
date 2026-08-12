# Tasks — integrate-xrouter

## 1. Config + types
- [x] 1.1 `config.ts` — `MARKETPLACE_ENABLED` (+ XROUTER_ENABLED alias), URL, provision/internal/admin keys, webhook secret
- [x] 1.2 `types.ts` — exact doc field names: CreateKey{label}, WalletTopup{usd}/{walletUsd}, Grant, Markup, Seller, Listing, MarkPaid; events usage.recorded/quota.blocked/wallet.low/grant.exhausted/supply.unhealthy
- [x] 1.3 `.env.example` + `.env.local` documented (gitignored)

## 2. Client + adapter (all 10 provision endpoints)
- [x] 2.1 `client.ts` — server-only fetch, 3 auth dimensions, parses `{error:{message,code}}`
- [x] 2.2 `adapter.ts` — listModels, createKey, grantPlan, topUpWallet, setMarkup, createSeller/approve/suspend, createListing/setEnabled/delete, markEarningsPaid (flag + mock fallback for reads, typed errors for writes)
- [x] 2.3 `ledger.ts` — in-memory micro-USD ledger fed by webhooks (per-key spend, seller credit, summary)

## 3. API routes + webhook
- [x] 3.1 `GET /api/xrouter/models`
- [x] 3.2 `GET /api/xrouter/usage` (from ledger)
- [x] 3.3 `POST /api/webhooks/xrouter` — HMAC-SHA256 verify on raw body, idempotent dedupe, feeds ledger per event

## 4. Wire console UI
- [x] 4.1 Console marketplace renders live X-Router models
- [x] 4.2 Console usage renders ledger summary
- [x] 4.3 Console keys: server action `createKey` → `/provision/key`, shows plaintext key once

## 5. Verify (E2E with live X-Router on :3100, MARKETPLACE_ENABLED=true)
- [x] 5.1 `npm run build` + `tsc` pass
- [x] 5.2 Foza `/api/xrouter/models` returns 5 LIVE models from X-Router (kiro-sonnet, gemini-2.5-flash…)
- [x] 5.3 Console marketplace page renders live model names
- [x] 5.4 Provision commands verified: `/provision/key` → `{id,key,planId}`, `/wallet/topup` → `{keyId,walletUsd}`, `/markup` → `{defaultMarkup,perModel}`
- [x] 5.5 Webhook: signed usage.recorded → ledger records spend; duplicate → idempotent; bad signature → 401
- [x] 5.6 Auth isolation: admin key rejected on `/provision/*` (401)
- [x] 5.7 X-Router business webhook configured → Foza (`PUT /admin/v1/business-webhook`, secretSet:true)

## 6. All 5 events live (doc updated: grant.exhausted + supply.unhealthy now emitted)
- [x] 6.1 Ledger handles all 5: usage.recorded, quota.blocked, wallet.low, grant.exhausted, supply.unhealthy
- [x] 6.2 Provider page shows supply.unhealthy banner with seller + reason
- [x] 6.3 Fix cross-bundle ledger: move state to globalThis so route handlers + server components share one ledger (Next dev splits module instances otherwise)
- [x] 6.4 Mark ledger-reading pages (usage, provider, marketplace) `force-dynamic`
- [x] 6.5 E2E verified: usage page shows requests:1/$0.01; provider page shows acct_7 + reason

