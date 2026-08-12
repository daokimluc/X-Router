# Tasks — xrouter-tenant-scoping

## 1. Ownership guard
- [x] 1.1 `src/lib/xrouter/ownership.ts` — `import "server-only"`; `ForbiddenError`
      typed error
- [x] 1.2 `assertOwnsKey(keyId)` — session → buyers repo; throw if keyId ∉ user keys
- [x] 1.3 `assertOwnsSeller(sellerId)` — session → sellers repo; throw if ≠ user's
- [x] 1.4 `assertOwnsListing(listingId)` — resolve listing→sellerId via
      `GET /provision/listings`, then assertOwnsSeller(sellerId)

## 2. Apply to unscoped actions
- [x] 2.1 `marketplace/actions.ts marketSubscribeAction` — assertOwnsKey on the
      chosen keyId (skip for `__new__` which creates a key for the session user)
- [x] 2.2 `models/actions.ts toggleListingAction` — assertOwnsListing before toggle
- [x] 2.3 `models/actions.ts deleteListingAction` — assertOwnsListing before delete
- [x] 2.4 Sweep for any other action taking keyId/sellerId/listingId from formData

## 3. Keep admin actions cross-tenant
- [x] 3.1 Confirm `admin/actions.ts` keeps `isAdmin()` guard and is intentionally
      not self-scoped (operator acts across tenants)

## 4. Verify
- [x] 4.1 `npx tsc --noEmit` + `npm run build` pass
- [x] 4.2 Owner path: user toggles/deletes their OWN listing → succeeds
- [x] 4.3 Attacker path: user A passes user B's listingId/keyId in formData →
      ForbiddenError, no `/provision/*` call made
- [x] 4.4 `__new__` subscribe path still works (creates key for session user)
