## MODIFIED Requirements

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
