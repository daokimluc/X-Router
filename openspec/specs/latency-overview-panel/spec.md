# latency-overview-panel Specification

## Purpose
TBD - created by archiving change latency-observability. Update Purpose after archive.
## Requirements
### Requirement: Slowest-channels card on Overview page

The dashboard Overview page SHALL render a "Slowest channels" card listing the top 10 tuples by p95 latency from the last 5 minutes. The card SHALL refresh at the same cadence as the rest of the Overview data (currently 30s).

Each row SHALL show: provider name, public model, p95 in ms, total request count, and a small `ok / error` count split.

#### Scenario: Card renders top-10 by p95

- **WHEN** the Overview page loads and the latency endpoint returns 25 tuples
- **THEN** the card SHALL render the 10 tuples with the highest p95 sorted descending

#### Scenario: Empty state when no traffic

- **WHEN** the latency endpoint returns `tuples: []`
- **THEN** the card SHALL display "No traffic in the last 5 minutes" instead of an empty list

#### Scenario: Card refresh on Overview poll

- **WHEN** the Overview page issues its periodic data refresh
- **THEN** the latency endpoint SHALL be called as part of the same poll cycle and the card SHALL update if any tuple changed

