# circuit-breaker-resilience Specification

## Purpose
TBD - created by archiving change resilience-hardening. Update Purpose after archive.
## Requirements
### Requirement: Half-open probe always resolves the circuit

The circuit breaker SHALL track at most `halfOpenMaxRequests` in-flight probe
requests while half-open, and SHALL decrement that count exactly once when each
admitted probe finishes — regardless of how it finishes (success, a
circuit-classified failure, a non-circuit failure, or an internal error). A probe
that succeeds SHALL close the circuit; a probe that fails for any reason SHALL
reopen the circuit and restart the cooldown. The breaker SHALL NOT remain in a
state where no further request can be admitted without an external reset.

#### Scenario: Half-open probe fails with a non-circuit error

- **WHEN** the circuit is half-open and its probe request fails with a non-circuit error (e.g. an auth error or an internal throw)
- **THEN** the circuit SHALL reopen and restart its cooldown, and after the cooldown a new probe SHALL be admitted

#### Scenario: Half-open probe succeeds

- **WHEN** the circuit is half-open and its probe request succeeds
- **THEN** the circuit SHALL close and admit traffic normally

#### Scenario: Auth-refresh retry does not strand the circuit

- **WHEN** a half-open probe hits an auth error and the request path refreshes the credential and retries (rather than recording a circuit failure)
- **THEN** the half-open in-flight count SHALL still be decremented so the circuit can admit a subsequent probe

