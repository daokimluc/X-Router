## 1. Money helpers

- [x] 1.1 Create `apps/gateway/src/utils/money.ts` with `usdToMicro(usd: number): number` (`Math.round(usd * 1_000_000)`) and `microToUsd(micro: number): number` (`micro / 1_000_000`).
- [x] 1.2 Vitest `money.test.ts`: round-trip `0.1`, `0.0004`, `19.9996`, `20`, `0`; assert no float drift after 1000 sequential `usdToMicro` debits summing back via `microToUsd`.

## 2. WalletService

- [x] 2.1 Create `apps/gateway/src/services/WalletService.ts` storing `Map<keyId, microUsd:number>` with:
  - `getUsd(keyId) → number` (0 if undefined)
  - `isProvisioned(keyId) → boolean`
  - `open(keyId)` → set to 0 if absent
  - `topupUsd(keyId, usd) → newBalanceUsd`
  - `debitUsd(keyId, usd) → { ok: boolean; newBalanceUsd: number }` (floored at 0; `ok:false` if insufficient)
  - `hasFundsUsd(keyId, requiredUsd) → boolean`
  - `reserveUsd({ keyId, estimateUsd }) → { ok:true; reservationId } | { ok:false; reason:"insufficient_funds"; balanceUsd }`
  - `settleUsd(reservationId, actualUsd)` (refund estimate − actual; never below 0)
  - `releaseUsd(reservationId)` (refund full estimate)
- [x] 2.2 Persistence: `setPersistCallback` + debounced 5s save, same pattern as `SpendLedgerService`. `toPersisted()` / `load()`.
- [x] 2.3 Vitest `walletService.test.ts`: topup+debit, debit floored at zero, insufficient-funds reserve, reserve→settle refunds delta, reserve→release refunds full, persistence round-trip, concurrent reserves can't overspend.

## 3. ApiKey field + persistence migration

- [x] 3.1 Add `walletMicroUsd?: number` to `InternalApiKeyRecord`; remove `balance?: number`.
- [x] 3.2 In persistence load, migrate each key: keep existing `walletMicroUsd`; else if legacy `balance` present → `walletMicroUsd` left undefined on the key but `WalletService.open(keyId)` (→ $0) and log `WARN wallet-migration`; else no wallet. Drop `balance` from the loaded record.
- [x] 3.3 Wire `WalletService` into the persisted `wallet` section of `PersistedGatewayState`; load on boot, register persist callback.
- [x] 3.4 Decorate `app.walletService` in `app.ts` (injectable via deps for tests).
- [x] 3.5 Vitest: load a state file with a legacy token `balance` → key ends with a $0 provisioned wallet and a logged warning; re-load is idempotent.

## 4. Repoint call sites (token → USD)

- [x] 4.1 Remove `hasBalance`/`deductBalance`/`topup`/`getBalance` from `ApiKeyService`. Fix every compile error.
- [x] 4.2 `enforceKeyPolicy.ts`: the balance gate (step 5) — if the key has a provisioned wallet and zero funds, behavior is **unchanged for now** (still 402) BUT gated behind `walletService.isProvisioned`; keys with no wallet skip the check (plan-only keys are handled in `marketplace-plans`). Keep the 402 `balance_exhausted` shape.
- [x] 4.3 Admin top-up endpoint: accept `amountUsd: number`, call `walletService.topupUsd`. Update zod schema + response.
- [x] 4.4 Vitest: admin top-up in USD increases `getUsd`; enforceKeyPolicy 402 when provisioned wallet is empty.

## 5. Frontend

- [x] 5.1 `TopupModal.tsx`: relabel input from tokens to **USD** (`$`), step `0.01`, min `0`; call the USD endpoint; show resulting balance as `$X.XX`.
- [x] 5.2 Wherever a key's balance is displayed (key list / detail), format as USD `$X.XXXX` and show "no wallet" when unprovisioned.
- [x] 5.3 Dashboard tsc clean + build.

## 6. Verification

- [x] 6.1 Gateway `tsc` clean (removed token methods surface all call sites).
- [x] 6.2 Full gateway test suite green (baseline 460 pass + 7 skip → expect +~12 from money/wallet tests).
- [x] 6.3 Manual: start gateway with an existing state file holding a token `balance`, confirm WARN migration log + key shows $0 wallet, top up $5 via UI, confirm `$5.0000`.
- [x] 6.4 `openspec validate usd-wallet --strict` passes.
