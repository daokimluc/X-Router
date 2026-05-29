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
