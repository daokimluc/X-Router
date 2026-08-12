# xrouter-resilience

Rate-limit-aware retry/backoff for Foza's X-Router client, liveness-aware reads,
and a documented no-downtime provision-key rotation procedure, so bulk provisioning
and transient gateway pressure degrade gracefully instead of failing user actions.

## ADDED Requirements

### Requirement: Rate-limit-aware retry

The X-Router client SHALL handle `429 provision_rate_limit_exceeded` with backoff
rather than failing immediately.

#### Scenario: Backoff and succeed
- **WHEN** a provision call returns `429` with a `retry-after` header
- **THEN** the client SHALL wait at least `retry-after` and retry with capped
  exponential backoff, up to a bounded number of attempts

#### Scenario: Surface after cap
- **WHEN** retries are exhausted
- **THEN** the client SHALL throw a typed rate-limit error the caller can present as
  a friendly message, not an unhandled exception

#### Scenario: Reconcile survives rate limit
- **WHEN** a settlements replay hits `429` mid-reconciliation
- **THEN** reconciliation SHALL back off and continue rather than abort

### Requirement: Liveness-aware reads

Foza SHALL distinguish "gateway down" from other errors.

#### Scenario: Gateway unreachable
- **WHEN** `GET /healthz` fails
- **THEN** the console SHALL surface an "X-Router unreachable" state instead of a
  bare error, and SHALL NOT throw an unhandled exception

### Requirement: No-downtime provision-key rotation

Rotating the provision key SHALL be possible without downtime.

#### Scenario: Two-key window
- **WHEN** the operator rotates the provision key
- **THEN** the procedure SHALL allow old and new keys to be valid simultaneously
  (`PROVISION_API_KEYS=old,new`) while Foza switches `XROUTER_PROVISION_KEY`, then
  the old key is dropped

#### Scenario: Documented runbook
- **WHEN** an operator needs to rotate a key (suspected leak or routine)
- **THEN** a written procedure SHALL exist covering both provision-key rotation and
  client-key rotation (`/provision/key/:id/rotate`)
