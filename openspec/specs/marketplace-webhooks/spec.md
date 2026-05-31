# marketplace-webhooks Specification

## Purpose
TBD - created by archiving change provision-webhook. Update Purpose after archive.
## Requirements
### Requirement: Signed business webhook channel

The gateway SHALL emit business events to a dedicated business webhook target,
separate from the existing ops (Discord/Slack) webhook. Each business event SHALL
be sent as an HTTP POST whose body is the JSON envelope `{ event, timestamp, data }`,
with header `X-Provision-Signature: sha256=<hex>` where `<hex>` is the HMAC-SHA256
of the exact serialized request body computed under the configured shared secret.
The shared secret SHALL be stored encrypted at rest (never persisted in plaintext)
and SHALL be returned masked on read. Delivery SHALL be best-effort: a failed or
timed-out POST SHALL NOT fail or delay the originating request.

#### Scenario: Event is signed over the exact body

- **WHEN** a business event is emitted with a configured business webhook URL and secret
- **THEN** the POST body SHALL be the JSON envelope and `X-Provision-Signature` SHALL equal `sha256=` followed by the HMAC-SHA256 of that exact body under the secret

#### Scenario: Secret is encrypted at rest and masked on read

- **WHEN** the business webhook secret is persisted and later read back via the config endpoint
- **THEN** the persisted representation SHALL be ciphertext (not the raw secret) and the read response SHALL mask the secret

#### Scenario: Delivery failure does not affect the request

- **WHEN** the business webhook endpoint is unreachable during an emission
- **THEN** the originating billable request SHALL still complete normally and the failure SHALL be swallowed

### Requirement: usage.recorded event

The gateway SHALL emit `usage.recorded` after each billable request settles, carrying the settlement data object: at minimum the buyer key, base model, serving seller id, token counts, the sell amount charged, the seller credit, and the platform margin.

#### Scenario: Settlement emits usage.recorded

- **WHEN** a marketplace request settles with a buyer charge, seller credit, and platform margin
- **THEN** a `usage.recorded` event SHALL be emitted whose `data` contains the buyer, base model, seller id, tokens, sell amount, seller credit, and platform margin

### Requirement: grant.exhausted event

The gateway SHALL emit `grant.exhausted` when a plan group's month budget bucket reaches zero for a key, carrying the key id, plan id, group, and the exhausted `monthUsd`. The event SHALL be emitted once per exhaustion, not on every subsequent blocked request.

#### Scenario: Month bucket reaching zero emits the event

- **WHEN** a key's plan group month budget transitions to fully consumed
- **THEN** a single `grant.exhausted` event SHALL be emitted with the key, plan, group, and month budget

### Requirement: wallet.low event

The gateway SHALL emit `wallet.low` when a key's wallet balance crosses below the configured low-water threshold, carrying the key id, current balance, and the threshold.

#### Scenario: Balance crossing the threshold emits the event

- **WHEN** a wallet balance falls below the configured low-water threshold
- **THEN** a `wallet.low` event SHALL be emitted with the key id, balance, and threshold

### Requirement: quota.blocked event

The gateway SHALL emit `quota.blocked` when a request is rejected by key-policy enforcement with no boost or overage escape (HTTP 429 or 402), carrying the key id, the rejection reason, the HTTP status, and the affected group when applicable.

#### Scenario: A hard rejection emits the event

- **WHEN** enforcement rejects a request with 429 (speed limit or PAYG daily limit, no boost) or 402 (insufficient funds)
- **THEN** a `quota.blocked` event SHALL be emitted with the key id, reason, and HTTP status

### Requirement: supply.unhealthy event

The gateway SHALL emit `supply.unhealthy` when the provider health monitor marks a seller's provider account unhealthy, carrying the seller id, provider account id, and the reason.

#### Scenario: Health monitor marks a seller account unhealthy

- **WHEN** the health monitor transitions a seller's provider account to unhealthy
- **THEN** a `supply.unhealthy` event SHALL be emitted with the seller id, provider account id, and reason

