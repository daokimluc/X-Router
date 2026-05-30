## ADDED Requirements

### Requirement: Seller registration and approval lifecycle

The gateway SHALL maintain seller records with a status of `pending`, `approved`, or `suspended`. A newly registered seller SHALL start `pending`. Only an admin action SHALL transition a seller to `approved`, `rejected`, or `suspended`. A reserved `house` seller SHALL exist as `approved` and SHALL NOT be deletable.

#### Scenario: New seller starts pending

- **WHEN** a seller registers via the registration form
- **THEN** the seller record SHALL have status `pending` and SHALL NOT yet be eligible to create listings

#### Scenario: Admin approves a seller

- **WHEN** an admin approves a `pending` seller
- **THEN** the seller status SHALL become `approved` and the seller SHALL be eligible to create listings

#### Scenario: House seller exists and is approved

- **WHEN** the gateway starts
- **THEN** a seller with id `house` SHALL exist with status `approved`

### Requirement: Per-seller namespaced listings with cost pricing

An `approved` seller SHALL be able to create a `SellerListing` for a base model chosen from the admin-curated canonical model list, carrying a `costPrice` in USD per 1M tokens (`inputPerM`, `outputPerM`, optional `cachedInputPerM`). The listing's public name SHALL be `<sellerDisplayName>/<baseModel>`. A listing for a base model not in the canonical list SHALL be rejected.

#### Scenario: Approved seller creates a listing

- **WHEN** an approved seller `hoang` creates a listing for canonical base model `gpt-5.5` with cost `{ inputPerM: 2.40, outputPerM: 7.00 }`
- **THEN** a listing named `hoang/gpt-5.5` SHALL be created with that cost price

#### Scenario: Pending seller cannot create a listing

- **WHEN** a `pending` seller attempts to create a listing
- **THEN** the operation SHALL be rejected

#### Scenario: Non-canonical base model rejected

- **WHEN** a seller creates a listing whose `baseModel` is not in the canonical list
- **THEN** the operation SHALL be rejected

### Requirement: Listings register both a direct and a pooled mapping

Approving or enabling a listing SHALL register a direct model mapping for its namespaced name (`hoang/gpt-5.5`) AND add the listing as a candidate under the pooled base-model name (`gpt-5.5`), such that the pooled name resolves to all enabled listings for that base model. Disabling or deleting a listing SHALL remove both.

#### Scenario: Two sellers pool under one base model

- **WHEN** listings `hoang/gpt-5.5` and `cinb/gpt-5.5` are both enabled
- **THEN** `hoang/gpt-5.5` and `cinb/gpt-5.5` SHALL each resolve directly, and `gpt-5.5` SHALL resolve to a pool containing both

#### Scenario: Disabling a listing removes it from both tiers

- **WHEN** `hoang/gpt-5.5` is disabled
- **THEN** the direct name `hoang/gpt-5.5` SHALL no longer resolve and the `gpt-5.5` pool SHALL no longer include it

### Requirement: House seller bounds cost and guarantees availability

The platform SHALL run house listings whose `costPrice` equals the platform's true wholesale cost. When a base model has a house listing, its pool SHALL always include the house candidate, so the pool is non-empty as long as the house source is healthy.

#### Scenario: Pool never empties while house is healthy

- **WHEN** all third-party listings for `gpt-5.5` are disabled but the house listing remains enabled and healthy
- **THEN** the `gpt-5.5` pool SHALL still contain the house candidate

### Requirement: Provider accounts carry a seller identity

Each `ProviderAccount` SHALL carry a `sellerId`. On loading persisted state, an account lacking a `sellerId` SHALL be assigned `sellerId = "house"`.

#### Scenario: Legacy account migrates to house

- **WHEN** a persisted provider account has no `sellerId` (only the legacy `owner` field or neither)
- **THEN** after load it SHALL have `sellerId = "house"`

### Requirement: Listing cost exposed for routing

The gateway SHALL expose, per base model, the set of enabled listing candidates with their `accountId`, `sellerId`, and `costPrice`, so a routing strategy can select by cost.

#### Scenario: Cost read model lists candidates including house

- **WHEN** `gpt-5.5` has an enabled house listing at cost `$2.30/M` and a `hoang` listing at `$2.40/M`
- **THEN** the cost read model for `gpt-5.5` SHALL return both candidates with their seller ids and cost prices
