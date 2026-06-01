# Tasks — marketplace-token-packs

## 1. Engine substrate (neutral)
- [x] 1.1 `Database.ts`: bump `SCHEMA_VERSION` to 6; add a v6 migration creating `token_grants` (id, key_id, base_model, tokens_total, tokens_remaining, price_paid_micro, expires_at, created_at, idempotency_key UNIQUE) + index on (key_id, base_model).
- [x] 1.2 `MarketplaceSeam.ts`: widen `SettlementRecord.billTrack` and the `request.settlement.billTrack` type from `"plan" | "payg"` to include `"tokenpack"`.

## 2. TokenGrantService (marketplace, SQLite-transactional)
- [x] 2.1 New `marketplace/services/TokenGrantService.ts` — constructor takes `Database`; in-memory `Map` for reservations; injectable `now` for tests.
- [x] 2.2 `grant({keyId, baseModel, tokens, pricePaidUsd, expiresAt, idempotencyKey})` — `INSERT ... ON CONFLICT(idempotency_key) DO NOTHING`, then SELECT + return the row (new or pre-existing); reject non-positive `tokens` / past `expiresAt` at the route layer.
- [x] 2.3 `findUsable(keyId, baseModel, now)` — un-expired (`expires_at > now`) row for the pair with the most `tokens_remaining > 0`; null if none.
- [x] 2.4 `reserve({grantId, estTokens})` — tx: re-read remaining; `< estTokens` → `{ok:false}`; else decrement by estTokens, stash `{grantId, estTokens}`, return `{ok:true, reservationId}`.
- [x] 2.5 `settle(reservationId, actualTokens)` — tx: correct grant by `(estTokens − actualTokens)`, floor `tokens_remaining` at 0; drop the hold; no-op for unknown id.
- [x] 2.6 `release(reservationId)` — tx: add estTokens back; drop the hold; no-op for unknown id.
- [x] 2.7 `listForKey(keyId, now)` — packs for a key, un-expired first (for the read surface).

## 3. Enforce — tokenpack step before plan/PAYG
- [x] 3.1 Refactor `estimateUpperBoundCost` in `marketplacePolicyCheck.ts` to expose a shared `estimateUpperBoundTokens(model, body)` (input-chars/4 + `max_tokens||1024`); cost helper reuses it so pack + cost estimates agree.
- [x] 3.2 In `marketplacePolicyCheck`, BEFORE the plan-less gate and plan-bound logic, when `model` present and `tokenGrantService` injected: `findUsable` → `reserve(estTokens)`; on ok set `request.tokenPack = {id, grantId, baseModel}` and return (allow); on `{ok:false}` (oversized) fall through. Declare `request.tokenPack` in the fastify module augmentation alongside `planReservation`/`payg`.
- [x] 3.3 Inject `tokenGrantService?` into `MarketplacePolicyDeps` (optional, like `planSubscriptionService`).

## 4. Settle — tokenpack branch
- [x] 4.1 `settlementHook.ts`: derive `billTrack = request.tokenPack ? "tokenpack" : payg ? "payg" : "plan"`. On success tokenpack branch: `tokenGrantService.settle(id, actualPrompt + actualCompletion)`; set `collected = actualSellCost`; seller credit + margin via the existing COLLECTED-based derivation (zero platform margin net for non-house, full margin for house — invariant holds); `settlement_log` row `bill_track:"tokenpack"`, `plan_scope:null`.
- [x] 4.2 Failure branch: `if (request.tokenPack) tokenGrantService.release(request.tokenPack.id)`; clear `request.tokenPack`. Mirror the plan/payg cleanup.
- [x] 4.3 Inject `tokenGrantService` into `SettlementDeps`; clear `request.tokenPack` on both paths.
- [x] 4.4 `SettlementLedger.reverseSettlement`: treat `bill_track:"tokenpack"` as a no-buyer-refund row (still claws back seller credit + unwinds margin; does NOT re-credit pack tokens — documented v1 limit).

## 5. Endpoints + read surface
- [x] 5.1 `POST /provision/token-pack` (privOpts, idempotent) — body `{keyId, baseModel, tokens(int>0), pricePaidUsd(>=0), expiresAt(epoch-ms, future), idempotencyKey}`; 400 on bad body / past expiry / unknown key (404); returns the grant. `audit("provision.token_pack.grant", …)`.
- [x] 5.2 `GET /provision/token-packs?keyId=` — list a key's packs (un-expired first).
- [x] 5.3 `GET /provision/keys` — embed `tokenPacks[]` per key (`baseModel`, `tokensRemaining`, `expiresAt`).

## 6. Wiring
- [x] 6.1 `registerMarketplace` (`index.ts`): construct `TokenGrantService(deps.database)`, decorate `app.tokenGrantService`, inject into `createMarketplacePolicyCheck` deps + `createSettlementHook` deps.

## 7. Tests (run: `cd apps/gateway && rtk proxy npx vitest run --root .`)
- [x] 7.1 `tokenGrantService.test.ts`: grant idempotent (same key → one row); findUsable picks un-expired most-remaining; reserve underfunded → ok:false (no decrement); reserve/settle decrements by actual; release restores; expired skipped.
- [x] 7.2 `tokenPackEnforce.test.ts`: covered request → `request.tokenPack` set, plan/wallet untouched; oversized → falls through to plan/PAYG; expired pack → falls through.
- [x] 7.3 `tokenPackSettle.test.ts`: settle decrements pack by prompt+completion; seller credited; `settlement_log` row `bill_track:"tokenpack"`; conservation holds; failure releases reservation.
- [x] 7.4 `tokenPackE2E.test.ts` (real app, marketplace on): POST /provision/token-pack idempotent; GET /provision/token-packs; tokenPacks[] on GET /provision/keys; covered request via the registered policy check consumes the pack not the wallet.
- [x] 7.5 Database v6 migration test (token_grants exists; v5→v6 upgrade additive).

## 8. Verify + ship
- [x] 8.1 `openspec validate marketplace-token-packs --strict` clean.
- [x] 8.2 Gateway `tsc` clean; full suite green; engine→marketplace boundary test green.
- [x] 8.3 Commit `feat(marketplace): prepaid token packs (tokenpack bill track)`; `openspec archive marketplace-token-packs`.
