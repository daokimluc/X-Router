# Tasks — marketplace-topup-reversal-webhook

## 1. Topup idempotency
- [x] 1.1 `WalletService.topupUsdIdempotent(keyId, usd, idempotencyKey)` — one tx: dedupe on `wallet_ledger.idempotency_key` (UNIQUE from v8); first call credits + logs a `topup` ledger row with the key; repeat → no-op, `{ walletUsd, idempotent:true }`.
- [x] 1.2 `POST /provision/wallet/topup` + admin topup: accept optional `idempotencyKey`, route to the idempotent path when present; return `idempotent:true` on a dedup.
- [x] 1.3 Tests: same key twice → credited once + idempotent flag; no key → additive.

## 2. Reversal webhook + reversedAt (Database v9)
- [x] 2.1 `Database.ts` v9: `settlement_log.reversed_at INTEGER` + index.
- [x] 2.2 `WebhookService` event union + provision `BUSINESS_EVENTS`: `settlement.reversed`.
- [x] 2.3 `SettlementLedger.setWebhookService` + `reverseSettlement`: set `reversed_at`, capture payload in-tx, emit `settlement.reversed` AFTER commit (only on real transition), wire in index.ts.
- [x] 2.4 `SettlementLedger.query` + `GET /provision/settlements`: `reversedSince` filter (order by `reversed_at`), return `reversedAt` per row.
- [x] 2.5 Tests: reverse emits webhook once (re-reverse silent); reversedSince finds an old settlement's reversal; reversedAt populated.

## 3. Verify + ship
- [x] 3.1 tsc clean; full suite green; boundary green.
- [x] 3.2 `openspec validate --strict` clean.
- [ ] 3.3 Commit, bump v0.6.3, archive, push, publish, `npm i -g .`, answer doc for Foza, notes+memory. ⚠️ user restarts global.
