## 1. Seller identity + lifecycle

- [x] 1.1 Create `apps/gateway/src/services/SellerService.ts`: `Seller` type, in-memory map, `register(input)→pending`, `approve(id)`, `reject(id)`, `suspend(id)`, `list(status?)`, `get(id)`.
- [x] 1.2 Seed the reserved `house` seller as `approved` on first run.
- [x] 1.3 Persistence: `toPersisted`/`load`; don't clobber `house` or admin edits on re-seed.
- [x] 1.4 Vitest `sellerService.test.ts`: register→pending, approve→approved, reject, suspend, house seeded once.

## 2. SellerListing + cost pricing

- [x] 2.1 Add `SellerListing` type + storage (in `SellerService` or a sibling) with `costPrice { inputPerM, outputPerM, cachedInputPerM? }` in USD.
- [x] 2.2 Canonical base-model list (admin-curated) + validation that a listing's `baseModel` is in it.
- [x] 2.3 `createListing` requires an `approved` seller; sets `namespacedModel = "<displayName>/<baseModel>"`; `enable/disable/delete` listing.
- [x] 2.4 `listingCostFor(baseModel) → Array<{ accountId, sellerId, costPrice }>` read model (consumed by #5).
- [x] 2.5 Vitest: listing requires approved seller; baseModel validated; `listingCostFor` returns all enabled listings incl. house.

## 3. ProviderAccount sellerId

- [x] 3.1 Replace `owner?: string` with `sellerId: string` on `ProviderAccount`; update constructors/factories.
- [x] 3.2 Persistence migration: account with no `sellerId` (or legacy `owner`) → `sellerId = "house"`.
- [x] 3.3 Vitest: load legacy account (owner only) → sellerId "house"; new account carries its sellerId.

## 4. Registry wiring (namespaced + pooled)

- [x] 4.1 On listing approve/enable: register a direct `ModelMapping` for `namespacedModel` → listing's provider account.
- [x] 4.2 Add the listing as a mapping under the pooled `baseModel`, and ensure alias `baseModel` resolves to the pooled group (reuse Phase 31 multi-mapping + alias APIs).
- [x] 4.3 On disable/delete: remove the direct mapping and pool membership.
- [x] 4.4 Vitest: approving two listings for `gpt-5.5` yields two direct names + a 2-member pool; disabling one shrinks the pool, house remains.

## 5. House bootstrap

- [x] 5.1 Admin/bootstrap path to create house listings from existing platform provider accounts with `costPrice` = platform wholesale.
- [x] 5.2 Vitest: pool for a base model always contains the house listing when present; an all-third-party-disabled pool still serves via house.

## 6. Admin endpoints + UI

- [x] 6.1 `GET /admin/v1/sellers?status=pending`, `POST /admin/v1/sellers/:id/approve|reject|suspend`, `GET/POST/PATCH/DELETE /admin/v1/listings`, canonical base-model list endpoint.
- [ ] 6.2 Dashboard: seller approval queue + listing table with cost inputs (or website-driven; admin UI fallback). EN/VI i18n.
- [x] 6.3 Endpoint tests for approval flow + listing CRUD.

## 7. Verification

- [x] 7.1 Gateway `tsc` clean (the `owner`→`sellerId` rename surfaces all call sites); dashboard tsc + build clean.
- [x] 7.2 Test suite green; expect +~18 tests.
- [x] 7.3 Manual: register a seller, approve, create `hoang/gpt-5.5` with a cost, confirm both `hoang/gpt-5.5` (direct) and `gpt-5.5` (pooled) resolve; confirm house present in pool.
- [x] 7.4 `openspec validate seller-supply --strict` passes.
