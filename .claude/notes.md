# Session Notes — 2026-05-27 (Phases 19 → 23)

## Latest commits
- `8ef76ee` Phase 23 — RequestLogs column selector + method filter
- `a3ca8fa` Phase 22 — Audit log viewer enhancements
- `c41e8d2` Phase 21 — Public /pricing read-only page
- `414a828` Phase 20c — Group routing + statusCodeMapping consume
- `4ba039e` Phase 20b — Channel override + priority
- `340b5c1` Phase 20a — Token hardening + batch UX
- `c8156bc` Phase 19 — Dashboard UI for new-api features
- `be4b82e` Phase 17-18 + new-api integration

## Phase 23 (commit `8ef76ee`)
- `RequestLogs` (App.tsx): method filter dropdown, search now matches `apiKeyHash`
- Column selector menu (method/route/status/duration/time/actor) với localStorage persistence (`rl.columns`)
- Conditional rendering per visibleCols

## Phase 22 (commit `a3ca8fa`)
- `AuditLogs` (App.tsx) thêm filters:
  - Action family dropdown (api_key, provider_instance, ...)
  - Target type dropdown (auto-derived)
  - Date range (1h/24h/7d/30d/all)
- Header hiện "filtered/total events"

## Phase 21 (commit `c41e8d2`)
- Backend `routes/public.ts`: `GET /v1/pricing`, `GET /v1/public/models` (no auth)
- Frontend `PublicPricingPage.tsx` — table view với search, table styling tối giản, không cần admin
- `main.tsx` route `/pricing` → PublicPricingPage; rest stays in App
- Static plugin SPA fallback đã có sẵn → `/pricing` serve `index.html` → JS routes correctly

## Phase 20c (commit `414a828`)
- `ProviderInstance.groupName`, `ApiKey.crossGroupRetry`
- `ModelResolver` filter routing_profile candidates by key's group; fallback all groups when crossGroupRetry=true
- `interpretStatusCode(instance, status)` helper: exact key wins over family (`401` beats `4xx`)
- 3 adapters consume mapping: `disable` → ProviderAuthError, `retry` → ProviderRateLimitError
- ApiKeyEditModal: Cross-group toggle. ChannelOverridesEditor: Group name field
- 10 new tests (groupRoutingAndStatusMapping)

## Phase 20b (commit `4ba039e`)
- `ProviderInstance.paramOverride`, `headerOverride`, `statusCodeMapping`
- `applyChannelOverrides` helper, reserved-header guard
- 3 adapters wired: GenericOpenAI, Anthropic, Azure OpenAI
- ModelResolver priority sort routing_profile candidates
- ChannelOverridesEditor UI với JSON validation

## Phase 20a (commit `340b5c1`)
- `ApiKey.expiresAt`, `allowedModels`, `allowedIps`, `groupName`
- `enforceKeyPolicy` middleware (centralized: expiry/IP/model/balance)
- `ipMatch` util (ipaddr.js, IPv4+IPv6+CIDR)
- ApiKeyEditModal 3 tabs, batch ops, CSV export

## Phase 19 (commit `c8156bc`)
- ModelPricingSection, TopupModal, TestAllResultsModal, SyncModelsModal
- Backend endpoints, root.test.ts fix, UsagePage cost cleanup

## Verification cumulative
- Gateway tsc: clean
- Gateway tests: 320/320 pass (was 267 baseline + 53 mới across Phase 20a/b/c)
- Dashboard tsc: clean
- Dashboard build: ~5s
- Manual UI smoke test: chưa exercise cho cả 5 phase

## TODO for next session

### Manual verification
- Start gateway + dashboard, exercise:
  - All Phase 19 features (pricing, topup, test all, sync)
  - Phase 20a (expire, IP, model whitelist, batch)
  - Phase 20b (paramOverride upstream, priority routing)
  - Phase 20c (group routing scenarios, statusCodeMapping)
  - Phase 21 (open `/pricing` không login)
  - Phase 22/23 (filters audit logs + request logs)

### Optional future work
- Wire param/header override cho các adapter còn lại (Vertex AI, OAuth providers — mỗi adapter signed flow khác)
- Channel affinity cache (sticky for cache prefix hit)
- Logs page riêng theo new-api UsageLogsTable design (tab page level, không chỉ section)
- Dashboard chunking (vite warning > 500kB)
- Per-key transaction history detail panel
