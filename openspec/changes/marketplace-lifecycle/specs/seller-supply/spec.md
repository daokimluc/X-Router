## MODIFIED Requirements

### Requirement: Per-seller namespaced listings with cost pricing

An `approved` seller SHALL be able to create a `SellerListing` for a base model
chosen from the admin-curated canonical model list, carrying a `costPrice` in USD
per 1M tokens (`inputPerM`, `outputPerM`, optional `cachedInputPerM`). The
listing's public name SHALL be `<sellerDisplayName>/<baseModel>`. A listing for a
base model not in the canonical list SHALL be rejected. A listing's `costPrice`
SHALL be updatable in place (re-pricing) without changing the listing id; the new
price SHALL apply to subsequent requests only, leaving in-flight requests settled
at their reserve-time cost.

#### Scenario: Approved seller creates a listing

- **WHEN** an approved seller `hoang` creates a listing for canonical base model `gpt-5.5` with cost `{ inputPerM: 2.40, outputPerM: 7.00 }`
- **THEN** a listing named `hoang/gpt-5.5` SHALL be created with that cost price

#### Scenario: Listing is re-priced in place

- **WHEN** an admin updates an existing listing's `costPrice`
- **THEN** the listing SHALL keep its id and subsequent routing/settlement SHALL use the new cost, while a request already in flight SHALL settle at the cost captured when it was routed

#### Scenario: Non-canonical base model rejected

- **WHEN** a seller creates a listing whose `baseModel` is not in the canonical list
- **THEN** the operation SHALL be rejected

### Requirement: Seller terms are editable after creation

The gateway SHALL allow an admin to update a seller's `commissionPct` and
`payoutRef` after registration. A changed commission SHALL apply only to
settlements that occur after the change; previously recorded credits SHALL be
immutable. The reserved `house` seller's terms SHALL NOT be editable.

#### Scenario: Commission change applies to future settlements only

- **WHEN** an admin changes a seller's `commissionPct` from `0.08` to `0.10`
- **THEN** settlements after the change SHALL use `0.10` and prior recorded credits SHALL be unchanged

### Requirement: Canonical base-model list is manageable

The gateway SHALL allow an admin to add a base model to, and remove one from, the
canonical list. Removal SHALL be rejected while an enabled listing still uses that
base model. Adding a base model SHALL make it eligible for new listings.

#### Scenario: Add then list a new base model

- **WHEN** an admin adds a new canonical base model and an approved seller creates a listing for it
- **THEN** the listing SHALL be accepted

#### Scenario: Remove blocked while in use

- **WHEN** an admin attempts to remove a canonical base model that an enabled listing still uses
- **THEN** the removal SHALL be rejected
