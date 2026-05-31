# latency-prometheus-export Specification

## Purpose
TBD - created by archiving change latency-observability. Update Purpose after archive.
## Requirements
### Requirement: Prometheus-format histogram exporter

The gateway SHALL expose `GET /metrics` that returns Prometheus text format including a `gateway_request_duration_ms` histogram metric, broken down by `provider`, `model`, `account`, and `outcome` (`ok` or `error`).

By default the endpoint SHALL require admin auth. When the environment variable `METRICS_PUBLIC=true` is set, the endpoint SHALL respond without auth.

The output SHALL include for each tuple:
- One `gateway_request_duration_ms_bucket{...,le="<boundary>"} <count>` line per histogram bucket
- One `gateway_request_duration_ms_bucket{...,le="+Inf"} <count>` line
- One `gateway_request_duration_ms_count{...} <count>` line
- One `gateway_request_duration_ms_sum{...} <ms_sum>` line

The output SHALL also include the existing counters already aggregated by `MetricsService` (request count, byte counts, error count) so that Prometheus has one scrape target.

#### Scenario: Default scrape requires admin auth

- **WHEN** Prometheus scrapes `/metrics` with no auth header and `METRICS_PUBLIC` is unset
- **THEN** the gateway SHALL return HTTP 401

#### Scenario: METRICS_PUBLIC=true allows anonymous scrape

- **WHEN** the env flag `METRICS_PUBLIC=true` is set and Prometheus scrapes `/metrics` without auth
- **THEN** the gateway SHALL return HTTP 200 with the metrics body

#### Scenario: Histogram cumulative invariant

- **WHEN** the exporter emits histogram buckets for a tuple
- **THEN** for any two adjacent buckets `le=A` and `le=B` with `A < B`, the count for `le=B` SHALL be greater than or equal to the count for `le=A` (cumulative buckets per Prometheus convention)

#### Scenario: One bucket per documented boundary plus +Inf

- **WHEN** the exporter emits a histogram for any tuple
- **THEN** the bucket boundaries SHALL match `{10, 20, 30, 50, 75, 100, 150, 200, 300, 500, 750, 1000, 1500, 2000, 3000, 5000, 7500, 10000, 15000, 20000, 30000, +Inf}` exactly

