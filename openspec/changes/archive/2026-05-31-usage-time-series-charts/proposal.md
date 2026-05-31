## Why

The Usage page shows aggregated totals (requests, tokens, cost) and a model leaderboard, but it cannot answer questions like "when did the spike happen", "is GPT-4o use trending up", or "which hour of the day are we hitting rate limits". Operators need a time-series view to spot anomalies, plan capacity, and justify cost. Building this client-side from the full `usage[]` array also stops scaling once we exceed ~50k records.

## What Changes

- Add backend endpoint `GET /admin/v1/usage/aggregate` that returns time-bucketed series (server-side `GROUP BY` over UsageRecord) with optional `from`, `to`, `bucket`, `groupBy` parameters.
- Replace the existing client-side bucketing in the Usage page with a chart panel containing three tabbed views:
  - **Trend** — stacked area chart of cost or token count over time, one series per top model.
  - **Proportion** — pie chart of cost share by model for the selected window.
  - **Top** — horizontal bar chart of the highest-cost models for the window.
- Lazy-load the chart library so the initial dashboard bundle does not grow.
- Keep the existing model leaderboard table and topology graph; charts are added alongside, not replacing them.
- **BREAKING** none — fully additive.

## Capabilities

### New Capabilities
- `usage-aggregate-api`: Server-side aggregation of UsageRecord into time buckets grouped by model or provider, exposed as a single admin endpoint.
- `usage-charts-ui`: Trend/proportion/top model chart panel inside the Usage page that consumes the aggregate endpoint.

### Modified Capabilities
- (none — Usage page enhancement is additive; no spec-level requirement of an existing capability changes)

## Impact

- New file: `apps/gateway/src/routes/admin/usageAggregate.ts` (or addition to existing admin routes module).
- Updated: `apps/dashboard/src/UsagePage.tsx` to render the new panel and call the new endpoint.
- New component: `apps/dashboard/src/components/UsageChartsPanel.tsx`.
- New dependency: `recharts` (~80 KB gzipped, MIT). Lazy-imported via `React.lazy`.
- No DB schema change — `UsageRecord` already has the columns needed.
- No breaking change to clients — purely additive.
