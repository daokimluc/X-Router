# Session Notes — 2026-05-28 (Phase 32: audit fixes + 4 OpenSpec proposals)

## Latest commits
- `405d3ee` chore: add OpenSpec slash commands + skills (`.claude/commands/opsx/*`, `.claude/skills/openspec-*`)
- `10fb0a9` feat(phase31): multi-channel routing + model variants + post-audit fixes
- `81e41c0` fix: fixed_model routes bypass group filter (Phase 31 regression)
- `74d0192` feat: multi-source Kiro features + provider catalog expansion + streaming usage
- `e835678` feat(phase30): channel wizard + per-channel modelMapping
- `d8b157c` feat(phase29): channel observability + admin tools
- `0c17734` feat(phase26-28): token UX, stats panels, settings tabs

## What landed this session

### Audit (10 issues, all fixed in commit `10fb0a9`)
1. catalog/index.ts — `category: "oauth"` invalid → `"oauth_subscription"`
2. CredentialWritebackService dead code → wired in app.ts via decorator
3. KiroProviderAdapter `onCredentialRefreshed` callback unbound → threaded through createDefaultProviderRegistry
4. AccountQuotaService.recordUsage never called → invoked in openai.ts and anthropic.ts (stream + non-stream)
5. resolveAccountProxyOptions unreachable → new `fetchWithProxy` helper, wired in 8 adapters + Kiro client
6. /v1/messages missing inline refresh-on-auth-error → mirror openai.ts flow
7. /v1/models and /v1/public/models duplicated entries → dedupe by publicModel
8. /admin test-model used `registry.get()` → now scopes to (instanceId, publicModel)
9. Phase 25 input policies on 3/10 adapters → now wired in 6 more adapters
10. Streaming usage was always char-heuristic → ProviderStream gained optional `usage()` getter; Kiro emits from contextUsageEvent

Test count: 371 → 382 pass (added Phase 31 multi-channel + post-audit tests).

### Phase 31 multi-channel routing + model name variants (in same commit)
- ModelRegistry stores list of mappings per publicModel; new `getAll()` API
- `modelVariants.ts` — `expandVariants()` (dash↔dot, date suffix, Bedrock prefix, Vertex `@`)
- `formatUpstreamModel()` per provider type
- ModelResolver lookups now go through getAll + variants
- 11 new tests in `modelVariants.test.ts`

### UI tunes (uncommitted in this session)
- Models page: i18n keys `page.models`, `desc.models` (EN/VI). Added Edit/Test/Delete buttons with proper CSS (`.modelActionBtn`, `.modelEditForm`, `.modelTestResult`).
- ApiInfoPanel: new "Client setup" section showing OpenAI base_url (`http://host:3100/v1`) vs Anthropic base_url (`http://host:3100`). Tunnel/Tailscale UI hidden in EndpointTab pending backend.
- FaqPanel: added "Where do I see usage trends over time?" entry pointing to Usage page.

### OpenSpec proposals — 4 written, all 4 artifacts validated by OpenSpec CLI
| Change | Tasks | Files |
|---|---|---|
| `usage-time-series-charts` | 19 | proposal+design+tasks+2 specs |
| `latency-observability` | 22 | proposal+design+tasks+4 specs |
| `spending-caps` | 24 | proposal+design+tasks+2 specs |
| `semantic-response-cache` | 25 | proposal+design+tasks+2 specs |

### Implementation status

**P1 — usage-time-series-charts: DONE (15/19 tasks)**
- Backend: `UsageService.aggregate()` + helper `floorToBucket()` + 30s cache + `/admin/v1/usage/aggregate` endpoint with zod validation
- Frontend: `UsageChartsPanel.tsx` with 3 tabs (Trend/Proportion/Top) + metric switcher (cost/tokens/requests). Lazy-loaded so recharts ships in separate chunk
- 11 tests added (`usageAggregate.test.ts`), all pass
- Build verified: `UsageChartsPanel-Cx--bs1L.js` (415 KB) is separate from main entry chunk
- FaqPanel updated
- TODO: 2.7 manual smoke (user) and 3.4 visual check, 4.1 notes (this file)

**P2 — latency-observability: PARTIAL (~14/22 tasks)**
- `LatencyTrackerService.ts` (HDR histogram, 5-slot rolling 5-min window, LRU cap 2000) + 9 tests pass
- Decorated `app.latencyTracker`, started/stopped via app lifecycle
- Wired `record({...ok:true/false})` in openai.ts and anthropic.ts (stream + non-stream + failure paths)
- `GET /admin/v1/metrics/latency` admin endpoint
- `GET /metrics` Prometheus exporter merges existing `MetricsService.toPrometheus()` + new histogram. Honors `METRICS_PUBLIC=true` env to bypass auth.
- 5 endpoint tests added (`latencyEndpoints.test.ts`), all pass
- `LatencyPanel.tsx` written (top-10 by p95, 30s refresh)
- TODO: insert `<LatencyPanel />` into Overview page; i18n EN/VI keys; manual smoke; notes

**P3 — spending-caps: NOT STARTED**
**P4 — semantic-response-cache: NOT STARTED**

## TODO for next session

1. Finish P2: insert LatencyPanel into Overview, i18n, manual smoke
2. Start P3 spending-caps: `SpendLedgerService` + ApiKey/Team fields + pre-flight enforcement + post-completion settle + admin endpoints + UI
3. Start P4 semantic-response-cache: `ResponseCacheService` + cache modes + per-key override + admin stats/flush + dashboard cache card
4. Manual UI smoke for P1 charts (open Usage, switch Trend/Proportion/Top, switch metric)
5. Update FaqPanel + notes for P2 once Overview wiring lands

## Verification cumulative (Phase 32)
- Gateway tsc: clean
- Gateway tests: **443 pass + 7 skipped** (was 371 baseline → +72: 11 aggregate, 9 latency tracker, 5 latency endpoints, 11 spend ledger, 7 spend endpoints, 23 cache service, 6 cache endpoints)
- Dashboard tsc: clean
- Dashboard build: ~5-7s, recharts code-split confirmed
- Manual UI smoke: chưa exercise (user sẽ test khi đủ thời gian)

## Phase 32 — All 4 proposals IMPLEMENTED

**P1 usage-time-series-charts** — DONE. Backend aggregate + lazy charts panel.
**P2 latency-observability** — DONE. Tracker + admin/Prometheus endpoints + Overview LatencyPanel + i18n.
**P3 spending-caps** — DONE (backend + basic UI). Hold-and-settle ledger + 429 enforcement + persistence + admin endpoints + ApiKeyEditModal Limits inputs.
**P4 semantic-response-cache** — DONE (backend + ApiKey field, no dashboard UI). LRU+TTL cache + buildCacheKey + resolveCacheMode + openai.ts wiring + admin stats/flush + cacheMode field.

## Next session

1. Manual UI smoke browser (all 4 proposals).
2. Commit all uncommitted work.
3. Optional polish: spending caps key-list badge + team modal; cache UI card on Overview + cached tag on RequestLogs + cacheMode dropdown.
4. Anthropic route cache wiring (P4 task 3.3).
5. Update FaqPanel for cache_control documentation.
