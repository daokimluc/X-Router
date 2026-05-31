# provision-api Specification

## Purpose
TBD - created by archiving change provision-webhook. Update Purpose after archive.
## Requirements
### Requirement: Provision API key is a distinct auth dimension

The gateway SHALL authenticate `/provision/*` requests against a dedicated set of provision API keys, separate from admin API keys and client API keys. A provision key SHALL NOT be accepted on admin or client routes, and an admin or client key SHALL NOT be accepted on `/provision/*` routes. A request to `/provision/*` without a valid provision key SHALL be rejected HTTP 401 `invalid_provision_api_key`.

#### Scenario: Valid provision key is accepted

- **WHEN** a request to a `/provision/*` endpoint presents a `Bearer` token present in the configured provision API keys
- **THEN** the request SHALL be authorized

#### Scenario: Admin key is rejected on provision routes

- **WHEN** a request to a `/provision/*` endpoint presents a valid admin API key but no provision key
- **THEN** the request SHALL be rejected HTTP 401 `invalid_provision_api_key`

#### Scenario: Provision key is rejected on admin routes

- **WHEN** a request to an `/admin/*` endpoint presents a valid provision API key but no admin key
- **THEN** the request SHALL be rejected HTTP 401

### Requirement: Seller lifecycle provisioning

The gateway SHALL expose provision endpoints to register a seller, approve a pending seller, and suspend a seller, each delegating to the seller service. Registering a seller SHALL create it in a `pending` state; approving SHALL make its supply routable; suspending SHALL remove its supply from routing without deleting its earnings.

#### Scenario: Register then approve a seller

- **WHEN** the website calls `POST /provision/seller` followed by `POST /provision/seller/:id/approve`
- **THEN** the seller SHALL transition from `pending` to `approved` and its listings SHALL become eligible for routing

#### Scenario: Suspend removes supply but keeps earnings

- **WHEN** the website calls `POST /provision/seller/:id/suspend` for an approved seller with accrued earnings
- **THEN** the seller's listings SHALL no longer be routed and the seller's earnings ledger SHALL be unchanged

### Requirement: Listing lifecycle provisioning

The gateway SHALL expose provision endpoints to create, update, and delete a seller listing, each delegating to the seller service. A listing SHALL carry a wholesale `costPrice`; the sell price SHALL remain derived by the pricing service and SHALL NOT be set through these endpoints.

#### Scenario: Create a listing with a cost price

- **WHEN** the website calls `POST /provision/listing` with `sellerId`, `baseModel`, `costPrice`, and a provider account
- **THEN** the listing SHALL be created with the given cost and become eligible for lowest-cost routing once the seller is approved

#### Scenario: Update a listing cost

- **WHEN** the website calls `PATCH /provision/listing/:id` with a new `costPrice`
- **THEN** the listing's cost SHALL be updated and subsequent sell prices SHALL reflect the new cost

### Requirement: Plan grant provisioning

The gateway SHALL expose `POST /provision/grant` to assign a plan to a client key, setting the plan id, optional bucket overrides, overage flag, and PAYG daily limit, delegating to the plan service. The grant SHALL be idempotent: re-granting the same plan to the same key SHALL return the current grant unchanged.

#### Scenario: Grant a plan to a key

- **WHEN** the website calls `POST /provision/grant` with a `keyId` and `planId`
- **THEN** the key SHALL be bound to that plan with its buckets and the response SHALL reflect the active grant

#### Scenario: Re-granting the same plan is a no-op

- **WHEN** the website calls `POST /provision/grant` with a `keyId` and `planId` already in effect for that key
- **THEN** the existing grant SHALL be returned unchanged and no bucket SHALL be reset

### Requirement: Wallet top-up provisioning

The gateway SHALL expose `POST /provision/wallet/topup` to credit a client key's USD wallet by a specified amount, delegating to the wallet service, and SHALL return the resulting balance. This endpoint is the website's signal that an off-platform (e.g. VND/QR) payment has been confirmed.

#### Scenario: Top up increases the wallet balance

- **WHEN** the website calls `POST /provision/wallet/topup` with a `keyId` and a USD amount after confirming a payment
- **THEN** the key's wallet balance SHALL increase by that amount and the new balance SHALL be returned

### Requirement: Key creation provisioning

The gateway SHALL expose `POST /provision/key` to create a client API key for a buyer, delegating to the key service, optionally binding a plan at creation. The plaintext key SHALL be returned exactly once in the creation response.

#### Scenario: Create a key and return it once

- **WHEN** the website calls `POST /provision/key`
- **THEN** a new client key SHALL be created and its plaintext value SHALL be returned in that response only

### Requirement: Markup provisioning

The gateway SHALL expose `PUT /provision/markup` to set the global default markup and/or per-base-model markup overrides, delegating to the pricing service. Sell prices SHALL continue to be computed as `cost × (1 + markup)` using the effective markup.

#### Scenario: Set a per-model markup

- **WHEN** the website calls `PUT /provision/markup` with a per-base-model markup
- **THEN** subsequent sell prices for that base model SHALL use the new markup while other models use the global default

### Requirement: Payout marking provisioning

The gateway SHALL expose `POST /provision/earnings/:sellerId/mark-paid` to record
that a seller payout has been settled off-platform, delegating to the seller
earnings ledger, reducing the seller's `unpaid` balance and returning the updated
snapshot. The endpoint SHALL accept the payout amount and SHALL persist the
optional `payoutRef` on the recorded payout (it SHALL NOT be silently dropped).
The amount field SHALL accept the canonical name `usd`; the legacy `amountUsd`
name MAY also be accepted during deprecation.

#### Scenario: Mark a payout paid reduces unpaid and persists the reference

- **WHEN** the website calls mark-paid with an amount equal to the seller's `unpaid` and a `payoutRef`
- **THEN** the seller's `unpaid` SHALL become zero, lifetime earnings SHALL be unchanged, and the `payoutRef` SHALL be persisted on the payout record

#### Scenario: Privileged provision routes are rate-limited

- **WHEN** mark-paid (a privileged route) is called past the configured rate cap
- **THEN** further calls SHALL be rejected HTTP 429 until the window resets

