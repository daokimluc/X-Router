# xrouter-key-lifecycle

Buyer-self-service key wind-down in Foza: disable, enable, set expiry, soft-revoke,
and rotate a client key, plus enabled/expiry display and automated disable when a
plan is cancelled. Every lifecycle action is scoped to the key's owner.

## ADDED Requirements

### Requirement: Key lifecycle operations

A user SHALL manage the lifecycle of their own keys from Foza.

#### Scenario: Disable and enable
- **WHEN** a user disables a key
- **THEN** Foza SHALL call `POST /provision/key/:id/disable` and the key SHALL be
  rejected on `/v1/*`; enabling it SHALL restore access

#### Scenario: Set expiry
- **WHEN** a user (or automation) sets an expiry
- **THEN** Foza SHALL call `PATCH /provision/key/:id` with `expiresAt`

#### Scenario: Soft revoke
- **WHEN** a user revokes a key
- **THEN** Foza SHALL call `DELETE /provision/key/:id` (soft) and the key SHALL show
  `enabled:false`

### Requirement: Key rotation shows the new secret once

Rotating SHALL issue a new secret, keep the key's id/plan/wallet, and reveal the
plaintext exactly once.

#### Scenario: Rotate
- **WHEN** a user rotates a key
- **THEN** the old secret SHALL stop working immediately, the new plaintext SHALL be
  shown once, and id/plan/wallet SHALL be unchanged

### Requirement: Owner-scoped lifecycle

Lifecycle actions SHALL only affect the caller's own keys.

#### Scenario: Non-owner blocked
- **WHEN** a user attempts a lifecycle action on a keyId they do not own
- **THEN** it SHALL be rejected (ownership guard) with no `/provision/*` call

### Requirement: Key state display

The keys page SHALL show key state without per-key round-trips.

#### Scenario: Single listing call
- **WHEN** the keys page loads
- **THEN** Foza SHALL use `GET /provision/keys?owner=` (which includes `walletUsd`
  and `provisioned`) rather than an N+1 wallet call per key

#### Scenario: Revoked keys hidden
- **WHEN** the list contains keys with `enabled:false`
- **THEN** the UI SHALL hide them by default while they remain in the provision list

### Requirement: Automated wind-down on plan cancellation

Cancelling a plan SHALL wind down the associated key automatically.

#### Scenario: Cancel disables key
- **WHEN** a buyer cancels or loses their plan
- **THEN** Foza SHALL disable (or revoke) the associated key without manual operator
  action
