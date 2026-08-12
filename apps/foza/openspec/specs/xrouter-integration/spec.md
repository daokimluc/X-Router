# xrouter-integration Specification

## Purpose
TBD - created by archiving change integrate-xrouter. Update Purpose after archive.
## Requirements
### Requirement: Server-side only gateway access

The X-Router admin key SHALL never be exposed to the browser.

#### Scenario: Admin key stays server-side
- **WHEN** the browser needs X-Router data
- **THEN** it SHALL call a Foza API route, and only that server-side route SHALL attach the X-Router admin key when calling the gateway

#### Scenario: No client import
- **WHEN** the integration client/adapter is imported
- **THEN** it SHALL be importable only from server code (Route Handlers, server components), not client components

### Requirement: Feature-flagged with mock fallback

The integration SHALL be controlled by `XROUTER_ENABLED` and degrade gracefully.

#### Scenario: Flag off uses mock
- **WHEN** `XROUTER_ENABLED` is not `true`
- **THEN** every adapter method SHALL return mock data without calling X-Router

#### Scenario: Live with fallback on error
- **WHEN** `XROUTER_ENABLED` is `true` but X-Router is unreachable, times out, or returns an error/unbuilt endpoint
- **THEN** the adapter SHALL return mock data (or a typed error the route can handle) rather than throwing an unhandled exception

#### Scenario: Identical shape
- **WHEN** the adapter switches between mock and live
- **THEN** both SHALL return the same typed shape so consuming UI needs no change

### Requirement: API route handlers

Foza SHALL expose Route Handlers that proxy reads to X-Router via the adapter.

#### Scenario: Models endpoint
- **WHEN** the browser requests `/api/xrouter/models`
- **THEN** Foza SHALL return the model list (live from `GET /v1/models` when enabled, else mock) as JSON

#### Scenario: Usage endpoint
- **WHEN** the browser requests `/api/xrouter/usage`
- **THEN** Foza SHALL return usage/spend data (live from `GET /admin/v1/usage` when enabled, else mock)

### Requirement: Webhook receiver with idempotency

Foza SHALL accept usage/credit events from X-Router and process them safely.

#### Scenario: Authenticated webhook
- **WHEN** X-Router posts an event to `/api/webhooks/xrouter`
- **THEN** Foza SHALL verify the shared secret and reject unauthorized requests

#### Scenario: Duplicate event ignored
- **WHEN** an event with an already-seen id arrives
- **THEN** Foza SHALL acknowledge it without double-processing (idempotent)

### Requirement: Config and documentation

Integration settings SHALL be env-driven and documented.

#### Scenario: Env documented
- **WHEN** a developer opens `.env.example`
- **THEN** it SHALL list `XROUTER_URL`, `XROUTER_ADMIN_KEY`, `XROUTER_INTERNAL_KEY`, `XROUTER_ENABLED`, `XROUTER_WEBHOOK_SECRET` with safe defaults

#### Scenario: Separate repos
- **WHEN** Foza is built or run
- **THEN** it SHALL NOT require X-Router's source code to be present — only the configured URL

