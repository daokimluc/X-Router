## Why

`routes/openai.ts` (~640 lines) and `routes/anthropic.ts` (~1070 lines) implement the
**same request lifecycle** — model resolve → rank candidates → `accountPool.acquire`
→ circuit-breaker admit → call adapter (stream + non-stream) → record usage → settle
reservations → failover loop → release on failure. A side-by-side audit found
~55-65% of each handler is near-verbatim duplicate control flow; the rest is genuine
protocol encode/decode. The two copies have **drifted**, and every drift point is a
real bug living inside the duplicated region:

- **F1** — RequestQueue backpressure is wired into the OpenAI route only;
  `/v1/messages` calls `acquireGlobal()` bare and never `release()`s the shared queue,
  so a queued OpenAI waiter is not woken when an Anthropic request frees the global
  slot (starvation), and `/v1/messages` 503s under saturation instead of queuing.
- **F2** — the Anthropic streaming success path never calls
  `rateLimitService.consumeTokens`, so token-based rate limiting is bypassed for the
  most common Claude path.
- **F3** — Anthropic leaks `spendReservation` + skips failure settlement on the
  all-candidates-skipped (`NoAvailableAccountError`) exit; OpenAI was already fixed.
- **F4** — Anthropic non-stream gates ALL accounting/settlement behind
  `if (usageNormalized)`; a success with no reported usage = free request + a
  permanently-held wallet reservation. OpenAI estimates instead and always settles.
- **F5 / F6b** — Anthropic caches `tool_use` responses (OpenAI excludes them) and can
  return an OpenAI-shaped body on a cache hit to an Anthropic client.
- **R3** — both routes `throw` (instead of failing over) on capacity errors
  (`NoAvailableAccountError`, `provider_overloaded`, `CircuitBreakerOpenError` raised
  inside the attempt), so failover breaks exactly when a provider is saturated.
- Shared latent bugs duplicated in both: half-open circuit counter not decremented on
  non-circuit failures, stream-error path records no latency, `no_provider_in_group`
  404 leaks the reservation.

Fixing these one-by-one means fixing each twice and re-drifting. The root cause is the
absence of a shared pipeline. This change extracts one.

## What Changes

- **Extract a single `RequestPipeline`** that owns the shared lifecycle exactly once:
  candidate iteration, circuit-breaker admit/resolve, concurrency + queue acquire/
  release, account lease, the failover loop and its retryable-vs-capacity-vs-terminal
  classification, usage recording, reservation settle/release, marketplace settlement
  hooks, latency recording, and **uniform cleanup on every exit path** (success,
  terminal error, retryable-exhausted, capacity error, mid-stream failure, early
  returns).
- **Protocol-specific behavior becomes a small set of hooks** the pipeline calls,
  implemented once per protocol (OpenAI, Anthropic):
  1. parse/validate the request,
  2. build the upstream adapter call (`chatCompletions` vs `messages`),
  3. write the stream + extract stream usage,
  4. decode the non-stream response + extract usage (with estimation fallback),
  5. cache-key/protocol specifics (incl. the tool_use cache-skip + correct wire shape
     on hit).
- **The drift bugs are eliminated structurally**, not patched: there is one queue
  wiring, one token-accounting call, one failure-settlement path, one usage-or-estimate
  rule, one cache guard, one failover classification — shared by both protocols.
- **No change to external API shape or behavior on healthy paths** — both `/v1/chat/
  completions` and `/v1/messages` keep their exact request/response contracts. This is
  an internal refactor that also corrects the failure-path divergences.

## Capabilities

### New Capabilities
- `request-pipeline`: a single shared request-handling pipeline drives both the
  OpenAI and Anthropic proxy routes, so the lifecycle (failover, reservations,
  settlement, circuit breaker, queue, usage, cleanup) behaves identically across
  protocols and protocol differences are isolated to encode/decode hooks.

## Impact

- New (engine): a `RequestPipeline` module + a `ProtocolHandler` interface with two
  implementations (OpenAI, Anthropic).
- Modified (engine): `routes/openai.ts` + `routes/anthropic.ts` shrink to thin
  protocol handlers wired into the pipeline; the duplicated lifecycle is deleted.
- Behavior corrections folded in (each was a verified bug): F1 queue wiring, F2 token
  accounting, F3 reservation release on exhaustion, F4 usage-or-estimate settlement,
  F5/F6b cache guards + wire shape, R3 capacity-error failover, half-open circuit
  resolve, stream-error latency, 404 reservation release.
- Depends on / coordinates with: `resilience-hardening` (the half-open circuit fix is
  cleanest done there; the pipeline calls the corrected breaker) and
  `persistence-durability` (the early-return reservation-leak fix overlaps — do once,
  in whichever lands first).
- Risk: highest-surface refactor of the two most important routes. Mitigation: the
  existing route test suites (openai/anthropic, streaming, failover, tool-calling)
  are the regression net; land behind a parity pass (same inputs → same outputs) and
  add tests for each previously-divergent failure path so they can never re-drift.
- Out of scope: adding new protocols (embeddings/images/audio already have their own
  thin routes) — though the pipeline should not preclude folding them in later.
