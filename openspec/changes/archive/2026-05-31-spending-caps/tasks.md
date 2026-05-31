## 1. Backend — Ledger service

- [x] 1.1 Create `apps/gateway/src/services/SpendLedgerService.ts` with:
  - `incrementWithEstimate(scopeKey, estimateUsd) → reservationId` (pre-flight reservation)
  - `settle(scopeKey, reservationId, actualUsd)` (post-completion adjust)
  - `release(scopeKey, reservationId)` (failed request — refund full estimate)
  - `snapshot(scopeKey) → { day, month, dayKey, monthKey }`
  - Day/month rollover via lazy reset on access.
- [x] 1.2 Persistence hooks: serialize to `PersistedGatewayState.spendLedger` (new field). Debounced save (5s).
- [x] 1.3 Vitest: rollover, hold-and-settle race, persistence round-trip.

## 2. ApiKey + Team field plumbing

- [x] 2.1 Add `dailySpendLimitUsd?: number` and `monthlySpendLimitUsd?: number` to `ApiKey` type and persistence schema.
- [x] 2.2 Same on `Team` type.
- [x] 2.3 Update create/patch zod schemas for both.
- [x] 2.4 Persistence migration check: existing keys/teams without fields default to `undefined` (unlimited).

## 3. Pre-flight enforcement

- [x] 3.1 Add `estimateUpperBoundCost(body, model, modelPricingService)` helper.
- [x] 3.2 In `enforceKeyPolicy` middleware, after existing checks: lookup effective key cap (key own or inherit team). If both null → continue.
- [x] 3.3 Compute estimate. Reserve via `spendLedger.incrementWithEstimate(...)`. If reservation returns "would exceed", respond 429 with `error.code = "spend_limit_exceeded"` and `Retry-After: <seconds_until_tomorrow_or_next_month>`.
- [x] 3.4 Stash `reservationId` on `request` context so post-handler can settle.

## 4. Post-completion settle

- [x] 4.1 In `routes/openai.ts` and `anthropic.ts` after `usageService.record(...)`: call `spendLedger.settle(scopeKey, reservationId, actualCost)`.
- [x] 4.2 On failure path: call `spendLedger.release(scopeKey, reservationId)`.
- [x] 4.3 Stream usage already produces `estimatedCost`; same flow.

## 5. Admin endpoints

- [x] 5.1 `GET /admin/v1/spend/key/:id` and `/admin/v1/spend/team/:id` per spec `spending-snapshot-api`.
- [x] 5.2 Vitest: shape, auth, missing scope returns 404.

## 6. Dashboard UI

- [x] 6.1 ApiKeyEditModal "Limits" tab: 2 numeric inputs `dailySpendLimitUsd`, `monthlySpendLimitUsd`. Empty = unlimited.
- [x] 6.2 Keys list: small badge `$X / $Y today` for keys with cap set; red bg when ≥90%.
- [x] 6.3 Team modal: same 2 fields.
- [x] 6.4 i18n EN/VI: `apikey.spend.daily`, `apikey.spend.monthly`, `apikey.spend.unlimited`, `apikey.spend.percent`.

## 7. Verification

- [x] 7.1 Gateway tsc + vitest.
- [x] 7.2 Dashboard tsc + build.
- [ ] 7.3 Manual end-to-end: create key with `dailySpendLimitUsd = 0.01`, send 1 request to expensive model, confirm 429 on the second call. Restart gateway, confirm spend persists.
- [x] 7.4 Document new fields in `apps/dashboard/src/components/FaqPanel.tsx` and update `.claude/notes.md`.
