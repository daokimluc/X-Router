# usage-aggregate-api Specification

## Purpose
TBD - created by archiving change usage-time-series-charts. Update Purpose after archive.
## Requirements
### Requirement: Aggregate UsageRecord by time bucket

The system SHALL expose `GET /admin/v1/usage/aggregate` that returns time-bucketed totals over `UsageRecord` for the requested window.

The endpoint SHALL accept query parameters:
- `from` (ISO 8601 timestamp, required)
- `to` (ISO 8601 timestamp, required)
- `bucket` (`hour` or `day`, default `hour`)
- `groupBy` (`model` or `provider`, default `model`)

The response SHALL be a JSON object with:
- `bucket`: the bucket size used
- `groupBy`: the grouping dimension used
- `from`, `to`: echoed timestamps
- `buckets`: ordered array of bucket-start ISO timestamps
- `series`: array of group entries, each with `key`, `totalCost`, `totalTokens`, `totalRequests`, and `perBucket` array aligned to `buckets`

#### Scenario: Default request returns hourly cost grouped by model

- **WHEN** an admin calls `GET /admin/v1/usage/aggregate?from=<7d ago>&to=<now>` with valid admin auth
- **THEN** the response SHALL contain `bucket: "hour"`, `groupBy: "model"`, and at least one bucket per hour in the window even if the bucket has no usage (zero-filled)

#### Scenario: Day bucket returned when requested

- **WHEN** an admin calls the endpoint with `bucket=day` over a 14-day window
- **THEN** `buckets` SHALL contain exactly 14 entries spaced 24 hours apart and `bucket` field SHALL equal `"day"`

#### Scenario: Provider grouping returned when requested

- **WHEN** an admin calls the endpoint with `groupBy=provider`
- **THEN** each `series[].key` SHALL be a `providerType` string (e.g., `"kiro"`, `"anthropic"`) instead of a public model name

#### Scenario: Empty window returns empty series

- **WHEN** an admin calls the endpoint over a window with no usage records
- **THEN** the response SHALL still return the full `buckets` array and `series: []`

#### Scenario: Missing or invalid auth returns 401

- **WHEN** the endpoint is called without admin auth
- **THEN** the gateway SHALL respond with HTTP 401 and not execute the aggregation

### Requirement: Top-N truncation with `_other` bucket

When the number of distinct groups exceeds 10, the endpoint SHALL keep only the top 10 by `totalCost` over the window and aggregate the remaining groups into a single series with key `"_other"`.

#### Scenario: 12 models in window collapses to top-10 plus other

- **WHEN** the window contains usage from 12 distinct models
- **THEN** the response `series` array SHALL contain exactly 11 entries: top-10 by cost plus one `_other` entry whose `perBucket` totals equal the sum of the 2 truncated models per bucket

#### Scenario: 5 models in window returns 5 entries with no other

- **WHEN** the window contains usage from 5 distinct models
- **THEN** the response `series` SHALL contain exactly 5 entries and SHALL NOT contain an `_other` entry

### Requirement: Server-side cache for repeated aggregate requests

The endpoint SHALL cache the response keyed by `(from, to, bucket, groupBy)` for 30 seconds OR until the next `UsageService.record()` call, whichever comes first.

#### Scenario: Two identical requests within cache TTL hit cache

- **WHEN** an admin calls the endpoint twice in 5 seconds with identical query parameters and no usage records are written between calls
- **THEN** the second response SHALL be served from cache and SHALL be byte-identical to the first

