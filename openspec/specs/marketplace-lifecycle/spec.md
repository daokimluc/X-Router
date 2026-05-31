# marketplace-lifecycle Specification

## Purpose
TBD - created by archiving change marketplace-lifecycle. Update Purpose after archive.
## Requirements
### Requirement: Buyer key lifecycle is reachable by the website

The website SHALL be able to disable, re-enable, revoke, and set the expiry of a
buyer API key it provisioned, and list the keys it provisioned, using the
provision key alone (no admin key). Disabling SHALL immediately stop the key from
serving requests; re-enabling SHALL resume it; revoking SHALL permanently stop it
while retaining it for audit reference.

#### Scenario: Website disables a canceled buyer's key

- **WHEN** a buyer cancels and the website calls disable on that buyer's key
- **THEN** subsequent requests with that key SHALL be rejected, and a later enable SHALL resume service

#### Scenario: Website revokes a key

- **WHEN** the website revokes a key
- **THEN** the key SHALL permanently stop serving and SHALL remain referenceable by past settlement records

#### Scenario: Website sets a key expiry

- **WHEN** the website sets `expiresAt` in the past for a key
- **THEN** requests with that key SHALL be rejected as expired

### Requirement: Money-out operations are admin-gated

Money-out operations SHALL be admin-gated. Refunding a wallet, debiting a wallet
for correction, reversing a seller payout, adjusting seller earnings, and
reversing a recorded settlement SHALL each be available only via the admin
surface, SHALL invoke the audited money primitives, and SHALL NOT be reachable
with the provision key.

#### Scenario: Admin refunds a wallet

- **WHEN** an admin issues a wallet refund with a reason
- **THEN** the wallet balance SHALL increase and the refund SHALL be recorded in the audit/settlement log

#### Scenario: Provision key cannot refund

- **WHEN** a refund is attempted with the provision key
- **THEN** the request SHALL be rejected

#### Scenario: Admin reverses a settlement

- **WHEN** an admin reverses a recorded settlement
- **THEN** the buyer SHALL be refunded the collected amount and the seller credit and platform margin for that settlement SHALL be unwound

