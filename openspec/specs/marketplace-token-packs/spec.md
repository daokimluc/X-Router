# marketplace-token-packs Specification

## Purpose
TBD - created by archiving change marketplace-token-packs. Update Purpose after archive.
## Requirements
### Requirement: Prepaid token packs are issued idempotently

The gateway SHALL accept a privileged `POST /provision/token-pack` that issues a prepaid
token grant to a key for a specific base model, with body
`{ keyId, baseModel, tokens, pricePaidUsd, expiresAt, idempotencyKey }`. The grant SHALL
be stored durably (SQLite) with its remaining-token balance, expiry, and the
`pricePaidUsd` for audit. A repeated call with the same `idempotencyKey` SHALL return the
existing grant without issuing a second one.

#### Scenario: A token pack is granted and readable

- **WHEN** Foza calls `POST /provision/token-pack` with `{ keyId, baseModel: "gpt-5.5", tokens: 1000000, pricePaidUsd: 5, expiresAt, idempotencyKey: "ord_1" }`
- **THEN** a grant SHALL be stored with `tokensRemaining = 1000000`, and `GET /provision/token-packs?keyId=` SHALL return it

#### Scenario: A retried grant is not double-credited

- **WHEN** the same `POST /provision/token-pack` body (same `idempotencyKey`) is sent twice
- **THEN** exactly one grant SHALL exist and the second response SHALL return that same grant

### Requirement: Token packs are consumed before the plan and the wallet

The gateway SHALL consume a usable token pack before charging the plan or the wallet. For
a request whose base model has a usable pack (un-expired, with enough remaining tokens to
cover the request's estimate), the gateway SHALL reserve the estimate against the pack and
settle the request on the `tokenpack` track, charging neither the plan bucket nor the
wallet. Track precedence SHALL be **tokenpack → plan → PAYG wallet**.

#### Scenario: A covered request consumes the pack, not the wallet

- **WHEN** a key with a usable `gpt-5.5` pack makes a `gpt-5.5` request whose estimate fits within the pack
- **THEN** the request SHALL be served, the pack's `tokensRemaining` SHALL drop by the actual `promptTokens + completionTokens`, and the wallet balance and plan buckets SHALL be unchanged

#### Scenario: Pack balance is decremented by combined tokens

- **WHEN** a pack-backed request completes with `promptTokens = 300` and `completionTokens = 700`
- **THEN** the pack's `tokensRemaining` SHALL decrease by exactly `1000`

### Requirement: An oversized request does not split across the pack

The gateway SHALL NOT split a single request across the pack and another track. When a
single request's estimated token count exceeds the pack's remaining balance, the gateway
SHALL NOT partially consume the pack; the request SHALL fall through to the plan/PAYG path
with the pack left intact.

#### Scenario: Request larger than the remaining pack falls through

- **WHEN** a key's `gpt-5.5` pack has `tokensRemaining = 500` and a request estimates `5000` tokens
- **THEN** the pack SHALL NOT be reserved or decremented, and the request SHALL be evaluated against the plan/PAYG path as if no pack existed

### Requirement: Expired packs are not usable

A grant whose `expiresAt` is at or before now SHALL NOT be selected to cover a request.
An expired pack SHALL be skipped in favor of a newer usable pack, or fall through to
plan/PAYG when none is usable.

#### Scenario: Expired pack is skipped

- **WHEN** a key's only `gpt-5.5` pack has `expiresAt` in the past
- **THEN** that pack SHALL NOT be used, and the request SHALL fall through to the plan/PAYG path

### Requirement: Pack settlement credits the seller without touching buyer money

On a `tokenpack`-track settle, the gateway SHALL decrement the pack by the actual
combined tokens and SHALL credit the serving seller for the supply consumed exactly as on
other tracks (commission applied; the house seller credited as platform margin). It SHALL
record a `settlement_log` row with `bill_track = "tokenpack"` that preserves the
conservation invariant `collected == sellerCredit + platformMargin`, taking zero platform
margin on packs (the buyer paid Foza up front). On request failure it SHALL release the
pack reservation, leaving the balance unchanged.

#### Scenario: Seller is credited for pack-backed supply

- **WHEN** a pack-backed request to a non-house seller completes successfully
- **THEN** the seller SHALL be credited for the consumed supply (cost − commission) and a `settlement_log` row with `bill_track = "tokenpack"` SHALL be written

#### Scenario: Failed pack request releases the reservation

- **WHEN** a pack-backed request fails after the pack was reserved
- **THEN** the pack's reserved tokens SHALL be returned and `tokensRemaining` SHALL be unchanged from before the request

### Requirement: Token packs are exposed on the provision read surface

`GET /provision/keys` SHALL embed a `tokenPacks[]` array per key (each with `baseModel`,
`tokensRemaining`, `expiresAt`), and `GET /provision/token-packs?keyId=` SHALL list a
key's packs, so the website can render pack balances.

#### Scenario: Keys list reports pack balances

- **WHEN** the website calls `GET /provision/keys` for a key holding two packs
- **THEN** that key's entry SHALL include a `tokenPacks` array with both packs' remaining balances and expiries

