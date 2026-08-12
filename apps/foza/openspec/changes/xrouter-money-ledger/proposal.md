## Why

Money is the part of the integration where a silent error is expensive. X-Router
is the source of truth for settlement, but the `usage.recorded` webhook that feeds
Foza is **best-effort** (5s timeout, failures swallowed, never blocks the buyer's
request — confirmed in `WebhookService.notifyBusiness` and stated in answers §D3/
§G1). If Foza keeps no ledger of its own, a single missed event means Foza
under-bills a buyer or under-pays a seller with no way to notice.

X-Router's recommendation (§G1) is explicit and I agree with the reasoning:
**catalog can be read live, but money must be kept as a reconciled local ledger.**
Foza does not *compute* money (X-Router does) — it records the receipts it already
receives and periodically reconciles them against X-Router's authoritative totals.

Phase 34d/34d.1 gave us the tool to do this correctly: every settlement carries a
stable **`settlementId`** (`stl_<uuid>`), now present **directly in the
`usage.recorded` webhook payload** as well as in `GET /provision/settlements` (which
replays per-record `collected / sellerCredit / platformMargin / billTrack /
settlementId / reversed`). One id ties the realtime webhook to the reconcile replay.
A second id, **`requestId`**, appears on both `/provision/usage` and
`/provision/settlements` so token detail can be joined to money detail when needed.

## What Changes

- **Reshape `ledger.ts` onto the durable tables** (`billing_ledger`,
  `payable_ledger` from `foza-persistence`), replacing the in-memory micro-USD
  store. Each `usage.recorded` writes one billing row (buyer charge) and, unless
  `sellerId="house"`, one payable row (seller credit), keyed by `settlementId`.
- **Idempotent ingest:** the webhook receiver dedupes on `settlementId`. A
  re-delivered event is a no-op; two distinct settlements with identical envelopes
  but different `settlementId` are both recorded.
- **Reconciliation job** (`src/lib/xrouter/reconcile.ts`, extended): on a schedule
  / manual trigger, replay `GET /provision/settlements?since=<last>` and upsert any
  rows Foza missed (keyed by `settlementId`, so re-running is safe). Drop
  `reversed:true` rows; exclude `house` from payable.
- **Authoritative totals for payout:** seller payout is checked against
  `GET /provision/earnings/:sellerId` (X-Router's own running total — the truth for
  *how much to pay*). Foza's `payable_ledger` provides the per-record detail; the
  earnings snapshot is the figure of record. A drift between them surfaces a
  reconciliation alert rather than silently trusting Foza's sum.
- **Correct money semantics (per §G2 warnings):**
  - Bill the buyer by `actualSellCost` (the amount actually collected, after wallet
    flooring) — never recompute from price × tokens.
  - Exclude `sellerId="house"` from seller payable.
  - Treat `reversed` settlements as removed from the totals.

## Capabilities

### New Capabilities
- `xrouter-money-ledger`: A durable, idempotent buyer-billing + seller-payable
  ledger fed by `usage.recorded` and reconciled against X-Router's
  `/provision/settlements` (per-record detail) and `/provision/earnings` (payout
  total), so Foza's money records survive missed webhooks and X-Router downtime
  without drifting from the source of truth.

## Impact

- **Affected code:** `src/lib/xrouter/ledger.ts` (globalThis→tables, reshaped),
  `src/lib/xrouter/reconcile.ts` (settlements replay), webhook route (write rows by
  settlementId), and the console pages that read spend/earnings (usage, earnings,
  wallet, dashboard) — they read from the tables instead of the in-memory ledger.
- **Depends on:** `foza-persistence` (the `billing_ledger`/`payable_ledger`/
  `webhook_events` tables) and benefits from `GET /provision/settlements` (Phase
  34d, already shipped + verified in X-Router code).
- **Money correctness:** this change is the reason `foza-persistence` chose SQLite
  (atomic writes for concurrent `usage.recorded`). The pairing is deliberate.
- **Risk:** medium-high (it's money). Mitigated by: idempotency by `settlementId`,
  reconcile job that is safe to re-run, and treating X-Router's earnings snapshot
  as the payout figure of record (Foza never invents a number).
- **Out of scope:** actually paying sellers (off-platform VND transfer +
  `POST /provision/earnings/:id/mark-paid`) — that's an operator action, here we
  only keep the books that tell the operator what is owed.
