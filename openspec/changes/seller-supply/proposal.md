## Why

The marketplace's supply side is **sellers**: people who register to provide model capacity, get approved by an admin, and become routable sources. Each approved seller becomes a namespaced listing (`hoang/gpt-5.5`, `cinb/claude-sonnet-4-6`) that maps to a base model and carries the seller's **cost price** (the wholesale USD-per-1M-token they accept). The platform also runs a **house seller** whose cost is the platform's true wholesale cost — it is always present, sets the cost ceiling, and guarantees the pool never runs dry. Sellers compete by lowering their cost beneath the house; whatever they shave goes to the platform (see `lowest-cost-routing` + `two-sided-settlement`).

Today a `ProviderAccount` has an empty `owner?: string` and no cost concept; `ModelRegistry` maps a flat `publicModel` to provider instances. This change adds the seller identity, the registration→approval lifecycle, per-listing cost pricing, and the namespaced + pooled mapping so routing and settlement can act on a two-sided market.

## What Changes

- Introduce `SellerService` (`apps/gateway/src/services/SellerService.ts`): seller records `{ id, displayName, status: pending|approved|suspended, payoutRef?, commissionPct?, createdAt }`, plus a registration queue an admin approves/rejects.
- Add `sellerId` to `ProviderAccount` (replaces the vague `owner`), plus a reserved `"house"` seller for platform-owned supply.
- Introduce `SellerListing`: `{ id, sellerId, baseModel, displayName, costPrice: { inputPerM, outputPerM, cachedInputPerM? }, namespacedModel, enabled }`. Creating a listing registers a `ModelRegistry` mapping for `seller/model` AND adds it to the pooled group for `baseModel`.
- Extend `ProviderAccount` selection context so an account/listing can expose its cost for a given base model (consumed by `lowest-cost-routing`).
- Admin endpoints: list pending sellers, approve/reject, list listings, enable/disable; create the house seller + house listings.
- **BREAKING** none for existing flows — `sellerId` defaults to `"house"` for any pre-existing provider account on migration; flat public models keep working.

## Capabilities

### New Capabilities
- `seller-supply`: Seller identity with a registration→approval lifecycle, per-seller namespaced model listings, and per-listing cost pricing, including a built-in house seller that bounds cost and guarantees availability.

### Modified Capabilities
- (none published yet — adds a `sellerId` dimension to `ProviderAccount` and registers namespaced + pooled mappings in `ModelRegistry`, both currently described only in code.)

## Impact

- New service: `apps/gateway/src/services/SellerService.ts` + `SellerListing` storage (may live in the same service).
- Modified: `ProviderAccount` type — add `sellerId: string` (migrate `owner`→`sellerId`, default `"house"`).
- Modified: `ModelRegistry` usage — listings register `seller/model` mappings and join the pooled `baseModel` group (the registry already supports multiple mappings per public model from Phase 31).
- New admin routes: seller approval queue + listing management; house-seller bootstrap.
- Persistence: sellers + listings persisted via `PersistenceService`.
- Dashboard: seller approval queue + listing table (or website-driven via `provision-webhook`; admin UI is the fallback).
- Depends on: nothing hard, but pairs with `usd-wallet` (#1) for cost units (USD). Consumed by `lowest-cost-routing` (#5) and `two-sided-settlement` (#6).
