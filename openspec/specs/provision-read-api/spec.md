# provision-read-api Specification

## Purpose
TBD - created by archiving change provision-read-api. Update Purpose after archive.
## Requirements
### Requirement: Provision-key read surface

The gateway SHALL expose read endpoints under `/provision/*`, authenticated by
the provision API key, returning the wallet balance, seller earnings, platform
margin, plan catalog, sellers, listings, and markup that the website renders.
These reads SHALL be authorized by the provision key alone and SHALL NOT require
an admin key. An admin or client key SHALL be rejected on these routes.

#### Scenario: Provision key reads a wallet balance

- **WHEN** the website calls `GET /provision/wallet/:keyId` with a valid provision key
- **THEN** the response SHALL report the key's USD wallet balance and whether a wallet is provisioned

#### Scenario: Provision key reads seller earnings

- **WHEN** the website calls `GET /provision/earnings/:sellerId`
- **THEN** the response SHALL report the seller's day, month, lifetime, and unpaid USD totals

#### Scenario: Provision key reads the plan catalog, sellers, listings, and markup

- **WHEN** the website calls `GET /provision/plans`, `GET /provision/sellers`, `GET /provision/listings`, or `GET /provision/markup`
- **THEN** each SHALL return the corresponding current state

#### Scenario: Admin key rejected on provision reads

- **WHEN** a request to a `GET /provision/*` read presents a valid admin key but no provision key
- **THEN** the request SHALL be rejected HTTP 401

### Requirement: Usage reconciliation pull

The gateway SHALL expose `GET /provision/usage` (provision-key authenticated)
returning settled usage records filterable by a `since` timestamp, an optional
buyer key, and a result limit, so the website can rebuild its ledger after
missed or duplicated webhook deliveries. The endpoint SHALL be a
reconciliation/audit view (tokens, model, cost, timestamps) and is NOT required
to replay the exact settlement payload of the `usage.recorded` webhook.

#### Scenario: Pull usage since a timestamp

- **WHEN** the website calls `GET /provision/usage?since=<ISO>` after a period of missed webhooks
- **THEN** the response SHALL contain the usage records created at or after that timestamp, up to the result limit

#### Scenario: Pull usage scoped to one buyer key

- **WHEN** the website calls `GET /provision/usage?keyId=<id>`
- **THEN** the response SHALL contain only that key's usage records

### Requirement: Self-service business webhook configuration via provision key

The gateway SHALL allow the website to configure its business webhook target
(enabled, url, secret, subscribed events) through `PUT /provision/webhook` using
the provision key, so the website does not need an admin key for its own setup.
A companion `GET /provision/webhook` SHALL return the configuration with the
secret masked.

#### Scenario: Set the webhook target with the provision key

- **WHEN** the website calls `PUT /provision/webhook` with a url, secret, and event list using the provision key
- **THEN** the business webhook configuration SHALL be updated and subsequent business events SHALL be delivered to that target

#### Scenario: Read back the webhook config with the secret masked

- **WHEN** the website calls `GET /provision/webhook`
- **THEN** the response SHALL report the url, enabled flag, and subscribed events, and SHALL NOT reveal the raw secret

