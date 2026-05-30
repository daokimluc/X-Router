## 1. Buyer-key lifecycle on provision

- [ ] 1.1 `POST /provision/key/:id/disable` + `/enable` → `ApiKeyService.setEnabled`. Audited.
- [ ] 1.2 `DELETE /provision/key/:id` → revoke (soft: disable + tombstone, retain for settlement-log reference). Audited.
- [ ] 1.3 `PATCH /provision/key/:id` accepting `{ enabled?, expiresAt? }` → `ApiKeyService.update`.
- [ ] 1.4 `GET /provision/keys?owner=` → list keys (minimal: id, owner/label, enabled, expiresAt, planId). Website scopes by owner.
- [ ] 1.5 Vitest: provision can disable→request rejected; enable→allowed; revoke→rejected; expiry set→expired key rejected; list returns provisioned keys filtered by owner; admin/client key rejected on these.

## 2. Listing re-price

- [ ] 2.1 `SellerService.updateListingCost(id, costPrice)` — mutate cost in place, keep id.
- [ ] 2.2 Extend `PATCH /admin/v1/listings/:id` to accept `costPrice` (in addition to `enabled`). Optionally expose on provision if sellers self-manage — DECISION in 2.4.
- [ ] 2.3 Confirm settlement of an in-flight request uses the reserve-time routed cost, not the new price (no retroactive change).
- [ ] 2.4 DECISION + Vitest: re-price keeps id; listingCostFor reflects new cost for new requests; in-flight unaffected.

## 3. Seller term edits

- [ ] 3.1 `SellerService.updateSeller(id, { commissionPct?, payoutRef? })`. House guarded. Commission applies to future settlements only.
- [ ] 3.2 `PATCH /admin/v1/sellers/:id`. Audited.
- [ ] 3.3 Vitest: commission change affects only subsequent credits; payoutRef updated; past settlement-log rows immutable.

## 4. Canonical base-model management

- [ ] 4.1 Wire `POST /admin/v1/canonical-models` → `addCanonicalBaseModel`. Add `SellerService.removeCanonicalBaseModel` + `DELETE /admin/v1/canonical-models/:model`.
- [ ] 4.2 Remove guard: block if an enabled listing uses the model (return 409), per design lean. 
- [ ] 4.3 Vitest: add makes a new baseModel listable; remove blocked while in use; remove allowed once no listing uses it.

## 5. Money-out admin routes (reuse money-correctness primitives)

- [ ] 5.1 `POST /admin/v1/api-keys/:id/wallet/refund` `{ usd, reason }` → `WalletService.refundUsd`. `POST .../wallet/debit` `{ usd, reason }` for corrections.
- [ ] 5.2 `POST /admin/v1/earnings/seller/:id/reverse` `{ usd, reason }` → `SellerEarningsLedger.reverse`; `.../adjust` `{ deltaUsd, reason }`.
- [ ] 5.3 `POST /admin/v1/settlements/:logId/reverse` `{ reason }` → `reverseSettlement` (idempotent).
- [ ] 5.4 Vitest (endpoint): refund increases wallet + logs; payout reverse restores unpaid; settlement reverse unwinds buyer+seller+margin once.

## 6. Markup override removal

- [ ] 6.1 Accept `null` per-model value in `PUT /admin/v1/markup` (and `/provision/markup`) → `setModelMarkup(m, null)` to delete an override.
- [ ] 6.2 Vitest: setting a per-model markup then null removes it (model falls back to default).

## 7. Verification

- [ ] 7.1 Gateway `tsc` clean.
- [ ] 7.2 Full suite green; expect +~18 tests.
- [ ] 7.3 Manual: provision disable a key (buyer cancels) → key stops; re-enable; revoke; set expiry. Admin re-price a listing; edit seller commission; add a canonical model then list a new model; refund a wallet; reverse a payout.
- [ ] 7.4 `openspec validate marketplace-lifecycle --strict` passes.

## 8. Deferred / out of scope (tracked)

- [ ] 8.1 API key ROTATION (rotate secret preserving id/plan/wallet) — does not exist anywhere; its own change (touches identity + every caller). NOT in this change.
