## ADDED Requirements

### Requirement: Wallet top-up is idempotent on a caller-supplied key

`POST /provision/wallet/topup` SHALL accept an optional `idempotencyKey`. When one
is given, the gateway SHALL credit the wallet exactly once for that key: the first
call credits and records the key, and a repeated call with the same key SHALL make
no further credit and SHALL return the current balance with `idempotent: true`.
Without a key, the top-up SHALL remain additive as before.

#### Scenario: Repeated top-up with the same key credits once

- **WHEN** `POST /provision/wallet/topup` is called twice with the same `idempotencyKey` and amount
- **THEN** the wallet SHALL be credited only once and the second response SHALL include `idempotent: true`

#### Scenario: Top-up without a key is additive

- **WHEN** two top-ups are sent with no `idempotencyKey`
- **THEN** both SHALL be credited (the balance increases twice)

### Requirement: A settlement reversal emits a business webhook

When a settlement is reversed, the gateway SHALL emit a `settlement.reversed`
business webhook after the durable commit, carrying at least `settlementId`,
`buyerKeyId`, `sellerId`, `collected`, `sellerCredit`, `platformMargin`, `billTrack`,
`reason`, and `reversedAt`. A reversal that is a no-op (already reversed) SHALL NOT
emit the webhook.

#### Scenario: Reversing a settlement notifies the website

- **WHEN** a recorded settlement is reversed for the first time
- **THEN** a `settlement.reversed` webhook SHALL be emitted with the settlement's figures

#### Scenario: Re-reversing does not emit again

- **WHEN** `reverseSettlement` is called a second time for an already-reversed settlement
- **THEN** no additional `settlement.reversed` webhook SHALL be emitted

### Requirement: Settlements are queryable by reversal time

The gateway SHALL stamp a reversal with `reversedAt` (epoch-ms) and SHALL let
`GET /provision/settlements` filter by `reversedSince`, returning rows reversed at
or after that instant ordered by reversal time, independent of the original
settlement timestamp. Each returned settlement SHALL include its `reversedAt`
(null when not reversed).

#### Scenario: A reversal of an old settlement is found by reversedSince

- **WHEN** a settlement created long ago is reversed now, and the website queries `GET /provision/settlements?reversedSince=<just before now>`
- **THEN** that settlement SHALL be returned even though its original timestamp is outside the window
