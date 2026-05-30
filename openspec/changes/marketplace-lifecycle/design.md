## Context

`ApiKeyService` already supports `setEnabled`, `delete`, `update` (incl.
`expiresAt`), `bulkDelete` — but only the engine `/admin/*` routes expose them;
provision has only create + grant. `SellerService` has `createListing`,
`setListingEnabled`, `deleteListing` but NO `updateListingCost`, and no
`updateSeller`; `addCanonicalBaseModel` exists but is wired to no route, and
there's no remove. `MarketPricingService.setModelMarkup(m, null)` can delete an
override but both markup routes reject `null`. `money-correctness` adds
`refundUsd`, `reverse`, `reverseSettlement`.

So most of the work is exposing existing/about-to-exist service capability on the
right surface, plus a few new service methods (re-price, edit seller, remove
canonical model).

## Goals / Non-Goals

**Goals:**
- The website (provision key) can wind down a buyer key it created: disable,
  re-enable, revoke, set expiry, and list its keys — without the admin key.
- The operator (admin) can perform money-out and catalog amendments: refund,
  payout/settlement reversal, listing re-price, seller-term edits, canonical model
  management, markup override removal.
- Keep the buyer-self-service vs admin-approval split clean (see decision below).

**Non-Goals:**
- The admin UI that drives the admin operations — `admin-marketplace-ui`.
- Plan CRUD — already on admin; just confirmed/kept here (not re-implemented).
- Key rotation (rotate a secret while preserving id/plan/wallet) — flagged as a
  known absence; deferred to its own change (touches identity + every caller).
- Buyer-initiated refund requests (a buyer asking for money back) — that's website
  workflow; here we only provide the admin refund operation it escalates to.

## Decisions

### The provision/admin split, by who initiates and risk
```
   PROVISION (website automates, per buyer action)   ADMIN (human approves, money-out/catalog)
   ───────────────────────────────────────────────   ─────────────────────────────────────────
   disable / enable / revoke a buyer key             refund / debit a wallet
   set key expiry                                    reverse a payout / a settlement
   extend (re-grant)                                 re-price a listing
   list the website's keys                           edit seller commission / payoutRef
                                                     add / remove canonical base models
                                                     create / edit / delete plans (already admin)
                                                     remove a per-model markup override
```
Rule: actions triggered by routine buyer behavior and reversible/safe →
provision (must scale without a human). Actions that move money OUT, alter the
catalog/pricing, or change seller economics → admin (low frequency, need a human
+ audit). Key *disable/revoke* is on provision because a cancellation must take
effect immediately and automatically; but a *refund* (money out) is admin.

### Buyer-key lifecycle on provision
Add `POST /provision/key/:id/disable|enable`, `DELETE /provision/key/:id`, and a
`PATCH /provision/key/:id` accepting `{ enabled?, expiresAt? }`. These wrap the
existing `ApiKeyService.setEnabled/update/delete`. `GET /provision/keys?owner=`
lists keys (the website filters by the `owner`/label it set at creation). Revoke =
delete (irreversible); disable = reversible pause. The website chooses per its
cancellation/refund policy.

### Listing re-price (new service method)
`SellerService.updateListingCost(id, costPrice)` mutates the cost in place and
re-registers nothing structural (the model-registry mapping is unaffected by cost;
cost is read at routing/settle time from `listingCostFor`). Admin
`PATCH /admin/v1/listings/:id` accepts `costPrice` in addition to `enabled`.
Re-pricing keeps the listing id, so external references stay valid — unlike the
current delete+recreate workaround.

### Seller term edits (new service method)
`SellerService.updateSeller(id, { commissionPct?, payoutRef? })`. Commission
changes apply to FUTURE settlements only (past credits already recorded in the
log are immutable). Admin `PATCH /admin/v1/sellers/:id`.

### Canonical model management
Wire `addCanonicalBaseModel` and add `removeCanonicalBaseModel` (guard: refuse
remove if an enabled listing still uses it, or cascade-disable — decide in tasks).
Admin `POST` / `DELETE /admin/v1/canonical-models`. Persisted in the sellers slice
already.

### Money-out reuses money-correctness primitives
Refund/debit/reverse routes are thin wrappers over `WalletService.refundUsd`,
`SellerEarningsLedger.reverse/adjust`, and `reverseSettlement(logId)` — all of
which append audited rows. This change adds NO new money math, only the admin
routes that invoke the primitives.

## Risks / Trade-offs

- **Provision can now revoke/delete keys** → a leaked provision key can disable all
  buyers (denial), on top of its existing god-mode. Mitigation: this is additive to
  an already-total blast radius (see `provision-hardening`); revoke is less damaging
  than the existing wallet-mint. Still, audit every lifecycle call.
- **Re-pricing changes economics mid-flight.** A re-price between a request's
  reserve and settle could settle at a different cost than reserved. Mitigation:
  settlement uses `request.routed` cost captured at lease time (per
  `lowest-cost-routing-wiring`), so an in-flight request is unaffected; only new
  requests see the new price.
- **Canonical model removal could orphan listings.** Mitigation: guard or
  cascade-disable (decide in tasks); never silently break routing.
- **Commission edit semantics.** Applying to future only is the safe, auditable
  choice; retroactive recompute is explicitly out of scope.

## Open Questions

- Revoke = hard delete vs soft (disable + tombstone)? Hard delete frees the id but
  loses history linkage; soft keeps audit. Lean: `DELETE` = disable + tombstone
  (retain for the settlement log's foreign reference), with a separate purge if
  ever needed. Confirm.
- Canonical model remove: block-if-in-use vs cascade-disable listings? Lean:
  block-if-in-use (safer, forces explicit listing teardown first). Confirm.
- Should buyer-key list on provision return wallet/plan inline (fewer round-trips)
  or stay minimal (id/owner/enabled/expiresAt)? Lean: minimal + the website joins
  with existing wallet reads. Confirm.
