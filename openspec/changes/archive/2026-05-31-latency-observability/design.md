## Context

Accountrouter currently emits per-request counters via `MetricsService` (request count, byte counts, error count) but does not measure latency. The `RequestLogService` keeps a bounded in-memory log with `durationMs` per entry; that's per-request, not aggregated, and it's not exposed in a percentile-friendly shape.

`tsx watch` runs Node 22+; we have `undici` already, no new HTTP server needed for the Prometheus endpoint — Fastify can serve it inline.

## Goals / Non-Goals

**Goals:**
- p50/p95/p99 per `(channel, model, account)` over a 5-minute rolling window.
- Memory bounded regardless of request volume (no full sample retention).
- Lightweight enough to be a per-request side-effect (<50 µs).
- Export both via JSON (admin endpoint) and Prometheus text format.
- Surface top-10 slowest channels on the Overview page.

**Non-Goals:**
- Long-term persistence. Past 5 minutes, data is dropped (Prometheus / external system handles long-term).
- Per-request tracing. Use distributed tracing (OpenTelemetry) for that — out of scope.
- Alerting. The gateway exposes data; alerting is downstream.
- Latency-aware routing. Separate proposal will consume this data.

## Decisions

### Decision 1 — HDR Histogram bucket scheme over T-Digest

| Algo | Memory | Accuracy | Code |
|---|---|---|---|
| Reservoir 1024 samples | ~32 KB / tuple | exact | medium |
| HDR histogram (10ms-30s log buckets) | ~200 B / tuple | ±1% on percentiles | small |
| T-Digest (npm package) | ~5 KB / tuple | ±1% adaptive | external dep |

**Pick HDR histogram with fixed log buckets (10ms .. 30s, 50 buckets).** Reasons: smallest memory, no external dep, accuracy plenty for p50/p95/p99 at the granularity humans read. Bucket boundaries: `[10, 20, 30, 50, 75, 100, 150, 200, 300, 500, 750, 1000, 1500, 2000, 3000, 5000, 7500, 10000, 15000, 20000, 30000]` ms with `+Inf`.

### Decision 2 — Time window: 5-minute rolling, 1-minute slots

Maintain 5 slot histograms (one per minute). On each minute boundary, drop the oldest slot, start a new one. Reads sum across all 5 active slots. This bounds memory and gives a true rolling window with cheap eviction.

### Decision 3 — Tuple key cardinality bound

Hard cap at 2000 active tuples. When a new tuple would push past the cap, evict the least-recently-used tuple (LRU). With 50 channels × 20 models × 2 accounts = 2000 typical max, this is generous.

### Decision 4 — Where to record

In `apps/gateway/src/routes/openai.ts` and `anthropic.ts` after the request completes — both success and failure paths. Wrap with a tiny helper `app.latencyTracker.record({ providerInstanceId, model, accountId, durationMs, ok })`. Failures are tracked with a separate suffix (`_error`) so users can compare healthy vs degraded latency.

### Decision 5 — Endpoint shape

```
GET /admin/v1/metrics/latency

Response:
{
  "windowSeconds": 300,
  "tuples": [
    {
      "providerInstanceId": "kiro_main",
      "publicModel": "claude-opus-4-7",
      "accountId": "kiro_main_acc_1",
      "ok":     { "count": 240, "p50": 820, "p95": 2100, "p99": 4500 },
      "error":  { "count":   3, "p50": 5000, "p95": 5000, "p99": 5000 }
    },
    ...
  ]
}
```

### Decision 6 — Prometheus exporter shape

`/metrics` endpoint (no auth — standard Prometheus pattern, but bind to localhost or behind admin auth via env flag `METRICS_PUBLIC=false`). Output:

```
# HELP gateway_request_duration_ms Request latency in milliseconds
# TYPE gateway_request_duration_ms histogram
gateway_request_duration_ms_bucket{provider="kiro_main",model="claude-opus-4-7",account="kiro_main_acc_1",le="100"} 12
gateway_request_duration_ms_bucket{...,le="200"} 45
...
gateway_request_duration_ms_count{provider="kiro_main",...} 240
gateway_request_duration_ms_sum{provider="kiro_main",...} 198000
```

### Decision 7 — Overview panel

A small card on Overview titled "Slowest channels". Shows top-10 by p95 with: provider name, model, p95 in ms, request count, ok/error split. Refreshes every 30s.

## Risks / Trade-offs

- **HDR fixed buckets cap p99 accuracy at the bucket boundary.** A request that took exactly 27000ms reports as ≤30000. For the Accountrouter use case (operators reading the dashboard) this is fine.
- **5-min window misses long-term degradation.** Mitigation: Prometheus scrape stores it externally; the gateway only needs the rolling view for the dashboard.
- **LRU eviction silently drops cold tuples.** If a low-traffic model is evicted, its next request creates a fresh tuple and historical data is gone. Acceptable trade-off given memory bound.
- **Recording is on the hot path.** Histogram record is O(log buckets) ≈ 5 ops; LRU touch is O(1). Total per-request overhead well under 50 µs.
- **`/metrics` security.** Default to admin-auth-gated. Operators who want unauthenticated scrape can flip an env flag and bind to a private network.

## Migration Plan

Additive. No data migration. Steps:
1. Implement `LatencyTrackerService`.
2. Wire recording in routes.
3. Add admin endpoint, then Prometheus endpoint.
4. Frontend panel on Overview.
5. Document the endpoints in docs panel.

Rollback: feature is independent — no schema change. Revert commit.

## Open Questions

- Should the Overview panel default-collapsed for users who haven't sent traffic yet, to avoid showing an empty state?
- Should `/metrics` include the existing counters from `MetricsService`? Yes — single endpoint is more idiomatic for Prometheus. Will need to refactor `MetricsService.toPrometheusText()` if it doesn't exist already.
