## Context

The Usage page currently builds metrics by `reduce()`-ing over the full `usage[]` array fetched from `/admin/v1/admin-overview`. With ~10k records this works; past 50-100k records the JS reduce dominates render time and the JSON payload itself becomes a problem. We also have no way to render a time-bucketed line/area chart without sending raw rows to the browser.

Stakeholders: gateway operator (single admin in current product), used during incident triage and cost reviews.

## Goals / Non-Goals

**Goals:**
- Server-side aggregation that scales independent of total UsageRecord count.
- One endpoint, three views — minimize round-trips.
- Charts that render in a separate code-split chunk so initial dashboard load does not grow.
- Reuse existing UsagePage shell and time range selector; only the panel inside is new.

**Non-Goals:**
- Real-time / streaming charts. 30s refetch is enough.
- User-level breakdown (Accountrouter is single-tenant admin).
- Drill-down (click bar → filtered logs). Future iteration.
- Replacing the topology graph or model leaderboard.

## Decisions

### Decision 1 — Aggregation in app memory, not via UsageService refactor

`UsageService.list()` currently returns the full array. We add a sibling `aggregate()` method that does a single linear pass over the in-memory store and emits buckets. No DB / persistence change required because UsageRecord already lives in `UsageService`'s in-memory ring buffer with persistence to JSON via `PersistenceService`.

**Alternative considered**: Refactor `UsageService` to push records into a sqlite table and run real `GROUP BY` SQL. Rejected because (a) Accountrouter has no SQL layer, (b) ring buffer is bounded so cost is O(N) with small N, (c) introduces a migration that's out of scope.

### Decision 2 — Bucket sizes: `hour` and `day` only

Two options, no `minute` bucket. Hour gives 24-336 buckets for typical 1d-14d windows; day gives 7-90 buckets for monthly views. Anything smaller would be noise on a non-real-time dashboard.

### Decision 3 — `groupBy` defaults to `model`, supports `provider`

Most ops questions are model-shaped ("which model spiked"). `provider` is the secondary cut. We deliberately exclude `account`, `apiKey` to bound cardinality of the response — top-N is enough.

### Decision 4 — Top-N truncation server-side

The aggregate endpoint computes per-bucket totals for ALL groups, then keeps only the top-10 by total cost across the window. Remaining series are merged into an `"_other"` bucket. This bounds response size to `(buckets × 11)` data points regardless of how many models exist.

### Decision 5 — Chart library: recharts

| Lib | Bundle | Pros | Cons |
|---|---|---|---|
| recharts | ~80 KB gz | React-native, declarative, decent area/pie/bar | Slow on >5k points |
| visx | ~40 KB gz (modular) | Tiny, composable | Low-level, more code to write |
| apexcharts | ~150 KB gz | Polished | Imperative, heavy |

Pick **recharts**: aggregate response is bounded (≤330 points), the slow-on-many-points caveat doesn't bite, and it ships ready-made `<AreaChart>` `<PieChart>` `<BarChart>` components.

### Decision 6 — Lazy-load via `React.lazy`

`UsageChartsPanel` is loaded with `React.lazy(() => import('./components/UsageChartsPanel'))` so recharts ships in its own chunk, downloaded only when the user opens Usage. Keeps Overview-first-paint clean.

### Decision 7 — Endpoint shape

```
GET /admin/v1/usage/aggregate?from=ISO&to=ISO&bucket=hour|day&groupBy=model|provider

Response:
{
  "bucket": "hour",
  "groupBy": "model",
  "from": "2026-05-21T00:00:00Z",
  "to":   "2026-05-28T00:00:00Z",
  "buckets": ["2026-05-21T00:00:00Z", "2026-05-21T01:00:00Z", ...],
  "series": [
    { "key": "claude-opus-4-7",   "totalCost": 12.4, "totalTokens": 980000, "totalRequests": 240, "perBucket": [{ "cost": 0, "tokens": 0, "requests": 0 }, ...] },
    { "key": "gpt-4o",            ... },
    { "key": "_other",            ... }
  ]
}
```

Each series exposes 3 metrics so the UI can switch between cost, tokens, requests without a new request.

## Risks / Trade-offs

- **In-memory aggregation O(N × buckets)** → If ring buffer ever grows to 1M records, this re-scan on every request will be ~50ms. Mitigation: server caches the aggregate keyed by `(from, to, bucket, groupBy)` for 30s; cache invalidates on next `usageService.record()`. Acceptable because dashboard polls every 5-30s anyway.
- **Top-10 truncation hides long-tail models** → The `_other` series shows aggregate of remaining; user can switch to leaderboard table for the full list. Document this in the panel.
- **recharts is React 19 compatible only via `recharts@^2.13`** → Pin version; verify in package.json before merge.
- **Chart library bundle (~80 KB) is significant** → Lazy-loaded, ships only on Usage page entry. Initial Overview unaffected. Code-splitting is the mitigation.
- **Time zones** — bucket boundaries are UTC only. Frontend displays in user local TZ via `toLocaleString`. Document on the panel.

## Migration Plan

Additive only. No data migration. Steps:

1. Backend endpoint behind admin auth, off by default? **No** — admin auth already gates it; ship in default.
2. Add `recharts` to `apps/dashboard/package.json`, run `npm install`.
3. Implement `UsageChartsPanel` component, wire into `UsagePage.tsx` after the existing leaderboard.
4. Manual smoke test: open Usage with empty data → renders "no data" state; with synthetic data covering 2 days → trend, pie, top all render.
5. Ship.

Rollback: revert frontend commit; backend endpoint can stay (no caller depends on it once the panel is gone).

## Open Questions

- Should the panel respect the page-level `range` selector, or have its own? Default: respect page-level for consistency. Confirm with first iteration.
- Default metric tab (cost vs tokens vs requests)? Suggest: cost, since it's the most actionable signal.
