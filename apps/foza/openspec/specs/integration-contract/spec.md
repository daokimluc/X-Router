# integration-contract Specification

## Purpose
TBD - created by archiving change integration-contract. Update Purpose after archive.
## Requirements
### Requirement: System-of-record boundaries

Each system SHALL be the single source of truth for a defined set of state; the other treats it as read-only / eventually-consistent.

#### Scenario: Foza owns money, identity, payouts
- **WHEN** a dispute concerns buyer/seller identity, the real-money (VND) ledger, top-up payments, invoices, or seller payout settlement
- **THEN** Foza's records SHALL be authoritative

#### Scenario: X-Router owns routing, metering, USD settlement
- **WHEN** a dispute concerns which seller served a request, token counts, the routed cost, the USD sell amount, the seller credit, or plan/quota enforcement
- **THEN** X-Router's records SHALL be authoritative

#### Scenario: X-Router speaks USD and IDs only
- **WHEN** X-Router refers to a buyer, seller, or plan
- **THEN** it SHALL use opaque IDs and USD amounts; buyer/seller identity, plan-catalog UI, VND/QR payment, FX, and payout banking SHALL be Foza-side only

### Requirement: USD wallet, Foza-funded

The buyer wallet SHALL be denominated in USD inside X-Router (integer micro-USD) but funded by Foza after off-platform payment. X-Router SHALL expose top-up only — not a balance read.

#### Scenario: Top-up after confirmed payment
- **WHEN** Foza confirms an off-platform (VND/QR) payment
- **THEN** Foza SHALL call `POST /provision/wallet/topup` with `keyId` and a USD amount, and X-Router SHALL increase that key's wallet and return the new balance

#### Scenario: Wallet states
- **WHEN** a key's wallet is `undefined` (no wallet), `0` (provisioned, empty), or `> 0`
- **THEN** PAYG/overage SHALL be unavailable, available-but-unfunded (402), or spendable respectively

#### Scenario: Foza holds the real-money ledger
- **WHEN** Foza needs a buyer's authoritative money position for invoicing
- **THEN** Foza SHALL use its own ledger (fed by webhook events), NOT a balance read from X-Router, since `/provision/*` exposes no wallet GET

### Requirement: Commands — Foza to X-Router via /provision/*

Foza SHALL drive X-Router through the `/provision/*` command surface, authenticated by a dedicated **provision API key** (a third auth dimension, separate from admin and client keys).

#### Scenario: Provision auth isolation
- **WHEN** Foza calls any `/provision/*` endpoint
- **THEN** it SHALL present the provision key as `Bearer`; an admin or client key SHALL be rejected, and the provision key SHALL be rejected on `/admin/*` and `/v1/*`

#### Scenario: Create buyer key
- **WHEN** Foza provisions a buyer
- **THEN** it SHALL call `POST /provision/key` (optionally binding a plan), and the plaintext key SHALL be returned exactly once

#### Scenario: Grant a plan
- **WHEN** a buyer activates or changes a plan
- **THEN** Foza SHALL call `POST /provision/grant` with `keyId`, `planId`, and optional `overageEnabled` / `paygDailyLimitUsd` overrides; re-granting the same plan SHALL be an idempotent no-op

#### Scenario: Seller lifecycle
- **WHEN** a seller registers and is approved on the website
- **THEN** Foza SHALL call `POST /provision/seller` then `POST /provision/seller/:id/approve`; suspension via `POST /provision/seller/:id/suspend` SHALL remove supply but preserve accrued earnings

#### Scenario: Seller listing with cost price
- **WHEN** an approved seller lists a model
- **THEN** Foza SHALL call `POST /provision/listing` (or `PATCH /provision/listing/:id`) carrying the wholesale `costPrice`; the sell price SHALL remain derived by X-Router's pricing service and SHALL NOT be set by Foza

#### Scenario: Set markup
- **WHEN** the platform changes its margin
- **THEN** Foza SHALL call `PUT /provision/markup` (global default and/or per-base-model); sell price stays `cost × (1 + markup)`

#### Scenario: Mark payout paid
- **WHEN** Foza settles a seller payout off-platform
- **THEN** it SHALL call `POST /provision/earnings/:sellerId/mark-paid`, reducing the seller's `unpaid` while lifetime earnings are unchanged

### Requirement: Events — X-Router to Foza via signed webhooks

X-Router SHALL push business events to a Foza webhook target as a JSON envelope `{ event, timestamp, data }`, signed with HMAC-SHA256.

#### Scenario: Signature verification
- **WHEN** Foza receives a webhook
- **THEN** it SHALL verify header `X-Provision-Signature: sha256=<hex>` equals the HMAC-SHA256 of the exact raw body under the shared secret, and reject otherwise

#### Scenario: usage.recorded payload
- **WHEN** a billable request settles
- **THEN** X-Router SHALL emit `usage.recorded` whose `data` carries `{ keyId (buyer), baseModel, sellerId, inputTokens, outputTokens, sellAmount, sellerCredit, platformMargin }`, and Foza SHALL debit the buyer ledger and accrue seller credit from it

#### Scenario: Edge events
- **WHEN** a plan month budget exhausts, a wallet crosses its low-water threshold, a request is blocked with no boost/overage escape, or a seller's supply becomes unhealthy
- **THEN** X-Router SHALL emit `grant.exhausted`, `wallet.low`, `quota.blocked`, or `supply.unhealthy` respectively, and Foza MAY notify/invoice accordingly

#### Scenario: Best-effort delivery
- **WHEN** Foza is unreachable during an event
- **THEN** X-Router SHALL NOT block the originating request (fire-and-forget); Foza SHALL be able to reconcile via reporting rather than rely solely on push

### Requirement: Settlement math is X-Router's

The USD money split SHALL be computed by X-Router; Foza records the result.

#### Scenario: Split formula
- **WHEN** a request settles via seller S with commission `c` and markup `m`
- **THEN** `sellAmount = baseCost × (1 + m)`, `sellerCredit = baseCost × (1 − c)`, `platformMargin = sellAmount − sellerCredit`; for the **house** seller no external credit is made (effective commission 1.0, `platformMargin = sellAmount`)

#### Scenario: Single billing track
- **WHEN** a request is metered
- **THEN** it SHALL be billed entirely on one track — `plan` (against the key's per-group hour/day/month bucket) OR `payg` (against the USD wallet) — never split across both

### Requirement: Idempotency and reconciliation

Foza SHALL process events safely and detect drift.

#### Scenario: Duplicate event ignored
- **WHEN** Foza receives an event it has already processed
- **THEN** it SHALL acknowledge without double-debiting or double-crediting

#### Scenario: Micro-USD alignment
- **WHEN** Foza stores money fed by X-Router events
- **THEN** it SHALL use the same integer micro-USD unit (1 = $0.000001) so totals reconcile without float drift

#### Scenario: No source code coupling
- **WHEN** Foza is built or deployed
- **THEN** it SHALL require only X-Router's configured URL + provision key + webhook secret, NOT X-Router's source code present in the same repo or folder

