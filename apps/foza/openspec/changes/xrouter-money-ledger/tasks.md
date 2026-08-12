# Tasks — xrouter-money-ledger

## 1. Ledger on durable tables
- [x] 1.1 Reshape `ledger.ts` to read/write `billing_ledger` + `payable_ledger`
      (foza-persistence) instead of globalThis micro-USD maps
- [x] 1.2 `recordUsage(data)` — insert billing row (buyerKeyId, actualSellCost,
      billTrack, tokens) keyed by settlementId; if sellerId≠"house" insert payable
      row (sellerCredit) keyed by settlementId; both insert-if-absent
- [x] 1.3 Summary reads (per key spend, per seller payable, platform) = SQL sums
      over the tables, excluding `reversed` rows

## 2. Idempotent webhook ingest
- [x] 2.1 Webhook route: dedupe by `settlementId` (now in the usage.recorded
      payload, Phase 34d.1) via webhook_events, then call recordUsage; re-delivery
      = no-op
- [x] 2.2 Store `requestId` on ledger rows (join key to /provision/usage); if a
      legacy payload lacks settlementId, log a warning so it's visible

## 3. Reconciliation
- [x] 3.1 `reconcile.ts` — replay `GET /provision/settlements?since=<last>`,
      upsert missed rows by settlementId (safe to re-run), drop `reversed:true`,
      exclude `house` from payable; record `lastReconciledAt`
- [x] 3.2 Payout check: compare Foza `payable_ledger` sum vs
      `GET /provision/earnings/:sellerId`; on drift, surface an alert (earnings
      snapshot is the figure of record, not Foza's sum)
- [x] 3.3 Expose reconcile via the existing `/api/xrouter/reconcile` route (manual
      trigger) + note where a scheduled trigger would hook in

## 4. Correct money semantics
- [x] 4.1 Bill buyer by `actualSellCost` (collected), never price×tokens
- [x] 4.2 Exclude `sellerId="house"` from payable
- [x] 4.3 Reversed settlements removed from totals

## 5. Console reads from tables
- [x] 5.1 usage / earnings / wallet / dashboard pages read spend+payable from the
      tables (force-dynamic where needed)

## 6. Verify
- [x] 6.1 `npx tsc --noEmit` + `npm run build` pass
- [x] 6.2 Signed `usage.recorded` → billing+payable rows written; duplicate
      settlementId → no double-count; bad signature → 401 (unchanged)
- [x] 6.3 Miss-then-reconcile: drop an event, run reconcile → row appears, totals
      match; re-run reconcile → no change (idempotent)
- [x] 6.4 `reversed` settlement excluded from both ledgers
- [x] 6.5 Payout drift alert fires when Foza sum ≠ earnings snapshot
