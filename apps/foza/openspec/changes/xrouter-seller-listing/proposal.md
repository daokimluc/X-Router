## Why

The Marketplace page (`/console/marketplace`) lists models for sale (listings) and
lets buyers subscribe, but Foza had **no UI to create a listing** — the
`createListing()` adapter method (`POST /provision/listing`) was unwired. So neither
the platform nor sellers could add a model gói from within Foza.

Two distinct supply sources need this, and they have different economics
(confirmed in X-Router `settlementHook.ts`):

- **House (platform supply):** `sellerId="house"`. The gateway credits no seller —
  the **full sell amount is platform margin**. Pooled routing also sorts house at
  wholesale, so it bounds the price ceiling and the platform captures the spread.
  This is the profit-optimization path.
- **Seller supply:** a registered, approved seller lists their own model at a cost
  price; the platform takes `markup − commission` and pays the seller the rest.

## What Changes

- **Adapter reads for dropdowns:** `listProviderInstances()` (`GET
  /admin/v1/provider-instances`) and `listProviderAccounts()` (`GET
  /admin/v1/accounts`) so the form offers real provider instance/account choices.
- **`createListingAction`** (`console/provider/listing-actions.ts`) with two trust
  paths:
  - `source="house"` → `isAdmin()` gate → `sellerId="house"`.
  - `source="seller"` → `sellerId` resolved from the **session's** account mapping
    (never the form); requires the user's seller to exist and be `approved`.
  - Validates baseModel, costPrice ≥ 0, instance/account present; surfaces typed
    errors (incl. X-Router `listing_rejected`).
- **Shared `ListingEditor`** client component: canonical-model dropdown, cost
  inputs, provider instance + account dropdowns (accounts filtered to the chosen
  instance).
- **Admin page (`console/admin`):** a "House listings" section listing current
  house listings + the editor (source=house, admin-gated).
- **Provider page (`console/provider`):** when the user is an approved seller, show
  their listings + the editor (source=seller, owner-scoped); otherwise the existing
  register form.
- i18n strings (vi/en).

## Capabilities

### New Capabilities
- `xrouter-seller-listing`: Create marketplace listings from within Foza for both
  platform (house) supply — admin-gated, full-margin — and a seller's own approved
  supply — owner-scoped — with provider instance/account selection sourced live
  from X-Router.

## Impact

- **Affected code:** `adapter.ts` (+2 reads), `types.ts` (+ProviderInstance/Account),
  new `console/provider/listing-actions.ts` + `listing-editor.tsx`, edits to
  `console/admin/page.tsx` and `console/provider/page.tsx`, messages.
- **Depends on:** `xrouter-admin-console` (admin key dimension for house listings +
  the admin reads), `xrouter-tenant-scoping` (seller sellerId resolved server-side),
  `foza-persistence` (durable seller mapping). X-Router side already shipped
  (`/provision/listing`, `/admin/v1/provider-instances`, `/admin/v1/accounts`).
- **Security:** house create is `isAdmin()`-only; seller create derives sellerId
  from the session, never trusting a client-supplied sellerId. The admin key stays
  server-side.
- **Risk:** low-medium — a listing must reference a real provider account or it
  won't route; the form sources accounts live so it can only offer valid ones.
