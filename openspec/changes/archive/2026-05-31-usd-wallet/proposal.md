## Why

The marketplace bills in **US dollars**: buyers prepay a wallet (topped up via VND/QR on the website), and every overage / pay-as-you-go request debits that wallet in USD at the platform sell price. But today `ApiKey.balance` is a **raw token count**, not money. `deductBalance(keyHash, tokens)` subtracts token units and `hasBalance` only checks `> 0`. There is no way to (a) hold a prepaid USD amount, (b) debit the *actual USD cost* of a request, or (c) reason about "does this key have enough money for the next call".

This is the foundation change. Plans, buckets, lowest-cost routing, and two-sided settlement all debit/credit money — none of them can be built until the wallet speaks USD. We store money as **integer micro-USD** (1 unit = $0.000001) to avoid floating-point drift across millions of small debits; `ModelPricingService` already rounds costs to 6 decimals, so micro-USD aligns exactly.

## What Changes

- Introduce `WalletService` (`apps/gateway/src/services/WalletService.ts`) as the single source of truth for per-key prepaid USD balances, stored as integer micro-USD.
- Add `walletMicroUsd?: number` to `ApiKey` (integer micro-USD). `undefined` = no wallet provisioned (PAYG disabled for that key); a provisioned wallet starts at `0`.
- `WalletService` API: `getUsd(keyId)`, `topupUsd(keyId, usd)`, `debitUsd(keyId, usd) → { ok, newBalanceUsd }`, `hasFundsUsd(keyHash, requiredUsd)`, `reserveUsd`/`settleUsd`/`releaseUsd` (hold-and-settle in USD, mirroring `SpendLedgerService` so PAYG can pre-flight against the wallet).
- **Migrate** the legacy token-based `ApiKey.balance`: on persistence load, any key with a legacy `balance` and no `walletMicroUsd` is migrated to `walletMicroUsd = 0` (the old token count is **not** convertible to USD and is dropped), and a one-line warning is logged. Admin re-tops-up in USD.
- Adapt existing call sites: the `enforceKeyPolicy` balance check and the admin top-up endpoint + `TopupModal` now operate in USD, not tokens.
- Wallet state persists through `PersistenceService` (debounced 5s), same pattern as `SpendLedgerService`.
- **BREAKING**: the meaning of "balance" changes from tokens to USD. Existing token balances are reset to a $0 USD wallet on first load after upgrade (see Migration in design.md). Acceptable because distribution is private/pre-launch and no buyer has prepaid real money yet.

## Capabilities

### New Capabilities
- `usd-wallet`: Per-key prepaid balance denominated in USD (integer micro-USD), with topup, debit (floored at zero, never negative), funds check, and hold-and-settle reservation. Survives gateway restart via persistence.

### Modified Capabilities
- (none — `openspec/specs/` is currently empty, so this change is purely additive at the spec layer. The legacy `ApiKey.balance` token semantics were never captured as a published spec.)

## Impact

- New service: `apps/gateway/src/services/WalletService.ts`.
- Modified: `apps/gateway/src/services/ApiKeyService.ts` — add `walletMicroUsd` field; deprecate `balance`/`hasBalance`/`deductBalance`/`topup`/`getBalance` token methods (kept as thin shims that delegate to USD where sensible, or removed — see design).
- Modified: `apps/gateway/src/middleware/enforceKeyPolicy.ts` — balance gate reads wallet in USD.
- Modified persistence: `PersistedGatewayState` gains a `wallet` section; load-time migration of legacy `balance`.
- Modified routes: admin top-up endpoint switches unit to USD.
- Frontend: `TopupModal.tsx` input label/units change from tokens to USD.
- No change to routing, pricing, or settlement logic yet — those land in later changes that depend on this one.
