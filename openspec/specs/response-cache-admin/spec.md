# response-cache-admin Specification

## Purpose
TBD - created by archiving change semantic-response-cache. Update Purpose after archive.
## Requirements
### Requirement: Cache stats endpoint

The gateway SHALL expose `GET /admin/v1/cache/stats` (admin auth required) returning:
```
{
  "entries": number,
  "bytesUsed": number,
  "bytesMax":  number,
  "hits":      number,
  "misses":    number,
  "hitRatio":  number,
  "evictions": number,
  "topHot": [
    { "keyHash": string, "hits": number, "model": string, "lastHit": ISO8601 string },
    ...
  ]
}
```

`hitRatio` SHALL be `hits / (hits + misses)` rounded to 3 decimals; if `hits + misses === 0`, `hitRatio` SHALL be `0`.

`topHot` SHALL contain at most 20 entries sorted by `hits` descending. `keyHash` is the first 16 hex characters of the full sha256 cache key.

#### Scenario: Empty cache returns zeros

- **WHEN** an admin calls `/admin/v1/cache/stats` with no cache activity yet
- **THEN** the response SHALL have `entries: 0, bytesUsed: 0, hits: 0, misses: 0, hitRatio: 0, evictions: 0, topHot: []`

#### Scenario: Top hot list bounded to 20 entries

- **WHEN** more than 20 distinct cache keys have been hit at least once
- **THEN** `topHot` SHALL contain exactly 20 entries

#### Scenario: Unauthenticated request returns 401

- **WHEN** the endpoint is called without admin auth
- **THEN** the gateway SHALL return HTTP 401

### Requirement: Cache flush endpoints

The gateway SHALL expose `DELETE /admin/v1/cache` (admin auth required) that clears every cache entry. The response SHALL include `{ cleared: <number-of-entries-removed> }`.

The gateway SHALL also expose `DELETE /admin/v1/cache/:keyPrefix` that clears entries whose full sha256 key starts with the given hex prefix. Returns `{ cleared: <number> }`.

#### Scenario: Flush removes all entries

- **WHEN** an admin calls `DELETE /admin/v1/cache` with 100 entries cached
- **THEN** the response SHALL be `{ cleared: 100 }` and a subsequent `GET /admin/v1/cache/stats` SHALL show `entries: 0`

#### Scenario: Prefix flush removes only matching keys

- **WHEN** the cache contains 50 entries whose key starts with `abc` and 200 entries that don't, and an admin calls `DELETE /admin/v1/cache/abc`
- **THEN** the response SHALL be `{ cleared: 50 }` and the remaining 200 entries SHALL still be present

#### Scenario: Flush requires admin auth

- **WHEN** either flush endpoint is called without admin auth
- **THEN** the gateway SHALL return HTTP 401 and SHALL NOT modify the cache

