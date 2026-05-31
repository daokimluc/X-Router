# provision-listing-metrics Specification

## Purpose
TBD - created by archiving change marketplace-listing-metrics. Update Purpose after archive.
## Requirements
### Requirement: Per-listing display metrics over the provision key

The gateway SHALL expose `GET /provision/listings/metrics`, authenticated by the
provision API key alone (admin and client keys SHALL be rejected), returning one entry
per enabled listing with the display metrics the marketplace card renders. Each entry
SHALL be keyed to the listing (by its `providerAccountId` and `(sellerId, baseModel)`)
and SHALL carry: request count and token sums (from the settlement log over an optional
`since` window, excluding reversed settlements), a lifetime success rate (from the
listing account's runtime counters), and rolling latency percentiles plus a derived
request rate (from the latency tracker). The endpoint SHALL NOT require an admin key and
SHALL NOT alter any money or persisted state.

#### Scenario: Provision key reads listing metrics

- **WHEN** the website calls `GET /provision/listings/metrics` with a valid provision key
- **THEN** the response SHALL return one metrics entry per enabled listing, each
  identified by listing id, seller id, base model, and provider account id

#### Scenario: Admin or client key is rejected

- **WHEN** the endpoint is called with an admin key or a client API key instead of the provision key
- **THEN** the request SHALL be rejected (not authorized) exactly as the other `/provision/*` reads

#### Scenario: Requests and tokens come from settled, non-reversed records

- **WHEN** metrics are computed for a listing's `(sellerId, baseModel)`
- **THEN** `requests` and the token sums SHALL count only settled records, SHALL exclude
  records flagged reversed, and SHALL respect the optional `since` window

### Requirement: No fabricated metric values

A metric SHALL be reported as null when its underlying source has no data for the
listing, rather than as a fabricated or hardcoded value (e.g. never a default 100%
success or a zero latency). The response SHALL allow the website to distinguish "no data
yet" from a real measured value.

#### Scenario: A listing with no traffic reports nulls, not zeros-as-success

- **WHEN** a listing has received no requests in the relevant windows
- **THEN** its latency percentiles, rps, and success rate SHALL be null (not 100%, not 0
  presented as a real measurement), while request/token counts MAY be 0

### Requirement: Explicit freshness and grain contract

The response SHALL declare the freshness and grain of each metric so the consumer does
not blend differing time horizons into a single value. The contract SHALL make clear
that request/token counts are over the requested settlement window, the success rate is
cumulative lifetime (per account), and latency/rps are a short rolling window.

#### Scenario: Response documents metric horizons

- **WHEN** the website reads the metrics response
- **THEN** it SHALL be able to determine, per metric, its source horizon (settlement
  window vs lifetime vs rolling latency window) from the response itself

