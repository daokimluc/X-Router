## Why

Two gaps the website (Foza) found and verified in our code, both blocking safe
money reconciliation on their side:

1. **`POST /provision/wallet/topup` is not idempotent.** Every POST adds to the
   balance, so an ambiguous failure (the gateway commits but the response is lost
   to a 5xx/timeout) leaves the website unable to retry a SePay credit without
   risking a double-credit. Their bank received the money but the wallet credit
   sits in manual reconciliation. `/provision/token-pack` already takes an
   `idempotencyKey`; topup should match.

2. **A settlement reversal is invisible to the website.** `reverseSettlement` only
   flips `reversed=1` and unwinds money internally — it emits no webhook and does
   not change the row's `ts`. Once the website's reconcile checkpoint passes a
   settlement's original `ts`, a later reversal falls permanently outside its
   `?since=` window, so its mirrored buyer-spend / seller-payable / margin stay
   inflated until a manual fix. A seller can be paid out for usage that was clawed
   back.

## What Changes

- **Idempotent top-up.** `POST /provision/wallet/topup` (and the admin topup) accept
  an optional `idempotencyKey`. With a key, the credit happens exactly once: a
  repeat with the same key is a no-op returning the current balance + `idempotent:
  true`. Dedupe rides the existing `wallet_ledger.idempotency_key` UNIQUE index
  (added in money-hardening-2) — the whole check-credit-log is one transaction. No
  key → unchanged additive behavior.
- **Reversal webhook.** `reverseSettlement` emits a `settlement.reversed` business
  webhook after the durable commit, with `{ settlementId, buyerKeyId, sellerId,
  collected, sellerCredit, platformMargin, billTrack, reason, reversedAt }`. Added
  to `BUSINESS_EVENTS` so it's subscribable. Emitted only on a real transition (a
  re-reverse is a no-op → no duplicate emit); the website also dedupes on
  `settlementId`.
- **Reversal-time query.** `settlement_log` gains `reversed_at` (epoch-ms, Database
  v9). `GET /provision/settlements` accepts `reversedSince=<ISO>` to return rows by
  *when they were reversed* (ordered by `reversed_at`), independent of the original
  `ts`. This is the durable backstop if a webhook is missed — the website can sweep
  new reversals without an unbounded lookback. Each row now also carries
  `reversedAt`.

## Capabilities

### New Capabilities
- `marketplace-topup-reversal-webhook`: wallet top-ups are idempotent on a caller
  key, and a settlement reversal both emits a `settlement.reversed` webhook and is
  queryable by reversal time — so the website can credit SePay payments exactly once
  and keep its mirrored books in sync with refunds/clawbacks in real time (webhook)
  or by catch-up sweep (`reversedSince`).

## Impact

- Modified (engine): `services/Database.ts` (v9: `settlement_log.reversed_at` +
  index); `services/WebhookService.ts` (+`settlement.reversed` event).
- Modified (marketplace): `services/WalletService.ts` (+`topupUsdIdempotent`);
  `services/SettlementLedger.ts` (set `reversed_at`; emit webhook post-commit; query
  `reversedSince` + return `reversedAt`); `routes/provision.ts` (topup
  `idempotencyKey`; settlements `reversedSince`; `BUSINESS_EVENTS` +1);
  `routes/walletAdmin.ts` (topup `idempotencyKey`); `marketplace/index.ts`
  (`setWebhookService`).
- Behind `MARKETPLACE_ENABLED`. Additive — no breaking change to existing
  responses; new fields/params are optional.
