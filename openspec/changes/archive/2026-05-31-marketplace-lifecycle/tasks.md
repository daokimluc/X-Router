## 1. Buyer-key lifecycle on provision

- [x] 1.1 `POST /provision/key/:id/disable` + `/enable` → `ApiKeyService.setEnabled`. Audited.
- [x] 1.2 `DELETE /provision/key/:id` → revoke (soft: setEnabled(false), retained for settlement-log reference). Audited.
- [x] 1.3 `PATCH /provision/key/:id` accepting `{ enabled?, expiresAt? }` (null clears expiry) → `ApiKeyService.update`.
- [x] 1.4 `GET /provision/keys?owner=` → list (id, owner, enabled, expiresAt, planId). Uses `list()` (key-stripped). Website scopes by owner.
- [x] 1.5 Vitest: provision disable→request rejected; enable→allowed; revoke→rejected; past-expiry→rejected; list filtered by owner; admin key rejected on provision routes.

## 2. Listing re-price

- [x] 2.1 `SellerService.updateListingCost(id, costPrice)` — mutates cost in place, keeps id (+ model-registry mapping, which is cost-independent).
- [x] 2.2 `PATCH /admin/v1/listings/:id` now accepts `costPrice` and/or `enabled`. Re-price audited as listing.reprice.
- [x] 2.3 In-flight unaffected: settlement uses `request.routed` cost captured at lease time (lowest-cost-routing-wiring); only new requests see the new price.
- [x] 2.4 DECISION: re-price stays ADMIN (not provision) — it changes seller economics. Vitest: re-price keeps id + reflects new cost.

## 3. Seller term edits

- [x] 3.1 `SellerService.updateSeller(id, { commissionPct?, payoutRef? })`. House guarded (returns null). Commission applies to future settlements (past credits in the log are immutable).
- [x] 3.2 `PATCH /admin/v1/sellers/:id`. Audited.
- [x] 3.3 Vitest: commission + payoutRef updated; house edit → 404. (Future-only semantics: settlement reads `getSeller().commissionPct` live at settle time — past settlement_log rows untouched.)

## 4. Canonical base-model management

- [x] 4.1 `POST /admin/v1/canonical-models` → `addCanonicalBaseModel`; `DELETE /admin/v1/canonical-models/:model` → new `removeCanonicalBaseModel`.
- [x] 4.2 Remove guard: 409 if an ENABLED listing uses the model; 404 if not found.
- [x] 4.3 Vitest: add → listable; remove blocked while in use (409); remove allowed once the listing is disabled.

## 5. Money-out admin routes (reuse money-correctness primitives)

- [x] 5.1 `POST /admin/v1/api-keys/:id/wallet/refund` `{ usd, reason }` → `refundUsd`; `POST .../wallet/debit` `{ usd, reason }` → `debitUsd`. Both sync the persisted key snapshot + audit.
- [x] 5.2 `POST /admin/v1/earnings/seller/:id/reverse` `{ usd, reason }` → `reversePayout`; `.../adjust` `{ deltaUsd, reason }` → `adjust`.
- [x] 5.3 `POST /admin/v1/settlements/:logId/reverse` `{ reason }` → `reverseSettlement` (idempotent; 409 if not found/already reversed).
- [x] 5.4 Vitest (endpoint): refund increases wallet (+ provision key rejected 401); debit floors; payout reverse restores unpaid.

## 6. Markup override removal

- [x] 6.1 `PUT /admin/v1/markup` perModel value now nullable → `setModelMarkup(m, null)` deletes the override. (provision/markup left number-only — admin owns deletion.)
- [x] 6.2 Vitest: set per-model markup then null removes it (falls back to default).

## 7. Verification

- [x] 7.1 Gateway `tsc` clean.
- [x] 7.2 Full suite green — **614 pass + 7 skip** (was 603); +11 marketplaceLifecycle tests.
- [ ] 7.3 Manual exercise (user).
- [x] 7.4 `openspec validate marketplace-lifecycle --strict` passes.

## 8. Deferred / out of scope (tracked)

- [ ] 8.1 API key ROTATION — still its own future change. NOT in this change.
