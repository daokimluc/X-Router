## 1. Pipeline + protocol-handler seam

- [x] 1.1 Define a `ProtocolHandler` interface: `invoke(adapter, upstreamModel, ctx)`, `writeStream(reply, stream, requestId)` → PipelineUsage, `decode(resp)` → {body, usage, cacheable}, `writeCache(resp)`. (`routes/pipeline/ProtocolHandler.ts`.)
- [x] 1.2 Implement `RequestPipeline.handle(request, reply, handler, candidates, reasoningEffort)`: queue+concurrency acquire → candidate iterate → circuit admit → lease → invoke via handler → record usage → settle/release → marketplace settlement → latency → uniform cleanup. One failover loop with explicit classification (`classifyError`): retryable → next attempt; capacity (NoAvailableAccount/overloaded/circuit-open) → next candidate; terminal → fail-settle + throw. (`routes/pipeline/RequestPipeline.ts`.)
- [x] 1.3 Cleanup centralized: every exit (success/terminal/exhausted/capacity/mid-stream/early-return) resolves the breaker once via `recordResult`/`releaseProbe` and `failSettle` releases reservations; global onResponse hook (persistence-durability) is the final reservation backstop.

## 2. OpenAI + Anthropic handlers

- [x] 2.1 `OpenAIProtocolHandler` — chatCompletions invoke + stream/decode usage (estimate fallback) + tool_calls cache-skip. (`routes/pipeline/OpenAIProtocolHandler.ts`.)
- [x] 2.2 `AnthropicProtocolHandler` — native `messages()` preferred, chatCompletions fallback; tool_output compression; F4 estimate; F5/F6b tool_use cache-skip + Anthropic-shaped body cached/returned. Moved toOpenAIChatRequest/toAnthropicResponse/writeAnthropicStream/normalizeUsageShape into this module.
- [x] 2.3 Rewrote routes/openai.ts + routes/anthropic.ts as thin wrappers (parse → direct-route → cache lookup → resolve+rank → 404-if-empty → `pipeline.handle`). Deleted the duplicated lifecycle (~640 + ~1070 lines → ~230 + ~270).

## 3. Fold in the verified drift bugs (now single-source)

- [x] 3.1 F1 — RequestQueue acquire/release wired once in the pipeline (applies to both routes; release() in finally wakes any waiter regardless of protocol).
- [x] 3.2 F2 — `consumeTokens` recorded for streaming on both protocols (single `recordSuccessUsage`).
- [x] 3.3 F3 — reservation released + failure settlement on all-candidates-exhausted (`failSettle`).
- [x] 3.4 F4 — success-without-usage settles against an estimate (handlers always return concrete PipelineUsage).
- [x] 3.5 F5/F6b — one cache guard (skip tool_use) + Anthropic-shaped body on hit (decode/writeCache).
- [x] 3.6 R3 — capacity/admission errors fail over instead of aborting (`classifyError` → capacity).
- [x] 3.7 stream-error path records latency; `no_provider_in_group` 404 + cache-hit release reservation (global onResponse hook). Half-open circuit resolve comes from resilience-hardening; pipeline calls the corrected breaker.

## 4. Verification

- [x] 4.1 Gateway `tsc` clean.
- [x] 4.2 Parity pass: openai/anthropic/streaming/failover/tool-calling suites green unchanged (31 in the parity set).
- [x] 4.3 New tests: requestPipeline.test.ts (classification/R3) + pipelineDriftFixes.test.ts (F4 success-no-usage, F2 stream tokens, R3 failover).
- [x] 4.4 Full suite green (664 pass / 7 skip, was 658).
- [x] 4.5 `openspec validate request-pipeline-unification --strict` passes.

## 5. Coordination notes

- [x] 5.1 Landed AFTER resilience-hardening (half-open breaker via recordResult/releaseProbe) and persistence-durability (early-return reservation leak via global onResponse hook) — the pipeline calls the corrected breaker and relies on the shared reservation backstop, so the fixes live once.
