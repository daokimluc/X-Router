# provision-hardening Specification

## Purpose
TBD - created by archiving change provision-hardening. Update Purpose after archive.
## Requirements
### Requirement: Documented tenant-isolation trust model

The integration documentation SHALL state explicitly that x-router performs no
buyer or seller isolation, and that the website MUST scope every `keyId` and
`sellerId` it sends to `/provision/*` to the authenticated end-user. It SHALL
state that the provision key is full-privilege and MUST be held server-side only,
and that the website MUST verify the webhook HMAC signature over the raw body
before trusting an event. A threat-model summary of a leaked provision key SHALL
be included.

#### Scenario: Trust model is documented

- **WHEN** an integrator reads the marketplace integration document
- **THEN** it SHALL find an explicit statement that tenant isolation is the website's responsibility, that the provision key is god-mode and server-side only, and a threat model for a leaked provision key

### Requirement: Privileged provision routes are rate-limited

The gateway SHALL apply a configurable rate limit to the privileged mutating
provision routes (create key, wallet top-up, plan grant, earnings mark-paid), so
that abuse of a leaked provision key is bounded. Read routes SHALL remain
unthrottled. Exceeding the limit SHALL return HTTP 429.

#### Scenario: Topup spam is throttled

- **WHEN** wallet top-up is called past the configured per-minute cap on one provision key
- **THEN** further calls SHALL be rejected HTTP 429 until the window resets

#### Scenario: Reads are not throttled

- **WHEN** read endpoints are called frequently
- **THEN** they SHALL NOT be rate-limited by this control

### Requirement: Provision key rotation without downtime

The gateway SHALL accept multiple provision keys simultaneously, so a key can be
rotated by adding a new key, switching the website to it, and removing the old key
with no service interruption.

#### Scenario: Two provision keys both authorize during rotation

- **WHEN** two provision keys are configured
- **THEN** requests bearing either key SHALL be authorized, and removing one SHALL revoke only that key

