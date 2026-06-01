## ADDED Requirements

### Requirement: Token-pack reservations survive a crash

The gateway SHALL persist token-pack reservations durably and release any that survive a
restart back to their grant, so a crash between reserving and settling a pack does not
permanently consume buyer-paid tokens.

#### Scenario: A reserved-but-unsettled pack is restored at boot

- **WHEN** a pack reservation decrements a grant, the process restarts before the request settles, and the boot sweep runs
- **THEN** the reserved tokens SHALL be returned to the grant's remaining balance

### Requirement: Money conservation is exact per settlement row

The gateway SHALL record each settlement so that `collected == sellerCredit + platformMargin`
exactly in integer micro-USD, deriving the platform margin from the already-rounded
collected and seller-credit integers rather than rounding it independently.

#### Scenario: Sub-micro split still conserves

- **WHEN** a settlement's collected and seller-credit amounts have sub-micro fractions
- **THEN** the stored `collected_micro` SHALL equal `sellerCredit_micro + platformMargin_micro` exactly

### Requirement: A metered request is never served free

The gateway SHALL charge a non-zero cost for a metered request even when its route has no
listing and no model-price entry, using a configured non-zero fallback rate.

#### Scenario: Unlisted, unpriced route still bills

- **WHEN** a request routes to a leased account with no listing and the model has no price entry
- **THEN** the settled cost SHALL be greater than zero

### Requirement: Reversing a token-pack settlement re-credits the tokens

When a token-pack settlement is reversed, the gateway SHALL restore the consumed tokens to
the originating grant, since the buyer paid for those tokens off-platform and receives no
wallet refund.

#### Scenario: Reversed pack request returns its tokens

- **WHEN** a pack-track settlement that consumed N tokens from a grant is reversed
- **THEN** that grant's remaining balance SHALL increase by N (capped at its total)

### Requirement: Packs are consumed soonest-expiry first

The gateway SHALL select, among a key's usable packs for a model that can each cover the
request, the one expiring soonest, so near-expiry buyer-paid tokens are consumed before
they lapse.

#### Scenario: Near-expiry pack is used before a later one

- **WHEN** a key has two usable packs for a model, both able to cover the request, expiring on different dates
- **THEN** the pack expiring sooner SHALL be consumed first

### Requirement: A token-pack over-run is recorded, not served free

The gateway SHALL reserve a token estimate with safety headroom and, when the actual token
count still exceeds what the pack can absorb, SHALL record the over-delivery rather than
silently flooring the consumed amount to the remaining balance.

#### Scenario: Actual exceeds reservable balance

- **WHEN** a pack-backed request's actual tokens exceed the grant's remaining balance at settle
- **THEN** the grant SHALL floor at zero AND the over-delivered token count SHALL be recorded for audit

### Requirement: The grandfather grant is bounded to legacy keys

The gateway SHALL apply the no-charge "grandfather" period only to plan-bound keys that
predate this change. A key bound to a paid plan after the cutoff SHALL be charged on its
first renewal evaluation rather than granted a free period.

#### Scenario: A newly plan-bound key is not granted a free month

- **WHEN** a key is bound to a paid plan via key-create or admin assign-plan after the cutoff and later evaluated for renewal
- **THEN** the gateway SHALL charge the plan fee (or downgrade if underfunded), not grant a free period

### Requirement: Admin wallet refund is idempotent

The gateway SHALL accept an optional idempotency key on the admin wallet-refund operation
and SHALL credit the wallet only once for a repeated refund with the same key.

#### Scenario: Retried refund credits once

- **WHEN** the same admin wallet refund (same idempotency key) is submitted twice
- **THEN** the wallet SHALL be credited exactly once

### Requirement: Privileged money inputs are bounded

The gateway SHALL reject out-of-range privileged money inputs: a wallet top-up above a
configured maximum, a token-pack `tokens` count above a maximum, and a pack `expiresAt`
beyond a maximum horizon. `SellerService.register` SHALL clamp `commissionPct` to `[0,1]`.

#### Scenario: Over-cap top-up is rejected

- **WHEN** a top-up requests an amount above the configured maximum
- **THEN** the gateway SHALL respond HTTP 400 and SHALL NOT change the balance

#### Scenario: Out-of-range commission is clamped at registration

- **WHEN** a seller is registered with `commissionPct` outside `[0,1]`
- **THEN** the stored commission SHALL be clamped into `[0,1]`
