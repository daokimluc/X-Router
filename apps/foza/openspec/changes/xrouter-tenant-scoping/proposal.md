## Why

X-Router performs **no tenant isolation** — confirmed in code (`provisionAuth.ts`)
and stated explicitly by the X-Router team (answers §G2.1): it does not know what a
"user" is and will act on **any** `keyId`/`sellerId`/`listingId` passed to a
`/provision/*` call. The website is the trust boundary; Foza MUST verify every
resource id belongs to the logged-in user *before* calling X-Router.

Foza does not do this consistently today. Audit of the server actions:

| Action | Resource id source | Scoped to user? |
|---|---|---|
| `wallet/confirmTopupAction` | `ensureUserKey()` (session) | ✅ safe |
| `provider/registerSellerAction` | `session.email` | ✅ safe |
| `keys/createKeyAction` | `session.email` | ✅ safe |
| `marketplace/marketSubscribeAction` | `keyId` from **formData** | ❌ unchecked |
| `models/toggleListingAction` | `id` from **formData** | ❌ unchecked |
| `models/deleteListingAction` | `id` from **formData** | ❌ unchecked |

A logged-in user can edit the hidden form field and pass a `keyId` or `listingId`
they don't own; Foza forwards it to X-Router with the god-mode provision key, which
executes it. That lets one user disable/delete another seller's listing or attach a
model to someone else's key. This is the most serious security gap in the
integration, and it is exactly the failure mode X-Router warned about.

## What Changes

- **Add an ownership-guard layer** (`src/lib/xrouter/ownership.ts`) that resolves
  the logged-in user (via `getServerSession`) and asserts a given
  `keyId`/`sellerId`/`listingId` belongs to them, using the durable `buyers`/
  `sellers` mappings from `foza-persistence`. Throws a typed `ForbiddenError`
  otherwise.
- **Route every provision *write* that takes a client-supplied id through the
  guard** before it reaches the adapter:
  - `marketSubscribeAction` — assert the chosen `keyId` ∈ this user's keys.
  - `toggleListingAction` / `deleteListingAction` — assert the `listingId` belongs
    to a listing under this user's `sellerId` (resolve listing→sellerId, then
    sellerId→user).
  - Any future action taking a `keyId`/`sellerId`/`listingId` from the request.
- **Listing ownership resolution:** a listing's `sellerId` is read live from
  X-Router (`GET /provision/listings`) and matched against the user's `sellerId`
  mapping — Foza does not need to store listings, only the seller mapping.
- **Admin-gated actions keep their `isAdmin()` guard** (those legitimately act
  across all tenants); this change is about *end-user* actions that must be
  self-scoped.

## Capabilities

### New Capabilities
- `xrouter-tenant-scoping`: An ownership-guard layer that asserts every
  client-supplied `keyId`/`sellerId`/`listingId` belongs to the authenticated user
  before any `/provision/*` write, closing the cross-tenant manipulation gap that
  X-Router's no-isolation design pushes onto the website.

## Impact

- **Affected code:** new `src/lib/xrouter/ownership.ts`; edits to
  `marketplace/actions.ts`, `models/actions.ts`, and any action taking an id from
  `formData`. Reads the `buyers`/`sellers` repos from `foza-persistence`.
- **Depends on:** `foza-persistence` (the durable `user→keyId/sellerId` mapping the
  guard checks against — an in-memory mapping that resets would make the guard
  unreliable).
- **Risk:** medium — a too-strict guard could block legitimate actions; mitigated
  by tests covering both "owner allowed" and "non-owner rejected" per action.
- **Security:** this is a security fix. After it, no `/provision/*` write executes
  on a resource the caller doesn't own. Admin actions remain `isAdmin()`-gated and
  intentionally cross-tenant.
