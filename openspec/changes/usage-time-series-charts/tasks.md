## 1. Backend — Aggregate endpoint

- [x] 1.1 Add `aggregate(opts)` method to `UsageService` that takes `{ from, to, bucket, groupBy }` and returns the response shape defined in design.md (decision 7).
- [x] 1.2 Implement bucket alignment helper (`floorToBucket(timestamp, bucket)`) shared with tests. Hour buckets align to top-of-hour UTC, day buckets to 00:00 UTC.
- [x] 1.3 Implement top-10 truncation with `_other` aggregation per spec `usage-aggregate-api`.
- [x] 1.4 Add 30s in-memory cache keyed by `(from, to, bucket, groupBy)`; invalidate on `UsageService.record()`.
- [x] 1.5 Register `GET /admin/v1/usage/aggregate` in `apps/gateway/src/routes/admin.ts` with `adminAuth` preHandler and `zod` validation for query params.
- [x] 1.6 Vitest: bucket alignment, top-N truncation, empty window, cache hit, auth required.

## 2. Frontend — Chart panel

- [x] 2.1 `npm install recharts@^2.13` in `apps/dashboard`. Verify React 19 compatibility.
- [x] 2.2 Create `apps/dashboard/src/components/UsageChartsPanel.tsx` with three tab views (Trend / Proportion / Top) consuming the aggregate endpoint.
- [x] 2.3 Add metric switcher inside the panel (cost / tokens / requests) — derives data from already-fetched series, no extra request.
- [x] 2.4 Wrap the panel export with `React.lazy(() => import('./UsageChartsPanel'))` at the call site so the recharts chunk is split out.
- [x] 2.5 In `UsagePage.tsx`, render `<Suspense fallback>` containing the lazy panel below the existing model leaderboard.
- [x] 2.6 Empty-state component for `series: []`.
- [ ] 2.7 Manual smoke: empty data, 7d hourly, 30d daily, switching metric tabs, switching range refetches.

## 3. Verification

- [x] 3.1 Gateway tsc + vitest pass.
- [x] 3.2 Dashboard tsc + production build pass.
- [x] 3.3 Verify in built bundle that `recharts` ships in a separate chunk (inspect `dashboard-dist/assets/`).
- [ ] 3.4 Visual check: Overview page first paint unchanged (no new bytes downloaded until user navigates to Usage).

## 4. Docs

- [ ] 4.1 Update `.claude/notes.md` (or session notes) with the new endpoint shape and panel location.
- [x] 4.2 Update `apps/dashboard/src/components/FaqPanel.tsx` with one-line FAQ entry "Where do I see usage trends over time?" pointing to Usage page.
