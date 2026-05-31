## Context

`ProviderAccount` (providers/base/ProviderAccount.ts) has `owner?: string`, `priority`, `weight`, `maxConcurrency`, and runtime stats, but no notion of *who* owns it as a marketplace actor or what it *costs*. `ModelRegistry` (Phase 31) already stores **multiple** `ModelMapping`s per `publicModel` and supports aliases — exactly the structure needed for "many sellers serve one base model" plus a pooled alias.

The two-tier model decision (from discovery): buyers can call a **pooled** name (`claude-sonnet-4-6` → platform routes the cheapest seller including house) or a **direct** namespaced name (`hoang/gpt-5.5` → that seller specifically). Sellers set **cost** (wholesale), the platform sets **sell** price (cost × (1+markup)) — so a listing stores cost, not sell.

## Goals / Non-Goals

**Goals:**
- Seller identity + registration/approval lifecycle (form → pending → admin approve → approved/suspended).
- Per-seller listings namespaced as `seller/baseModel`, each with a cost price.
- A pooled mapping per base model aggregating all approved listings (+ house).
- A built-in `house` seller: platform-owned supply, cost = true wholesale, always present → cost ceiling + guaranteed availability.
- Expose each candidate's cost so `lowest-cost-routing` can sort.

**Non-Goals:**
- The routing decision itself (cheapest selection, failover) — `lowest-cost-routing` (#5).
- Crediting seller earnings / commission math / payouts — `two-sided-settlement` (#6). A listing stores `commissionPct` intent, but applying it is #6.
- The seller's own dashboard, KYC, payout banking — those are website concerns; x-router stores a `payoutRef` opaque string the website understands.
- Verifying a seller's upstream credentials actually work — health-checking is `ProviderHealthMonitor`'s job; listing creation may trigger it but doesn't reimplement it.

## Decisions

### Seller and listing shapes
```
   Seller {
     id            "seller_hoang" | "house"
     displayName   "hoang"
     status        pending | approved | suspended
     payoutRef?    opaque string the website maps to a payout account
     commissionPct?  e.g. 0.08  (platform commission on this seller's credit; applied in #6)
     createdAt
   }
   SellerListing {
     id            "listing_..."
     sellerId      "seller_hoang"
     baseModel     "gpt-5.5"            // canonical, chosen from an admin-approved list
     displayName   "hoang/gpt-5.5"
     namespacedModel "hoang/gpt-5.5"    // the direct-call public model
     costPrice     { inputPerM, outputPerM, cachedInputPerM? }   // USD per 1M tokens
     providerAccountId  "account_..."   // the credential/account that actually serves it
     enabled
   }
```

### Namespaced + pooled registration
On approving a listing, the registry gains:
- a **direct** mapping: `publicModel = "hoang/gpt-5.5"` → the listing's provider account.
- membership in the **pooled** group: the listing is one of N mappings under `publicModel = "gpt-5.5"` (Phase 31 multi-mapping). An alias `gpt-5.5` resolves to that group.

```
   approve listing hoang/gpt-5.5 ($cost_h)
        ├─ register mapping  "hoang/gpt-5.5" → acct_h          (direct tier)
        └─ add to pool       "gpt-5.5" = [house, hoang, cinb…]  (pooled tier)
```
The seller picks `baseModel` from an **admin-approved canonical list** (not free text) so the pool groups correctly — `hoang/gpt-5.5` and `cinb/gpt-5.5` must agree on `"gpt-5.5"` to pool. This canonical list is the same vocabulary `model-grouping` (#3) classifies.

### The house seller
`house` is seeded as an approved seller. House listings are created from the platform's own provider accounts with `costPrice` = the platform's true wholesale cost. Properties:
- always in every pool it has a listing for → pool never empty → `NoAvailableAccountError` avoided when at least house is healthy.
- its cost is the **ceiling**: routing never pays more than house (a third-party seller only wins by being cheaper).
- absorbs the ToS/supply risk of third-party sellers vanishing (a real risk flagged in discovery).

### `sellerId` migration on ProviderAccount
`owner?: string` → `sellerId: string`. On load, an account with no `sellerId` (or only legacy `owner`) gets `sellerId = "house"`. Existing single-tenant deployments thus become "all house supply", behavior unchanged.

### Cost exposure for routing
A small read model `listingCostFor(baseModel) → Array<{ accountId, sellerId, costPrice }>` lets `lowest-cost-routing` (#5) sort candidates. Defined here (data), consumed there (policy).

## Risks / Trade-offs

- **Risk: seller registers with a mis-typed/forked base model** → fails to pool or pools wrong. Mitigation: `baseModel` is a dropdown from the canonical list, validated on listing creation.
- **Risk (business, flagged): third-party resale of vendor subscriptions may violate vendor ToS** → seller accounts get banned, supply disappears mid-request. Mitigation (technical): house seller always backstops the pool; `lowest-cost-routing` fails over to house. Mitigation (policy): out of x-router's scope — surfaced to the admin/website.
- **Risk: fake supply farming credit** (a seller routes to a stub that returns canned output to earn credit without real inference). Mitigation: `ProviderHealthMonitor` checks; deeper anti-fraud is out of scope here, noted for a future change.
- **Trade-off: `owner`→`sellerId` rename** touches the account type. Accepted; default `"house"` keeps everything working.

## Open Questions

- Can one seller have multiple listings for the *same* base model (e.g. two accounts)? Default: yes — each is a separate candidate in the pool; the namespaced name would need disambiguation (`hoang/gpt-5.5#2`) or the second is pooled-only. Lean: pooled-only for duplicates, single namespaced per (seller, baseModel).
- Where does the canonical base-model list live — admin-curated in x-router, or pushed from the website? Default: admin-curated in x-router (it's the routing vocabulary); website mirrors it.
