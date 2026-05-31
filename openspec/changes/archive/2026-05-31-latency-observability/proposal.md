## Why

Operators have no way to see latency distribution per channel/model/account. The dashboard reports total request counts and error rate but no p50/p95/p99. When a provider degrades from 200ms to 5s on a single model, we only notice via timeouts; cannot proactively reroute. Smart routing (latency-aware sort) needs this data as input.

## What Changes

- Track per-`(providerInstanceId, publicModel, accountId)` latency for every completed request using a bounded sketch (no full sample retention).
- Expose `GET /admin/v1/metrics/latency` returning p50/p95/p99 + sample count for each tracked tuple over a 5-minute rolling window.
- Add `/metrics` Prometheus-format exporter for the same data so external monitoring (Grafana, Datadog) can scrape.
- Add a "Latency" panel to the Overview page showing top-10 slowest channels with a visual p95 bar.
- **BREAKING** none — additive observability only.

## Capabilities

### New Capabilities
- `latency-tracking`: In-process sketch-based latency tracking per `(channel × model × account)` tuple over a rolling 5-minute window.
- `latency-metrics-api`: Admin endpoint that returns latency percentiles for each tracked tuple.
- `latency-prometheus-export`: Prometheus-compatible `/metrics` endpoint exposing latency histograms plus the existing counters already emitted by `MetricsService`.
- `latency-overview-panel`: Dashboard panel on the Overview page showing top slowest channels.

### Modified Capabilities
- (none — purely additive; existing counters in `MetricsService` are preserved)

## Impact

- New service: `apps/gateway/src/services/LatencyTrackerService.ts` (sketch + bucket logic + percentile reads).
- Hook: openai.ts and anthropic.ts routes record latency on success and failure.
- New endpoint files / additions: `/admin/v1/metrics/latency` and `/metrics`.
- Frontend: new `LatencyPanel` component on Overview.
- New dependency: none — implement sketch in pure TypeScript (~80 lines), avoid `tdigest` npm package to keep dep surface small.
- Memory budget: ~5 KB per tracked tuple × max ~2000 tuples = ~10 MB upper bound.
