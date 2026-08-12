# Tasks — xrouter-seller-listing

## 1. Adapter reads + types
- [x] 1.1 `listProviderInstances()` → GET /admin/v1/provider-instances
- [x] 1.2 `listProviderAccounts()` → GET /admin/v1/accounts
- [x] 1.3 types: ProviderInstance, ProviderAccount

## 2. Create-listing action
- [x] 2.1 `createListingAction` — house branch (isAdmin → sellerId="house")
- [x] 2.2 seller branch — sellerId from session account (owner-scoped), require approved
- [x] 2.3 validate baseModel/costPrice/instance/account; typed errors

## 3. UI
- [x] 3.1 Shared `ListingEditor` (canonical + cost + instance/account dropdowns,
      accounts filtered to instance)
- [x] 3.2 Admin page: House listings section + editor (admin-gated)
- [x] 3.3 Provider page: approved-seller listings + editor (owner-scoped); register
      form otherwise
- [x] 3.4 i18n vi/en

## 4. Verify
- [x] 4.1 tsc + build + eslint clean
- [x] 4.2 House listing create → appears in /provision/listings (sellerId=house) →
      renders on /console/marketplace (verified in HTML)
- [x] 4.3 Seller listing create (approved test seller) → namespaced <seller>/<model>,
      renders on marketplace
- [x] 4.4 sellerId derived server-side (form cannot inject another seller); house
      gated by isAdmin
- [x] 4.5 Cleaned up test listings + seller
