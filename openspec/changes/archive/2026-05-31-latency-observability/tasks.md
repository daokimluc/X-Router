## 1. Tracker service

- [x] 1.1 Create `apps/gateway/src/services/LatencyTrackerService.ts` with `record(args)` and `snapshot()` methods. Bucket boundaries hard-coded per design (decision 1).
- [x] 1.2 Implement 5-slot rolling window: array of histograms, `setInterval(rotate, 60000)` rotates on minute boundary.
- [x] 1.3 LRU map of tuples (use a simple `Map` with re-insertion on `record` for LRU; cap = 2000).
- [x] 1.4 Unit tests: bucket placement, slot rotation, LRU eviction, percentile correctness on synthetic data.

## 2. Wiring into routes

- [x] 2.1 Decorate `app.latencyTracker` in `apps/gateway/src/app.ts`. Stop the rotation interval on `app.close`.
- [x] 2.2 In `routes/openai.ts` after success: `app.latencyTracker.record({ providerInstanceId, publicModel, accountId, durationMs, ok: true })`. Same for failure paths with `ok: false`.
- [x] 2.3 Same wiring in `routes/anthropic.ts` (stream + non-stream + direct routing branches).

## 3. Admin endpoint

- [x] 3.1 Add `GET /admin/v1/metrics/latency` to `routes/admin.ts` with `adminAuth`.
- [x] 3.2 Map `latencyTracker.snapshot()` to the response shape from spec.
- [x] 3.3 Vitest: returns shape, requires auth, empty when no data.

## 4. Prometheus endpoint

- [x] 4.1 Add `GET /metrics` route. Conditional auth based on `METRICS_PUBLIC` env.
- [x] 4.2 Implement `prometheusText()` formatter — emit cumulative histogram buckets, count, sum, plus existing `MetricsService` counters in same format.
- [x] 4.3 Vitest: cumulative invariant, content type `text/plain; version=0.0.4`, auth gate.

## 5. Frontend panel

- [x] 5.1 Create `apps/dashboard/src/components/LatencyPanel.tsx` (small card, top-10 list).
- [x] 5.2 Add latency endpoint call to `useDashboardData` hook (or wherever Overview polling lives).
- [x] 5.3 Insert `<LatencyPanel />` into Overview page, in the right column near "Provider Health".
- [x] 5.4 Empty-state copy.
- [x] 5.5 i18n keys for EN/VI: `ov.latency.title`, `ov.latency.empty`.

## 6. Verification

- [x] 6.1 Gateway tsc + vitest.
- [x] 6.2 Dashboard tsc + build.
- [ ] 6.3 Manual: hit `/v1/chat/completions` 50× via mock provider, verify p50 lands in expected bucket, panel renders, `/metrics` shows the histogram.
- [ ] 6.4 Update `.claude/notes.md` with endpoint paths.
