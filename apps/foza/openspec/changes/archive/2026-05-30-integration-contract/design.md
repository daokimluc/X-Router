## Approach

This is a **specification-only** change: capture the agreed integration architecture so later implementation (`integrate-xrouter`) and the X-Router endpoint work proceed against a shared contract. No code is written here. The design records the data-flow model, the message shapes (at a contract level), and the open questions that must be resolved before wiring.

## Architecture

```
FOZA (money ledger, identity)            X-ROUTER (routing, metering, quota)
┌────────────────────────┐               ┌────────────────────────┐
│ ledger, invoices,      │  COMMANDS →    │ AccountQuotaService    │
│ payouts, plans,        │ ─────────────▶ │ ApiKeyService          │
│ seller onboarding      │  grant quota   │ providerAccounts       │
│                        │  assign plan   │ pricing execution      │
│                        │  register      │                        │
│                        │  seller+price  │                        │
│                        │                │                        │
│ reconcile + bill +     │  ← EVENTS      │ WebhookService         │
│ payout                 │ ◀───────────── │ usage metering         │
└────────────────────────┘  usage $X,     └────────────────────────┘
                             seller credit $Y
```

## Wallet model: C (Hybrid) — chosen

```
① user tops up $50 at Foza  →  Foza ledger += $50
②                            →  COMMAND: grant quota +$50 to X-Router
③ X-Router routes request, decrements quota, blocks at 0
④ X-Router emits usage event ($0.12, user, model, seller, tokens, event_id)
⑤ Foza: dedupe by event_id → wallet -= $0.12, seller credit += $Y
⑥ periodic reconciliation: Σ granted quota  vs  Σ usage events
```

## Existing X-Router foundation (observed, not assumed)

| Contract need | X-Router today | Status |
|---------------|----------------|--------|
| Quota/balance | `AccountQuotaService` | present |
| Event channel | `WebhookService` | present |
| User API keys | `ApiKeyService` | present |
| Seller sources | `seller-supply` (SellerService, SellerListing) | designed |
| Auth | provision key (3rd dimension), Bearer | designed (`provision-webhook`) |
| Plan concept | `marketplace-plans` (free/claude/codex/pro, buckets) | designed |
| Seller credit / payout | `two-sided-settlement` (SellerEarningsLedger) + `mark-paid` | designed |
| Per-seller pricing | `seller-supply` costPrice + `lowest-cost-routing` markup | designed |

## Open questions — RESOLVED by X-Router's 7 changes

The questions below were resolved once the X-Router change set (`usd-wallet`, `hourly-spend-buckets`, `marketplace-plans`, `seller-supply`, `lowest-cost-routing`, `two-sided-settlement`, `provision-webhook`) was read in full:

1. **Event granularity** → `usage.recorded` is per-request (real-time ledger); edge events (`grant.exhausted`, `wallet.low`, `quota.blocked`, `supply.unhealthy`) are edge-triggered. Best-effort, fire-and-forget.
2. **Command transport** → REST `/provision/*` group, not a queue.
3. **Event payload** → `usage.recorded.data = { keyId, baseModel, sellerId, inputTokens, outputTokens, sellAmount, sellerCredit, platformMargin }`; envelope `{ event, timestamp, data }`.
4. **Plan modeling** → `Plan { id, name, priceUsd, modelGroups[], buckets{hourUsd,dayUsd,monthUsd}, overageEnabled, paygDailyLimitUsd? }`; per-key override of overage/payg-limit.
5. **Reconciliation** → both sides store integer micro-USD (1 = $0.000001); month bucket may overshoot slightly on in-flight requests, Foza ledger is authoritative.
6. **Command auth** → dedicated **provision key** (third dimension), NOT OAuth/admin.

## Key facts pinned from X-Router design

- **Wallet has no GET** in `/provision/*` — only `POST /provision/wallet/topup` (returns new balance). Foza holds the authoritative balance; `wallet.low` webhook signals threshold crossings.
- **Money split**: `sellAmount = baseCost×(1+markup)`, `sellerCredit = baseCost×(1−commissionPct)`, `platformMargin = sellAmount − sellerCredit`; **house** seller never credited.
- **One billing track per request**: `plan` (per-group hour/day/month bucket) or `payg` (USD wallet), decided at reserve, never both.
- **Webhook signing**: HMAC-SHA256 over the exact raw body, header `X-Provision-Signature: sha256=<hex>`.

## Trade-offs

- **Hybrid (C) vs Foza-only (A) vs X-Router-only (B)** → chose C: X-Router blocks in real time (no overspend) while Foza keeps authoritative money records. Cost: reconciliation complexity, accepted.
- **Pull usage vs push** → push. `usage.recorded` webhook feeds Foza's ledger; there is no usage GET in `/provision/*`.

## Out of scope

- Foza-side DB ledger persistence (mock store until Foza gets a database).
- Frontend auth UI (→ `frontend-auth`).

