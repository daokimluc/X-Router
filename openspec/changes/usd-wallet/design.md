## Context

`ApiKey.balance` (ApiKeyService.ts:13) is documented as "Token balance (credits)" and deducted per request via `deductBalance(keyHash, tokens)` which does `balance = max(0, balance - tokens)`. `hasBalance` returns `true` when `balance === undefined` (unlimited) or `> 0`. The admin `topup(id, amount)` and `TopupModal` add raw token units. There is no money concept anywhere in the key layer.

The marketplace needs **money**. Buyers prepay (VND → USD on the website), and overage/PAYG requests debit the *actual USD cost* per call. `ModelPricingService.calculateCost` already returns USD rounded to 6 decimals. `SpendLedgerService` already proves the hold-and-settle pattern works against persisted, debounced state. This change creates the USD wallet those later changes will debit.

## Goals / Non-Goals

**Goals:**
- A per-key prepaid balance in USD, stored as integer micro-USD to eliminate float drift.
- Topup (add USD), debit (subtract actual cost, floored at zero), funds check before a PAYG request.
- Hold-and-settle in USD so a PAYG request can reserve an upper-bound, then settle to actual cost — mirroring `SpendLedgerService` so the two compose cleanly later.
- Persist + restore across restart; migrate legacy token balances safely.

**Non-Goals:**
- Multi-currency. VND and exchange rates live on the website; x-router is USD-only.
- The PAYG decision logic (when to debit wallet vs. plan bucket) — that's `marketplace-plans` + `two-sided-settlement`.
- Seller earnings/credit ledger — that's `two-sided-settlement` (a *credit* ledger, distinct from this buyer *debit* wallet).
- Negative balances / credit lines. A wallet never goes below zero.

## Decisions

### Integer micro-USD, not floats
1 micro-USD = $0.000001. A $20 wallet = `20_000_000`. Rationale: millions of sub-cent debits (a single request can cost `$0.0004`) accumulate float error; integers don't. Conversion at the boundary only: `usd → round(usd * 1e6)`, `micro → micro / 1e6`. `ModelPricingService` rounds to 6 decimals, so `round(cost * 1e6)` is lossless.

```
   API surface (USD, human)        Storage (integer micro-USD)
   topupUsd(key, 20.00)     ───►    +20_000_000
   debitUsd(key, 0.0004)    ───►    -400
   getUsd(key) = 19.9996    ◄───    19_999_600
```

### `walletMicroUsd?: number` semantics
- `undefined` → key has **no wallet** → PAYG/overage not available for this key (it can still use plan quota). `hasFundsUsd` returns `false`.
- `0` → wallet provisioned, empty → PAYG available but no funds → request needing wallet gets 402.
- `> 0` → spendable.

This lets the website explicitly "open a wallet" (set to 0 via provision) separate from "has money".

### Hold-and-settle mirrors SpendLedgerService
`reserveUsd(keyId, estimateUsd) → { ok, reservationId } | { ok:false, reason:"insufficient_funds" }` deducts the estimate up-front (so concurrent requests can't double-spend the same dollar), `settleUsd(reservationId, actualUsd)` refunds `estimate - actual`, `releaseUsd(reservationId)` refunds the whole estimate on failure. Same shape as `SpendLedgerService.reserve/settle/release` so a PAYG request can hold against *both* the spend bucket and the wallet and roll back symmetrically.

### Migration of legacy token balance
On `PersistenceService` load, for each key:
- if `walletMicroUsd` already present → use it (idempotent on re-load).
- else if legacy `balance` (number) present → set `walletMicroUsd = 0`, drop `balance`, log `WARN wallet-migration key=<id> legacy token balance <n> dropped; re-topup in USD`.
- else → leave `walletMicroUsd` undefined (no wallet).

The token count is **not** converted — tokens have no exchange rate to USD without knowing which model they were for. Pre-launch + private distribution means no real buyer money is lost.

### Deprecating the token methods
`hasBalance`/`deductBalance`/`topup`/`getBalance` are removed from `ApiKeyService` and their call sites repointed to `WalletService` (USD). Keeping token shims would invite accidental token-unit math. The `balance` field is removed from the `ApiKey` type after migration reads it once at load.

## Risks / Trade-offs

- **Risk: a stray call site still does token math.** Mitigation: remove the token methods entirely so the compiler flags every caller (tsc clean = all migrated).
- **Risk: float at the USD boundary.** Mitigation: a single `usdToMicro`/`microToUsd` helper pair with `Math.round`, unit-tested for the awkward values (`0.1`, `0.0004`, `19.9996`).
- **Trade-off: dropping legacy balances.** Accepted — pre-launch, private, no prepaid real money. Documented in proposal as BREAKING.

## Migration

1. Ship `WalletService` + `walletMicroUsd` field + load-time migration in one change.
2. First gateway start after upgrade: each key with a legacy `balance` is migrated to a $0 wallet (WARN logged).
3. Admin re-tops-up any key that needs PAYG, now in USD via the updated `TopupModal`.
4. No data export/import needed; migration is automatic and idempotent.

## Open Questions

- Should an admin be able to set a wallet *negative* as a manual credit/debt adjustment? Current decision: no (floored at zero). Revisit if the website needs refunds that exceed current balance.
