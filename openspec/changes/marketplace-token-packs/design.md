## Context

Billing has two tracks: `plan` (monthly subscription + per-group USD buckets) and `payg`
(per-request wallet debit). A **token pack** is a third shape — a finite, prepaid,
per-model token balance that is consumed by requests with no per-request buyer charge.
The buyer pays Foza once; Foza then calls x-router to issue the grant. x-router meters
consumption and credits the serving seller, but never debits the buyer for a pack.

The enforce → settle pipeline already supports hold-and-settle reservations stashed on
the request (`planReservation`, `payg`, engine `spendReservation`). Packs add a parallel
`tokenPack` reservation and a `tokenpack` settlement branch. All money state lives in the
same SQLite Database (`wallets`, `seller_earnings`, `settlement_log`); packs add a
`token_grants` table at schema v6.

## Goals / Non-Goals

Goals:
- A finite, per-(key, baseModel) prepaid token balance with explicit expiry.
- Idempotent issuance (Foza retries must not double-credit).
- Consumed ahead of plan + wallet; never touches buyer money at settle.
- Seller still credited normally; books still conserve.

Non-Goals (v1):
- Splitting one request across pack + another track (decision #3 = no split).
- Refunding an unused/expired pack (Foza owns refunds).
- A pack-management dashboard UI.
- Cross-model packs (a pack is bound to one `baseModel`).

## Decisions

### D1 — `token_grants` table (Database v6)

```sql
CREATE TABLE token_grants (
  id TEXT PRIMARY KEY,
  key_id TEXT NOT NULL,
  base_model TEXT NOT NULL,
  tokens_total INTEGER NOT NULL,
  tokens_remaining INTEGER NOT NULL,
  price_paid_micro INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL,           -- epoch-ms, from Foza
  created_at INTEGER NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE
);
CREATE INDEX idx_token_grants_lookup ON token_grants (key_id, base_model);
```

`tokens_remaining` is the live balance. `price_paid_micro` is audit-only (x-router never
uses it to charge). `idempotency_key UNIQUE` makes a retried grant a no-op.

> **Reservation model.** Unlike the wallet (which moves reserved funds into a separate
> `wallet_reservations` row), a pack reservation is held **in memory** in the
> `TokenGrantService` (a `Map<reservationId, {grantId, estTokens}>`) and the row's
> `tokens_remaining` is decremented by the estimate at reserve, then corrected by
> `(estimate − actual)` at settle. This mirrors `SpendLedgerService` (a usage counter, not
> real money). A crash between reserve and settle over-counts a pack by at most one
> in-flight request's estimate — acceptable for a metering counter, and a boot sweep is
> unnecessary because there is no real money locked (the buyer already paid). Documented
> as a deliberate simplification vs. the wallet's persisted reservations.

### D2 — `TokenGrantService` (SQLite-transactional)

```
grant({ keyId, baseModel, tokens, pricePaidUsd, expiresAt, idempotencyKey }): TokenGrant
  → INSERT ... ON CONFLICT(idempotency_key) DO NOTHING; return the row (new or existing).
findUsable(keyId, baseModel, now): TokenGrant | null
  → the un-expired (expires_at > now) row for (keyId, baseModel) with the most
    tokens_remaining > 0; null when none. (Most-remaining first so a request is most
    likely to fit a single pack — supports decision #3's no-split rule.)
reserve({ grantId, estTokens }): { ok, reservationId } | { ok:false }
  → tx: re-read tokens_remaining; if < estTokens → ok:false (caller falls through);
    else decrement by estTokens, stash {grantId, estTokens} in memory, return id.
settle(reservationId, actualTokens): void
  → tx: correct the grant by (estTokens − actualTokens), floored at 0; drop the hold.
release(reservationId): void
  → tx: add estTokens back; drop the hold.
listForKey(keyId, now): TokenGrant[]   (for the read surface; un-expired first)
```

`reserve` re-checks `tokens_remaining` inside the transaction so two concurrent requests
cannot both reserve the last tokens. `settle`/`release` are no-ops for an unknown id
(double-settle safe).

### D3 — Enforce: a `tokenpack` step before plan/PAYG

In `marketplacePolicyCheck`, **before** the plan-scope/bucket logic (and before the
plan-less wallet gate), when `model` is present:

```
const estTokens = estimateUpperBoundTokens(model, body)   // same basis as the cost estimate
const grant = tokenGrantService.findUsable(keyId, modelBase, now)
if (grant) {
  const r = tokenGrantService.reserve({ grantId: grant.id, estTokens })
  if (r.ok) { request.tokenPack = { id: r.reservationId, grantId: grant.id, baseModel }; return /* allow */ }
  // r.ok === false (oversized vs remaining) → fall through to plan/PAYG (decision #3)
}
```

`estimateUpperBoundTokens` reuses the existing input-char/÷4 + `max_tokens||1024` heuristic
already in `estimateUpperBoundCost` (refactor that to share a token-count helper, so the
pack reserve and the cost reserve agree on the estimate). The pack check sets
`request.tokenPack` and returns (allowing the request) — the plan/PAYG branches are
skipped entirely for a pack-covered request.

> **Interaction with the engine spend reservation (step 5).** The engine's admin
> spend-cap reservation (`request.spendReservation`) still runs — a pack covers the
> *marketplace* charge, not an admin-imposed hard cap. That is intentional: an operator
> cap is a ceiling independent of how the buyer paid.

### D4 — Settle on the `tokenpack` track

In `settlementHook`, add a branch alongside `plan`/`payg`:

```
billTrack = request.tokenPack ? "tokenpack" : payg ? "payg" : "plan"
...
if (billTrack === "tokenpack" && request.tokenPack) {
  tokenGrantService.settle(request.tokenPack.id, actualPromptTokens + actualCompletionTokens)
  collected = actualSellCost          // supply value consumed (for seller credit + books)
}
```

Seller credit is derived exactly as today: `min(actualBaseCost·(1−commission), collected)`,
house → margin. To keep the conservation invariant (`collected == sellerCredit +
platformMargin`) while taking **zero platform margin** on packs, set `collected =
sellerCredit` for a non-house seller, and `collected = actualSellCost` (all margin) for the
house seller — i.e. the existing derivation already yields conservation; the only pack
difference is that **no buyer wallet/bucket is moved**. The `settlement_log` row carries
`bill_track = "tokenpack"`, `plan_scope = null`.

> **Reversal.** `SettlementLedger.reverseSettlement` refunds the buyer via wallet (payg)
> or plan-bucket credit (plan). For `tokenpack` there is no buyer money to refund (the
> buyer paid Foza); a reversal still claws back the seller credit + unwinds margin, but
> does NOT re-credit pack tokens in v1 (a reversed pack request is rare — admin-initiated
> — and re-crediting tokens would need the original token count stored on the row). The
> reverse path treats `bill_track = "tokenpack"` like a no-buyer-refund row. Documented as
> a v1 limitation.

### D5 — Failure path

On `outcome: "failure"`, release the pack reservation (`tokenGrantService.release`),
credit nobody, clear `request.tokenPack` — symmetric with the plan/payg failure handling
already in the hook.

### D6 — `billTrack` type widening

`MarketplaceSeam` `SettlementHook` does not carry the track (it is derived in the hook),
but `request.settlement.billTrack` and `SettlementRecord.billTrack` are typed
`"plan" | "payg"`. Widen both to include `"tokenpack"`. The `settlement_log.bill_track`
column is free-text already (no migration for the value).

## Architecture / Seam impact

```
engine:
  Database.ts            +v6 migration (token_grants)         [neutral substrate]
  MarketplaceSeam.ts     SettlementRecord/settlement billTrack +"tokenpack"

marketplace:
  services/TokenGrantService.ts     grant/findUsable/reserve/settle/release/listForKey
  policy/marketplacePolicyCheck.ts  tokenpack step before plan/PAYG; +request.tokenPack
  policy/settlementHook.ts          tokenpack settle branch + failure release
  routes/provision.ts               POST /provision/token-pack, GET /provision/token-packs,
                                     tokenPacks[] on GET /provision/keys
  index.ts                          construct + decorate tokenGrantService, inject into
                                     policy check + settlement hook deps
```

`request.tokenPack` is declared in the marketplace policy module (like `planReservation`/
`payg`), keeping the engine ignorant of packs. The engine→marketplace boundary holds:
the engine only gains a neutral table + a widened string-union type.

## Risks / Trade-offs

- **In-memory pack reservations** (D1): a crash mid-request over-counts a pack by one
  estimate. No real money at risk; chosen for simplicity over the wallet's persisted-row
  model. If this proves wrong we can promote to a `token_reservations` table later.
- **Estimate vs actual**: reserve holds the upper-bound estimate; settle corrects to
  actual. A request that fits the estimate but whose actual is larger could push a pack a
  hair negative — floored at 0 (`tokens_remaining = max(0, …)`), same as the wallet floor.
- **Reversal does not re-credit tokens** (D4): a v1 limitation, documented; pack reversals
  are admin-rare.
- **Zero platform margin on packs** is a product choice (Foza took the spread at sale). If
  the platform ever wants a pack margin, it would record a non-zero margin here — the
  invariant math already supports it.

## Migration

Database v6 adds `token_grants` (additive; the migration runner applies it on boot). No
data backfill — packs start empty. A gateway on v5 upgrading to v6 simply gains the table.

## Open Questions

None outstanding — Foza's 4 decisions are encoded above. Reversal-token-recredit and a
pack UI are explicitly deferred.
