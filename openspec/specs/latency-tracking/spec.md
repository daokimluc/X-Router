# latency-tracking Specification

## Purpose
TBD - created by archiving change latency-observability. Update Purpose after archive.
## Requirements
### Requirement: HDR-style histogram per (provider, model, account) tuple over rolling 5-minute window

The system SHALL maintain a per-tuple histogram of request durations using fixed logarithmic buckets covering 10ms to 30s, plus a `+Inf` overflow bucket. Each tuple SHALL maintain 5 one-minute slot histograms; on every minute boundary, the oldest slot SHALL be dropped and a new empty slot SHALL be created.

#### Scenario: Recording a duration places it in the correct bucket and the active slot

- **WHEN** the gateway records a 850ms duration for tuple `(kiro_main, claude-opus-4-7, acc_1, ok)`
- **THEN** the histogram for that tuple in the active minute slot SHALL increment the `<= 1000ms` bucket counter, and a `count`/`sum` aggregate SHALL be updated for percentile reads

#### Scenario: Slot rotation drops oldest minute on minute boundary

- **WHEN** 5 one-minute slot histograms exist and a new minute boundary is crossed
- **THEN** the oldest slot SHALL be removed and a fresh empty slot SHALL be added; reads SHALL only include the 5 most recent minutes

#### Scenario: Errors and successes are tracked separately

- **WHEN** the gateway records a 5000ms duration with `ok=false`
- **THEN** the duration SHALL increment a separate `error` histogram for the same tuple, and ok-only percentile reads SHALL NOT include this sample

### Requirement: Tuple cardinality cap with LRU eviction

The tracker SHALL maintain at most 2000 active tuples. Recording a sample for a new tuple when at capacity SHALL evict the least-recently-recorded tuple to make room.

#### Scenario: 2001st distinct tuple evicts the LRU one

- **WHEN** 2000 distinct tuples are already tracked and a sample arrives for a new tuple while the tuple least recently sampled has not received any sample for the longest time
- **THEN** the LRU tuple SHALL be removed and the new tuple SHALL be created

### Requirement: Percentile reads return p50, p95, p99, count, sum

A read API SHALL return, for any tuple, `count`, `sum`, `p50`, `p95`, `p99` computed across the union of the 5 currently active minute slots, separately for `ok` and `error`.

#### Scenario: Empty tuple returns zero count and undefined percentiles

- **WHEN** a tuple has 0 samples in the rolling window
- **THEN** the read SHALL return `count: 0` and percentile fields SHALL be `null`

#### Scenario: Single sample: all percentiles equal the bucket midpoint

- **WHEN** a tuple has exactly 1 sample of 250ms
- **THEN** `count: 1`, p50, p95, and p99 SHALL all return the upper bucket boundary that contains 250ms (250 with the documented bucket scheme)

