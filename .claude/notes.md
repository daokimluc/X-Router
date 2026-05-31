# Session Notes — 2026-05-28 (Phase 32: audit fixes + 4 OpenSpec proposals)
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

## Phase 32 — All 4 proposals IMPLEMENTED + UI polish

**P1 usage-time-series-charts** — DONE. Backend aggregate + lazy charts panel.
**P2 latency-observability** — DONE. Tracker + admin/Prometheus endpoints + Overview LatencyPanel + i18n.
**P3 spending-caps** — DONE. Hold-and-settle ledger + 429 enforcement + persistence + admin endpoints + ApiKeyEditModal Limits inputs + key-list SpendBadge + team modal spend inputs + team-list SpendBadge.
**P4 semantic-response-cache** — DONE. LRU+TTL cache + buildCacheKey + resolveCacheMode + openai.ts + anthropic.ts wiring + admin stats/flush + cacheMode field + Overview CachePanel + ApiKeyEditModal cacheMode dropdown + EN/VI i18n + FaqPanel entry.

## Phase 33 — Kiro tool calling (Anthropic Messages protocol)

**Why:** Claude Desktop (Anthropic Messages API + MCP tools) connected through gateway returned only intro text ("Để mình xem qua thư mục…") and stopped — no `tool_use` blocks. Cline (OpenAI mode) worked because Cline parses XML in text. kiro.rs and new-api both supported it, so the upstream Kiro/CodeWhisperer service is capable; the gateway was the bottleneck.

**Root cause (4 strip layers, all fixed):**
1. `validation/openaiSchemas.ts` — schemas had no `tools`/`tool_choice` fields, zod stripped them on `.parse()`. Now `.passthrough()` everywhere.
2. `routes/anthropic.ts` — non-stream + stream path both forced `toOpenAIChatRequest` + `chatCompletions`, dropping native Anthropic shape. Now prefers `adapter.messages()` when available.
3. `KiroProviderAdapter.anthropicToKiroMessages` — filtered to text-only blocks. Now preserves `tool_use` (→ assistant `toolUses` history) and `tool_result` (→ user `toolResults`).
4. `KiroClient.buildKiroPayload` — hardcoded `userInputMessage: { content, modelId, origin }` with no `userInputMessageContext`. Now builds `{ tools: [{ toolSpecification }], toolResults }` from request.

**Stream path:** `ProviderStream` gained optional `events?: () => AsyncIterable<ProviderStreamEvent>` (text_delta | tool_use_start | tool_use_delta | tool_use_stop | message_stop). `KiroClient.kiroEventStream` parses `toolUseEvent` frames and accumulates partial-JSON `input` per `toolUseId`. `routes/anthropic.ts` `writeAnthropicStream` switches to structured emission when `events()` is present — emits `content_block_start{type:tool_use,id,name}` + `input_json_delta` deltas + `content_block_stop`, sets `message_delta.stop_reason: "tool_use"`.

**Other fixes:**
- `NormalizedAnthropicResponse.content` widened to `Array<text | tool_use>` discriminated union.
- `mapAnthropicStopReason` extended with `tool_use → tool_calls`.
- `ResponseCacheService.resolveCacheMode` skips when `hasTools` (cached tool_use responses depend on partial conversation state and tool definitions).

**Tests added:** 4 in `kiroToolUse.test.ts` — payload `userInputMessageContext.tools`, payload `toolResults` + history `toolUses`, stream `events()` order, non-stream tool_use entry collection.

**Verification:** gateway tsc clean, 447 pass + 7 skip (was 443 + 7), build clean.

