## ADDED Requirements

### Requirement: Per-account refresh serialization

Concurrent credential refreshes for the same provider account SHALL be serialized
so that at most one refresh runs at a time for a given account. A refresh path that
acquires the per-account lock SHALL re-check the credential's expiry inside the lock
and SHALL skip the refresh if another path already refreshed it. This applies to
every refresh trigger: the periodic background refresh and the on-demand
(auth-error) refresh during a request.

#### Scenario: Background loop and on-401 refresh do not double-refresh

- **WHEN** the background refresh loop and an in-flight request both decide to refresh the same account within the same expiry window
- **THEN** exactly one refresh SHALL execute and the other SHALL observe the refreshed credential and skip, so a rotating refresh token is consumed only once

#### Scenario: Single periodic refresh path

- **WHEN** the gateway runs its periodic credential refresh
- **THEN** there SHALL be a single refresh loop (no duplicate concurrent timers refreshing the same accounts)

#### Scenario: Refresh failure does not clobber a newer token

- **WHEN** two refresh attempts for one account would otherwise run concurrently
- **THEN** serialization SHALL prevent a stale refresh result from overwriting a newer persisted credential (no lost update)
