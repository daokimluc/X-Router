## Why

The provision surface is create-and-bind heavy but lifecycle-poor, and several
operations a real two-sided marketplace needs don't exist for ANY caller (not
even the admin key). A lifecycle audit found:

- **The website cannot stop a buyer's key.** On cancellation, refund, fraud, or
  expiry, there is no provision path to revoke/disable/expire a key — those are
  admin-only, and the `grant` schema can't even pass `enabled:false`/`expiresAt`.
  A canceled customer keeps a working key.
- **Listings cannot be re-priced.** `costPrice` is set only at creation; the only
  "re-price" is delete + recreate (new id, supply churn). No update path exists.
- **Seller commission and payoutRef are write-once.** No update method exists for
  anyone — renegotiating commission requires deleting and re-registering the seller
  (losing its id, listings, and earnings linkage).
- **Payouts are irreversible.** `markPaid` only reduces unpaid; an over-mark-paid
  or a failed bank transfer can never be corrected. (The reversal *primitive* lands
  in `money-correctness`; this change exposes it as an admin operation.)
- **No wallet refund/debit operation** is reachable (only additive topup). (Primitive
  in `money-correctness`; surfaced here.)
- **The canonical base-model vocabulary is seed/persist-only.** `addCanonicalBaseModel`
  is wired to no route; new models can't be onboarded without editing the seed and
  redeploying — and listings require a canonical base model.
- **Plan presets are admin-only** (the question that started this): the website can
  read and grant plans but not create/edit/delete them.

Per the agreed split, buyer-self-service lifecycle (revoke/disable/expire/extend a
key) belongs on **provision** (the website automates it per buyer action), while
money-out and catalog operations (refund, payout reversal, commission edits,
re-pricing, plan CRUD, canonical models, markup) stay **admin** (human approval).
This change adds the missing endpoints on the correct surfaces. The admin UI that
drives them is a separate change (`admin-marketplace-ui`).

## What Changes

**Provision surface (website, buyer-self-service):**
- `POST /provision/key/:id/disable`, `POST /provision/key/:id/enable`,
  `DELETE /provision/key/:id` — stop/resume/revoke a key the website provisioned.
- Allow `grant` (or a `PATCH /provision/key/:id`) to set `expiresAt` and `enabled`.
- `GET /provision/keys?owner=` — list keys the website provisioned (reconciliation;
  scoped by the website to the logged-in buyer).

**Admin surface (operator, money-out + catalog):**
- `POST /admin/v1/api-keys/:id/wallet/refund` — refund/credit-back (calls the
  `money-correctness` `refundUsd` primitive). `POST .../wallet/debit` for corrections.
- `POST /admin/v1/earnings/seller/:id/reverse` and `.../adjust`, and
  `POST /admin/v1/settlements/:logId/reverse` — payout reversal / settlement reversal.
- `PATCH /admin/v1/listings/:id` extended to update `costPrice` (re-price), not just
  `enabled`.
- `PATCH /admin/v1/sellers/:id` — edit `commissionPct` and `payoutRef`.
- `POST` / `DELETE /admin/v1/canonical-models` — add/remove canonical base models
  (wire the existing `addCanonicalBaseModel` + a remove).
- Allow `PUT /admin/v1/markup` to delete a per-model override (accept `null`).
- (Plan CRUD already exists on admin — confirm + keep.)

- **BREAKING** none — additive endpoints; existing routes unchanged except the
  listing PATCH and markup PUT gain optional fields.

## Capabilities

### New Capabilities
- `marketplace-lifecycle`: The endpoints to wind down and amend marketplace
  entities — revoke/disable/expire buyer keys (provision), refund wallets, reverse
  payouts and settlements, re-price listings, edit seller terms, manage the
  canonical model vocabulary, and remove markup overrides (admin).

### Modified Capabilities
- `provision-api`: gains buyer-key lifecycle operations (disable/enable/revoke/
  expire/list).
- `seller-supply`: listing cost becomes mutable (re-price); seller commission /
  payoutRef become editable; canonical model list becomes manageable.

## Impact

- Modified: `marketplace/routes/provision.ts` (key lifecycle + key list), engine
  `routes/admin.ts` reuse for key disable/enable/delete (already present — expose/
  proxy via provision with proper scoping).
- Modified: `marketplace/services/SellerService.ts` — `updateListingCost`,
  `updateSeller(commissionPct, payoutRef)`, `removeCanonicalBaseModel`; routes in
  `sellerAdmin.ts` + `markupAdmin.ts`.
- Modified: `marketplace/routes/{walletAdmin,earningsAdmin,markupAdmin}.ts` — refund/
  debit, reverse/adjust, settlement reversal, markup override delete.
- Reuses the `money-correctness` primitives (`refundUsd`, `reverse`, `reverseSettlement`).
- Depends on: `money-correctness` (refund/reversal primitives + audit log),
  `provision-webhook` (#7), `seller-supply` (#4), `marketplace-plans` (#3).