**Out of scope (next session if needed):**
- Manual Claude Desktop smoke (restart gateway port 3100, point Claude Desktop at `http://localhost:3100`, ask for tool call, verify tool execution).
- OpenAI native tool calling (Cline doesn't need it — uses XML workaround). Skipped to keep scope small.
- kiro.rs heuristics not ported: tool name shortening (>63 chars), JSON schema normalization, thinking prefix injection, system chunked policy, prefill stripping, orphaned tool_use/tool_result pairing validation. Add when needed.

## Phase 33b — Anthropic adapter tool calling (P1 follow-up)

**Why:** After Phase 33 (Kiro), audit found `AnthropicMessagesAdapter` had 3 strip points on the OpenAI client → real Anthropic API path. Anyone proxying their Anthropic API key through x-router with tool calling would hit the same symptom.

**Fixed (4 commits worth, single session):**
1. `translateOpenAIToAnthropic` (line 408+) — was rebuilding body from scratch with only `model/max_tokens/messages/stream`. Now: forwards `temperature`, top-level `system` (from system-role messages), `tools` (translated `{type:function,function:{name,description,parameters}}` → `{name,description,input_schema}`), `tool_choice` (translated `auto/none/required/{type:function,function:{name}}` → Anthropic `{type:auto/none/any/tool,name?}`). Also handles assistant messages with `tool_calls` → Anthropic `tool_use` blocks, and `tool` role messages → Anthropic `user` with `tool_result` block.
2. `normalizeAnthropicContent` — was filtering to `type==="text"` only, dropping upstream `tool_use` blocks. Now preserves both as `AnthropicContentBlock[]`.
3. `normalizeStopReason` — was returning `null` for `"tool_use"`. Now returns `"tool_use"` directly (the type was widened in Phase 33).
4. `translateAnthropicToOpenAI` — when response has `tool_use` blocks, populates `message.tool_calls: [{id,type:"function",function:{name,arguments:JSON.stringify(input)}}]` alongside `content` (text from text blocks only).

**Type addition:** `OpenAIToolCall` exported from `base/types.ts`; `NormalizedOpenAIResponse.choices[].message.tool_calls?: OpenAIToolCall[]`.

**Tests:** 4 in `anthropicAdapter.test.ts` — tools/tool_choice/system forwarded; OpenAI tool_calls + tool message → Anthropic tool_use/tool_result; tool_calls populated when upstream returns tool_use; native `messages()` preserves tool_use + stop_reason. Total: 451 pass + 7 skip (was 447 + 7).

**Still drops tools (not fixed in P1):**
- `codex/CodexAdapter.translateToCodex` (line 306+) — Codex Responses API.
- `vertex-ai/VertexAIAdapter` + `antigravity/AntigravityAdapter` — Gemini shape, needs `functionDeclarations` mapping.
- `routes/anthropic.ts handleDirectAnthropicRouting` fallback chatCompletions path (rare — only when client sends `x-provider-account-id` header AND adapter has no `messages()`).
- `AnthropicMessagesAdapter.createAnthropicStream` yields raw SSE lines that get double-wrapped by `writeAnthropicStream`. Not exercised in current routing because the route path always re-encodes. If adapters were ever piped directly to clients, this would break.

**Adapters confirmed OK (forward tools via spread/passthrough):** github-copilot, azure-openai, generic-openai, oauth-pkce, no-auth.

## Phase 33c — Full tool-calling sweep + critical stream bug (P2/P3)

**Critical bug found & fixed — `writeOpenAIStream` double-wrap (`utils/sse.ts`):** the OpenAI stream writer wrapped EVERY adapter chunk into `delta.content`, even when the adapter already yielded SSE-formatted `data: {...}` blocks (Codex, Azure, GenericOpenAI, Copilot, oauth-pkce, no-auth all yield raw upstream SSE). This corrupted ALL structured fields (tool_calls, role, finish_reason) for OpenAI-protocol streaming — not just tools. Fix: decide passthrough-vs-wrap ONCE from the first non-empty chunk (an adapter's stream is uniform), relay SSE blocks verbatim, only wrap plain-text deltas. Per-chunk classification was rejected because a `data:` block can split across network reads (regression test added). Also made `writeOpenAIStream` events-aware: when a stream exposes `events()`, render text + tool_use as proper `delta.tool_calls` chunks — this closes Kiro/Anthropic tool calling on the `/v1/chat/completions` route too.

**Codex (`CodexAdapter.ts`):** `transformToCodexFormat` now forwards tools (translated to flat Codex shape `{type:"function",name,description,parameters}`), tool_choice, and handles assistant `tool_calls` → `function_call` input items + `tool` role → `function_call_output`. New module-scope `extractCodexEvent` parses `response.output_item.added`(function_call) + `response.function_call_arguments.delta` → stream emits `delta.tool_calls`; `collectCodexResponse` accumulates them into `message.tool_calls`.

**Vertex + Antigravity (Gemini shape):** both now map tools → `tools[].functionDeclarations`, tool_choice → `toolConfig.functionCallingConfig.mode` (AUTO/NONE/ANY + allowedFunctionNames), assistant tool_calls → `functionCall` parts, `tool` role → `functionResponse` part. Responses + streams surface Gemini `functionCall` parts as OpenAI `tool_calls`. **Vertex `createSSEStream` previously yielded raw Gemini JSON** (pre-existing corruption, same class as the writeOpenAIStream bug) — now converts to OpenAI chunks. Both flag `tool_calling` capability.

**Anthropic adapter stream (`createAnthropicStream`):** was yielding raw upstream SSE lines that `writeAnthropicStream` double-wrapped. Rewritten to parse upstream Anthropic SSE into the uniform ProviderStream: `[Symbol.asyncIterator]` (text only) + `events()` (text + tool_use) + `usage()`. New module helper `parseSSEDataLine`.

**Direct-routing fallbacks:** `routes/anthropic.ts handleDirectAnthropicRouting` + main `toOpenAIChatRequest` now translate tools/tool_choice (Anthropic↔OpenAI shapes) and `toAnthropicResponse` surfaces `tool_calls` → `tool_use` blocks with `stop_reason:"tool_use"`. `openai.ts handleDirectAccountRouting` passes full body (tools included) — already OK.

**Tests added (+11):** anthropic stream events; 2 codex tool (forward + stream); antigravity tool; openai-route events→tool_calls; SSE passthrough preserves tool_calls; split-chunk relay regression. Total: **458 pass + 7 skip** (was 443 at start of Phase 33).

**Still not done (low priority):**
- Windsurf cloud-chat path drops tools — but it's `describe.skip` legacy (Windsurf is FIM/autocomplete, not tool-calling chat). Left as-is.
- kiro.rs heuristics still not ported (tool name shortening >63 chars, JSON schema normalization, orphaned tool_use/result pairing validation, thinking prefix, system chunked policy, prefill stripping). Add only if upstream 400s appear.
- mock adapter (test-only) — n/a.

## Phase 33d — multi-turn validation fix (same session)

**Bug:** `openAIChatCompletionRequestSchema` required `content` as `string | array` (line ~8). But per the OpenAI spec, an assistant turn that made tool calls comes back on the NEXT request with `content: null`. That second turn was rejected at validation (400) — first turn worked, follow-up broke. Cline and other OpenAI clients send this routinely.

**Fix:** schema `content` now `z.union([string, array, z.null()]).optional()`. `OpenAIChatMessage.content` type widened to `content?: string | array | null` (+ already-added `tool_calls?`, `tool_call_id?`). Hardened the OpenAI→Anthropic `translateOpenAIToAnthropic` user/assistant fallthrough branches to coerce non-string/non-array content to `""` instead of casting null as array. Verified downstream readers (`stringifyMessageContent`, codex/gemini transforms, openai.ts token estimation with `?? ""`) are all null-safe.

**Tests:** +2 — `openaiRoute` multi-turn (assistant content:null + tool role → 200, not 400); `anthropicAdapter` content:null → only tool_use block emitted (no spurious empty text). **Total: 460 pass + 7 skip.**

## Releases shipped to npm (@daokimluc/x-router, public)

- **0.3.0** — Phase 33 tool-calling sweep + dashboard clipboard fix. Committed in 3 commits (`5ac6e2f` clipboard, `e0f417b` tool calling, `63b4be3` notes) + `d3535e3` release. Tag v0.3.0.
- **0.3.1** — admin password feature (below). Commit `e060b14`, tag v0.3.1.

Both pushed to origin/main and published. Global install updated to 0.3.1.

## Admin password feature (0.3.1)

**Why:** User found login broke — `admin123`/`admin` both rejected. Root cause was twofold: (1) the user's `~/.x-router/config.json` held an old random key `xra_de53...` that overrode the `"admin"` default (bin only sets default when `!cfg.adminApiKeys`); (2) the gateway snapshotted `config.adminApiKeys` into `new Set()` at startup in each auth middleware, so "Change Password" could never actually change the live key — it only validated and told users to edit .env + restart. Also the login page's "Default password:" hint rendered with no value after it.

**What shipped:**
- `services/AdminKeyService.ts` — single source of truth for admin key(s). Mutates `config.adminApiKeys` **in place** (same array ref middleware reads → runtime change, no restart). Persists to `~/.x-router/config.json` as comma-separated string (CLI-readable). API: `isValid`/`isDefault`/`list`/`setKey`(min 4 chars)/`reset`(→"admin"). Exports `DEFAULT_ADMIN_KEY = "admin"`. Constructor takes `{ persistPath }` for test injection.
- Decorated `app.adminKeyService` in app.ts (injectable via deps for tests). Wraps `config.adminApiKeys`.
- `middleware/adminAuth.ts` + `readyz.ts` + `metrics.ts` — read `config.adminApiKeys.includes(token)` live per-request instead of `new Set()` snapshot. (internalApiKeys still snapshotted — those don't change at runtime.)
- `routes/admin.ts` — `POST /admin/v1/settings/change-password` now persists via `adminKeyService.setKey()` (was a validate-only stub); new `POST /admin/v1/settings/reset-password` → resets to "admin".
- `routes/public.ts` — `GET /v1/public/auth-info` (unauthenticated) returns `{ isDefaultPassword, defaultPassword }` so the login page shows the hint only on first run.
- Dashboard `LoginScreen` — fetches auth-info on mount, shows `Default password: <code>admin</code>` only when still default. Settings — new "Reset Password" button + handler. EN/VI i18n keys `settings.resetPassword*`.
- `bin/x-router.js` — `--reset-admin-key` flag (lockout recovery): rewrites config.json adminApiKeys → "admin" and exits. Added to --help.

**Gotcha fixed:** `await reply.code(400)` in a Fastify handler HUNG the response (unsettled). Use `reply.code(400)` without await, then `return payload`. The success (200) path was fine; only the error path hung — that's why the first endpoint test timed out at 5s.

**Tests:** +9 in `test/adminPassword.test.ts` (AdminKeyService unit w/ temp persistPath + change/reset/auth-info endpoints w/ injected service). **Total: 469 pass + 7 skip.** Gateway+dashboard tsc clean, build clean. CLI flag verified manually with temp HOME.

**User's machine note:** their `~/.x-router/config.json` was manually set to `adminApiKeys: "admin"` earlier this session, so they log in with `admin`.

**Still deferred:** title still says "Internal AI Gateway" (old branding in `apps/dashboard/index.html`, present in 0.3.1) — user aware, not yet changed. npm tarball still bundles `dist/test/**` (~335 files) — should add to .npmignore eventually.

## 0.3.2 — update command + copy button + X-Router rebrand

- `VersionBadge.tsx` — when `hasUpdate`, now renders the literal command `npm i -g @daokimluc/x-router@latest` in a `.brandUpdateCmd` box with a copy button (Copy/Check icon toggle, uses `copyText` helper so it works over plain HTTP/LAN). CSS added in styles.css (`.brandUpdateCmd`, `.brandUpdateCopyBtn`).
- Rebrand: `login.title` "AI Gateway" → "X-Router" (both EN+VI blocks in i18n.ts); `apps/dashboard/index.html` `<title>` "Internal AI Gateway" → "X-Router". Now matches badge / CLI banner / npm package name. (Remaining "AI Gateway" strings in App.tsx ASCII diagrams + UsagePage node label left as-is — not branding-critical.)
- Dashboard-only change (no gateway logic) → gateway tests untouched. Dashboard tsc clean, build clean, built dist title verified = X-Router.
- Commit `da4158d`, tag v0.3.2, pushed, published to npm, global updated to 0.3.2.

## 0.3.3 — data file moved to ~/.x-router (was "data lost" bug)

**Symptom:** user ran `x-router` (global) and Usage page (+ accounts/logs) showed empty — "mất hết dữ liệu".
**Root cause:** `DATA_FILE` defaults to RELATIVE `data/gateway-state.json` (config.ts:26). The bin never pinned it, so the gateway read/wrote state in whatever cwd `x-router` was launched from. Dev gateway ran from `apps/gateway` → real data at `apps/gateway/data/gateway-state.json` (197KB, 27 usage + 500 logs). Global launched from elsewhere → empty fresh file. **Data was never lost.**
**Fix:** `bin/x-router.js` now pins `DATA_FILE` to `~/.x-router/gateway-state.json` (constant `DATA_PATH`) in BOTH the spawn and `--no-menu` paths, alongside config.json. Explicit `DATA_FILE` env still overrides. Help text updated.
**Data migration done:** copied the 197KB `apps/gateway/data/gateway-state.json` → `~/.x-router/gateway-state.json` (verified 27 usage / 500 logs / accounts / apiKeys intact) so the global instance sees the history.
**Released:** commit `e5df0d9`, tag v0.3.3, pushed, published to npm (registry latest=0.3.3).

**IMPORTANT user feedback (this session):** user said "đừng tự update nhé" — do NOT run `npm i -g` to update the global install automatically anymore. Publish to npm is OK (user confirmed), but leave the global update for the user to do. Global still on 0.3.2 as of this commit. See [[feedback-dont-auto-update-global]].

## Distribution switched to PRIVATE via GitHub Packages (post-0.3.3)

**Why:** user worried the public npm package let anyone download + reuse + rebuild the code. Confirmed it did (335 files incl. full built `dist/` — only the *names* on npm UI looked like "3 folders"; inside `dist/` is the whole logic). No credentials were ever in the package, but the logic was public.

**What was done:**
- User **deleted the package from public npm** via the web UI (Danger Zone → Delete package). CLI unpublish was blocked by npm's mandatory OTP-for-unpublish (token auth can't satisfy it). Verified gone: `registry.npmjs.org/@daokimluc/x-router` → 404.
- GitHub repo `daokimluc/X-Router` is **private** (confirmed: unauthenticated API → 404).
- Switched `package.json` `publishConfig` from `{access:public}` to `{registry:"https://npm.pkg.github.com"}` (commit `1d1056f`). `npm publish` now goes to **GitHub Packages** (private), republished 0.3.3 there. Verified readable with token.
- **fine-grained PATs do NOT work** with GitHub Packages npm registry → `403 token does not match expected scopes`. Must use **classic** token: `read:packages`+`repo` to install, `write:packages`+`repo` to publish. (Verified by testing a fine-grained token → 403; classic publish token → worked.)
- Distribution model chosen: **each user makes their own classic token** on their own GitHub account; admin invites them as repo Collaborator (Read). Considered a shared read-only token but fine-grained can't scope it to one repo and classic `repo` scope reads ALL the owner's private repos — rejected as too risky.
- Added `INSTALL.md` (commit `a32f58e`) with two sections: **For Users** (token + .npmrc + install/update) and **For the Admin** (deploy:local, publish auth, release flow, collaborator management, scripts table, security notes).
- Added `deploy:local` script (`a32f58e`/`39cac5f`): `npm run build:all && npm i -g .` — admin updates their OWN global from local source, no token/registry needed.

**Update-check feature status:** `routes/admin.ts` `/admin/v1/version` hardcodes `fetch("https://registry.npmjs.org/@daokimluc/x-router/latest")`. Since the package was removed from public npm, this returns 404 → `hasUpdate=false` → **the in-app update badge is effectively OFF during the private/GitHub-Packages phase.** User chose to LEAVE IT AS-IS. If the package is ever republished to public npm, the badge auto-works again (no code change needed).

**If user later wants PUBLIC npm again (they said this is the plan "someday"):**
1. Change `publishConfig` back to `{ "access": "public" }` (remove the GitHub Packages registry line).
2. Wait past the 24h name-lock from the unpublish (deleted 2026-05-29) — npm blocks republishing the same name for 24h. Name is NOT lost, just locked.
3. `npm whoami` (re-`npm login` if token expired) → `npm run build:all` → `npm publish`.
4. Update badge resumes automatically. Consider license (currently MIT = anyone can reuse) before going public.

**Security TODO for user (tokens pasted in chat this session):** revoke publish token `ghp_9PgL...` and the fine-grained `github_pat_11AF...`, regenerate, then `npm config set //npm.pkg.github.com/:_authToken=<new>`.


## Phase 34 — Open-core split + P2P marketplace (in progress 2026-05-30)

See memory `project_open_core_architecture.md` + `project_p2p_marketplace_design.md` for full detail.

**OpenSpec:** all 7 marketplace changes written + `validate --strict` clean: usd-wallet, hourly-spend-buckets, marketplace-plans, seller-supply, lowest-cost-routing, two-sided-settlement, provision-webhook. Explore-only until now.

**Open-core scaffolding DONE (uncommitted):** `config.marketplaceEnabled` + `MARKETPLACE_ENABLED` env (default false); `marketplace/index.ts` `registerMarketplace(app,{config,persistedState})` empty seam; `marketplace/README.md`; single dynamic-import call site in app.ts (after web routes, before dashboard plugin); `test/helpers.ts` +marketplaceEnabled:false; `test/marketplaceBoundary.test.ts` guards "engine never imports marketplace/". Verify: tsc clean, **471 pass + 7 skip**, boots flag on+off.

**INVARIANT:** engine (apps/gateway/src/ outside marketplace/) MUST NOT import marketplace/. One-way dep marketplace→engine. All 7 changes' code → `apps/gateway/src/marketplace/`.

**Active /goal:** implement 7 changes in dep order, no asking, start→finish. Stop hook armed. TaskList #1-#7 created with blockedBy chain (1→{2,3}→4→5→6→7).

**Currently on #1 usd-wallet (BREAKING, not yet coded).** Full touch-point map + seam architecture (3 engine seams: policy-hook array, persistence contributor slice, app.persistState() helper) in memory file. Next concrete step: write `marketplace/utils/money.ts` + `marketplace/services/WalletService.ts`, then repoint ApiKeyService token methods → wallet, gate enforceKeyPolicy step-5 behind wallet via the policy-hook seam (NOT a direct app decoration — that'd violate the boundary since app.ts is engine).

## Phase 34 — ALL 7 CHANGES IMPLEMENTED (2026-05-30, uncommitted)

Full detail in memory `project_open_core_architecture.md`. Summary:

**All 7 marketplace changes implemented into `apps/gateway/src/marketplace/` behind MARKETPLACE_ENABLED flag, one-way engine→marketplace boundary held (boundary test green):**
- #1 usd-wallet · #2 hourly-spend-buckets · #3 marketplace-plans · #4 seller-supply · #5 lowest-cost-routing · #6 two-sided-settlement · #7 provision-webhook

**Verify:** gateway **569 pass + 7 skip** (was 469 at session start), gateway+dashboard tsc clean, dashboard build clean, all 7 `openspec validate --strict` pass.

**4 engine seams added** (engine never imports marketplace): MarketplaceSeam (keyPolicyChecks[] + persistenceContributors[] + settlementHooks[]), app.persistState(), PersistedGatewayState.marketplace opaque slice, config flags (marketplaceEnabled, provisionApiKeys).

**Deferred (tracked):** dashboard UIs for #4/#5/#6 (specs say website-driven/fallback); anthropic.ts settlement parity; #7 edge emits (grant.exhausted/wallet.low/supply.unhealthy) + bin --set-provision-key flag; request.routed cheapest-approximation.

**NOT committed.** On branch main — branch off before committing (ask user re: commit strategy: per-change vs one Phase-34 commit). Then `openspec archive` per change when accepted.

## Phase 34b — 5 post-audit hardening changes ALL DONE (2026-05-30)

Branch `feat/phase34-marketplace`. 5 commits, one per change:
- `d08fe7c` #1 persistence-sqlite — WalletService + SellerEarningsLedger → SQLite (node:sqlite DatabaseSync, WAL, transactions). New services/Database.ts. SpendLedger stays JSON (scope-narrowed).
- `818bdd7` #2 money-correctness — settle-buyer-first → credit from COLLECTED (conservation collected===credit+margin); unlisted-route fallback cost (never $0); refund/reverse primitives; new SettlementLedger (settlement_log + reverseSettlement + reconcile). DB v2 migration; transaction() made reentrant.
- `67b60c9` #3 marketplace-lifecycle — provision key disable/enable/revoke/expire/list; admin wallet refund/debit, earnings reverse/adjust, settlement reverse, listing re-price, seller-term edit, canonical-model add/remove, markup-override delete.
- `46141c2` #4 admin-marketplace-ui — apps/dashboard MarketplacePage (lazy chunk, 8 sub-tabs), gated by marketplaceEnabled from /v1/public/auth-info. EN/VI i18n.
- `8c65397` #5 provision-hardening — encrypt webhook secret at rest; rate-limit privileged /provision/* (PROVISION_RATE_LIMIT_PER_MINUTE, default 120); trust-model docs (§7 MARKETPLACE_INTEGRATION.md); fix payoutRef drop + usd/amountUsd dual-accept.

**Verify:** gateway 622 pass + 7 skip (was 590 at Phase-34b start), gateway+dashboard tsc clean, dashboard build clean (MarketplacePage separate 28.77kB chunk), all 5 `openspec validate --strict` pass. Engine→marketplace boundary held throughout (boundary test green).

**NOT merged to main, NOT archived.** Next: user decides merge of feat/phase34-marketplace → main, then `openspec archive <change>` per change. Manual smoke deferred (each tasks.md has a 6.3/7.3/8.3 manual item for the user).

## Phase 34c — 7 code-gap fixes (2026-05-31, post-34b audit)

User asked to fix all gaps found after 34b. Branch `feat/phase34-marketplace`, one commit. All 7 done:
1. **LowestCostStrategy trap** — degraded gracefully (least-busy/priority/id fallback, no more null→NoAvailableAccountError) + wired `costFor` into pool `acquire` via new `MarketplaceSeam.setCostForBuilder`/`costForModel` seam (marketplace registers `buildCostFor`). openai.ts + anthropic.ts pass `costFor`.
2. **Encryption key via env** — `config.encryptionKey` (env `ENCRYPTION_KEY`, default `DEFAULT_ENCRYPTION_KEY`); production guard throws on default. Single encryptionService in app.ts reused for SecretService.
3. **bin provision-key flags** — added `--add-provision-key`/`--remove-provision-key` (`--set-provision-key` already existed).
4. **Books-health** — GET `/admin/v1/marketplace/reconcile/platform` + `/seller/:id` + dashboard EarningsPanel books-health card (i18n mkt.books.*).
5. **API key rotation** — `ApiKeyService.rotate(id)` + POST `/provision/key/:id/rotate` (new secret, same id/plan/wallet).
6. **UsageService→SQLite** — kept ring buffer for live UI; added durable `usage_log` (Database v3) + `UsageLogStore` (engine); UsageService.setSink mirrors every record; `/provision/usage` now reads UsageLogStore.
7. **Periodic supply health** — `marketplace/services/SupplyHealthMonitor` scans account runtime (disabled/cooldown/consecutiveFailures≥3), emits `supply.unhealthy` once per non-house account on transition, re-arms on recovery; started in registerMarketplace, stopped onClose.

**Verify:** gateway tsc clean, **631 pass + 7 skip** (was 622), dashboard tsc+build clean (MarketplacePage separate chunk), boundary green. Docs PROVISION_API_REFERENCE.md updated with rotate. See [[phase34c-gap-fixes]] memory.

## Phase 34d/34d.1/34e + Phase 34 MERGED (2026-05-31)

- 34d/34d.1: Foza integration contract — seller externalRef, walletUsd in /provision/keys, GET /provision/settlements (per-record replay), settlementId on usage.recorded webhook + requestId correlation (usage_log+settlement_log Database v4). Docs: docs/PROVISION_API_REFERENCE.md, docs/WEBSITE_INTEGRATION_REQUIREMENTS.md, D:/Project/XRouter.ai/docs/ANSWERS_FROM_XROUTER.md (XRouter.ai not a git repo).
- 34e: bug-audit fixes — mid-stream failure reservation leak (openai+anthropic), provision mutations not persisted (onSend hook now matches /provision/*), ApiKeyService id collision (monotonic nextSeq), routed-stale-on-failover, PAYG estimate ×markup, constant-time provision key compare. +2 regression tests. 637 pass.
- ALL Phase 34→34e MERGED to main (fast-forward) + pushed; 14 marketplace openspec changes archived into openspec/specs/. Remaining open changes = 4 Phase-32 ones (untouched).

## CORE ENGINE AUDIT → 5 proposals written (explore mode, NOT implemented)

Deep multi-agent read-only audit of the NON-marketplace engine. Found CRITICAL bugs verified in code. 5 OpenSpec proposals written + validated --strict, sitting in openspec/changes/ (untracked, not committed):
- resilience-hardening (🔴 circuit stuck half-open CircuitBreaker.ts:71-73,97 + refresh race / wire dead RefreshLockService + collapse dup server.ts:96 loop)
- persistence-durability (🔴 partial-save drops slices admin.ts:4240 + oauth GET; non-atomic writeFile bricks boot; hot-path full-file rewrite)
- request-pipeline-unification (🟡 openai.ts/anthropic.ts ~60% copy-paste drift → F1-F6b,R3; extract RequestPipeline+ProtocolHandler) — highest value
- admin-routes-decompose (🟢 ZodError→500 should be 400; not-found→500 should be 404; split admin.ts 4319 lines)
- non-money-state-to-sqlite (🟢 config state JSON→SQLite, after persistence-durability)

Full detail (bug list with file:line, severity, suggested order) in memory [[core-engine-audit]]. Impl order: resilience-hardening + persistence-durability first (urgent+small), then request-pipeline-unification, then the 2 LOW. Context was very full at end of audit session → implement one change per fresh session, re-read live code each time (line numbers drift).

## CORE ENGINE: ALL 5 PROPOSALS IMPLEMENTED (2026-05-31, uncommitted on main)

Gateway **675 pass / 7 skip** (was 637 baseline → +38), tsc clean, all 5 `openspec validate --strict` pass, engine→marketplace boundary green. Test the gateway with `cd apps/gateway && rtk proxy npx vitest run --root .` (plain vitest picks up unrelated workspaces and reports false failures).

1. **resilience-hardening** — CircuitBreaker: `canRequest` pure (no mutation); open→half_open moved into `beforeRequest`; new `recordResult(id,{ok,countsAsFailure},config)` = single terminal accounting + `releaseProbe(id)` for retry-without-conclude (fixes stuck-half-open-forever). RefreshLockService.`refreshIfNeeded()` serializes per-account refresh + re-checks in-lock (background skip-if-fresh, on-401 skip-if-token-rotated); wired into AutoRefreshService + both routes' on-401; deleted dup server.ts refresh loop. Tests: circuitBreaker.test.ts (7), refreshLock.test.ts (+3).

2. **persistence-durability** — PersistenceService: atomic tmp+fsync+rename + `.bak` fallback; `schemaVersion` (v1, absent→v0); concrete zod for accounts/secrets/apiKeys/modelMappings (field-path errors); `saveDebounced` single-flight + drain. Killed partial-save: extracted canonical `services/createPersistedState.ts` (listWithKeys — raw keys), pointed ALL save paths at it (saveAdminRuntimeState ×26, oauth ×3, OAuthPKCE, 2 route-local copies). onSend dropped `/v1` POST; usage hydrated from SQLite usage_log; usage+requestLogs dropped from JSON. ConfigRevisionService MAX_REVISIONS=50. Global onResponse hook releases leaked spendReservation (cache-hit/404/direct-route). Tests: persistenceDurability.test.ts (9), persistenceCompleteState.test.ts (2).

3. **request-pipeline-unification** — new `routes/pipeline/`: ProtocolHandler interface + RequestPipeline (one failover loop, `classifyError` retryable/capacity/terminal, recordSuccessUsage, failSettle) + OpenAIProtocolHandler + AnthropicProtocolHandler. openai.ts/anthropic.ts now thin wrappers. Structurally fixed F1 (queue wired once), F2 (stream consumeTokens both protocols), F3 (exhaustion failSettle), F4 (always-estimate usage), F5/F6b (tool_use cache-skip + anthropic-shaped body), R3 (capacity→failover). Tests: requestPipeline.test.ts (3), pipelineDriftFixes.test.ts (3). 31 parity suites unchanged.

4. **admin-routes-decompose** — ZodError→400 + NotFoundError→404 (new errors/NotFoundError.ts, 16 throws); FIXED latent bug: error envelope was dead for ALL routes (registerErrorHandler ran after dashboard app.register() closed the context) → moved BEFORE routes. helpers.ts (parseIdParam ×26, recordAudit ×59, findAccountPoolForAccount). Full split: admin.ts 4023→1296 lines (version+oauth-import) + 8 domain modules (catalog/observability/settings/keys/instances/accounts/testing) + index.ts registrar. +3 tests.

5. **non-money-state-to-sqlite** — Database.ts v5 (config_entities + config_kv). New ConfigStore implements shared `StateStore` (drop-in for PersistenceService), diff-on-save = single-row writes, load reconstructs + parsePersistedState. app.ts buildConfigStore = one-time marker-guarded JSON→SQLite import (file kept as rollback). Zero service call-site changes. Tests: configStore.test.ts (7), configStoreE2E.test.ts (1, boot-from-SQLite no JSON).

**NOT committed.** On branch main. Per-change manual smoke items deferred (each tasks.md). Next: commit (per-change or one "core-engine-hardening") + `openspec archive` each.
