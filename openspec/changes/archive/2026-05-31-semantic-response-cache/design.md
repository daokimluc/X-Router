## Context

Accountrouter routes every request through to upstream providers. There is no caching layer. Common workloads (code agents iterating on identical-prefix prompts, batch jobs retrying, dev/staging environments hitting same canned prompt) pay full token cost every time.

The provider response shape is already normalized via `NormalizedOpenAIResponse` / `NormalizedAnthropicResponse`. UsageRecord exists. `request.body` is JSON. Hashing is straightforward.

The name "semantic-response-cache" is aspirational; this iteration ships an **exact-match** cache. True semantic similarity (embedding-based) would need a vector store and is its own large project — out of scope.

## Goals / Non-Goals

**Goals:**
- Drop cost and latency on duplicate prompts.
- Opt-in per request (default: cache disabled) to avoid breaking idempotency expectations.
- Admin observability: hit ratio, top hot prompts (hashed), memory usage.
- Bounded memory regardless of cache size.

**Non-Goals:**
- Embedding-based fuzzy match. Exact match by hash only.
- Streaming response caching. Defer — stream replay across clients is non-trivial and the win is smaller.
- Cross-process / distributed cache. Single in-process LRU.
- Image / audio / file response caching. Text only this iteration.

## Decisions

### Decision 1 — Cache key construction

```
sha256(JSON.stringify({
  model:        canonicalModelName,            // canonical, post-variant resolution
  messages:     canonicalMessages,             // sorted keys, no whitespace
  temperature:  body.temperature ?? null,
  top_p:        body.top_p ?? null,
  top_k:        body.top_k ?? null,
  max_tokens:   body.max_tokens ?? null,
  stop:         body.stop ?? null,
  reasoning_effort: body.reasoning_effort ?? null,
  // explicitly EXCLUDE: stream, user, tool_choice when "auto", random fields
}))
```

**Canonical messages** = walk message array, drop unknown fields, sort object keys recursively, trim whitespace inside content strings only when content is plain text. Tool/function arguments are NOT trimmed.

**Why excludes**: `stream` doesn't change content. `user` is metadata, varies per caller. `tool_choice: "auto"` doesn't constrain output beyond default — we treat it as null.

Hashing `temperature: 0.0` distinct from `temperature: undefined` — explicit zero is meaningful (deterministic).

### Decision 2 — Opt-in: client controls

Clients indicate cache intent via:
- Body field `cache_control: { mode: "use" | "skip" | "refresh", ttl?: seconds }` (preferred)
- OR header `x-gateway-cache-control: use|skip|refresh`

Modes:
- `skip` (default): bypass cache entirely. Provider is called.
- `use`: read cache; on hit return cached, on miss call provider AND store result.
- `refresh`: ignore cache for read; call provider; OVERWRITE cache with the new response.

Per-key admin override:
- `apiKey.cacheMode = "force_use" | "force_skip" | "client_choice"` (default `client_choice`)
- `force_use` overrides `skip` clients to use cache.
- `force_skip` disables caching even when clients ask for it (useful for compliance keys).

### Decision 3 — Eviction: LRU + TTL with memory cap

- Max entries: 10000 (configurable via env).
- Max bytes: 200 MB total response payload (env `CACHE_MAX_BYTES_MB`, default 200).
- TTL: 1 hour default per entry; client can override via `cache_control.ttl` up to 24h.
- Eviction trigger: on each insert, if entries OR bytes over cap, drop LRU until under.

We track a `bytes` accumulator on the cache; entries store `{ key, response, sizeBytes, expiresAt, hits }`. Hit increments `hits` and re-touches LRU position.

### Decision 4 — What gets stored

- Successful HTTP responses with `usage` populated and a non-streaming response shape.
- Status 4xx and 5xx are NOT cached (errors are not safe to replay).
- Anthropic and OpenAI native shapes both stored as their normalized form. The protocol used to read (openai vs anthropic) is part of the cache key.

### Decision 5 — Cache hit response semantics

When serving from cache:
- `id` field is regenerated (`chatcmpl-cached-<random>`) so clients tracking IDs don't see duplicate.
- `created` is set to current timestamp.
- `x-gateway-cache: hit` response header.
- `x-gateway-cache-age: <seconds>` response header.
- `usage` field is preserved from the cached response (so cost reporting stays consistent — but UsageRecord recorded for this request marks `cacheHit: true` and `estimatedCost: 0`).

When recording UsageRecord for a hit: keep token counts (so consumers see the work value) but set `estimatedCost = 0` and `cacheHit = true`.

### Decision 6 — Admin observability

`GET /admin/v1/cache/stats`:
```
{
  "entries": 1234,
  "bytesUsed": 41943040,
  "bytesMax":  209715200,
  "hits":      8800,
  "misses":   12345,
  "hitRatio":  0.416,
  "evictions": 78,
  "topHot": [
    { "keyHash": "ab12cd34", "hits": 412, "model": "gpt-4o-mini", "lastHit": "2026-05-28T12:01:00Z" },
    ...
  ]
}
```

`keyHash` is the first 16 chars of the cache key — operators can identify hot prompts in their logs without reading raw prompts.

`DELETE /admin/v1/cache` clears the entire cache. `DELETE /admin/v1/cache/:keyPrefix` clears keys starting with the prefix (rare use case but cheap to support).

## Risks / Trade-offs

- **Stale results.** A cached response from 30 minutes ago may not reflect the latest world state. Mitigation: short default TTL (1h), client `refresh` mode, force `tools=[search]` clients to skip via app-level convention.
- **Cache poisoning.** A malicious request stores a known-bad response that other clients receive. Mitigation: cache key includes the API key hash by default (entries are per-key); add `apiKey.cacheShared = true` to opt into cross-key sharing for read-only public prompts.
- **Memory pressure.** A 200 MB cache + the existing in-memory state could push small VPS over. Mitigation: env-tunable, eviction is aggressive.
- **Provider non-determinism with `temperature > 0`.** If a client caches a creative response, all hits get the same answer — possibly unwanted. Mitigation: enforce policy that `cacheMode = use` only kicks in when `temperature ≤ 0.0` AND no `top_p` randomness. Document this as the "deterministic-only cache" rule. Skip caching when temperature > 0 even if client asks.
- **Compliance / GDPR.** Some keys must NEVER cache user prompts (PII concerns). Mitigation: `apiKey.cacheMode = "force_skip"` flag.
- **Tool calls.** Caching a tool-call response is dangerous — the tool result will differ. Mitigation: skip cache for any response with non-empty `tool_calls`. Document.

## Migration Plan

Additive, opt-in. Steps:
1. Implement `ResponseCacheService` with internal API (no external caller).
2. Wire pre-flight read in routes; wire post-completion store.
3. Admin endpoints for stats + flush.
4. Frontend: cache stat card on Overview. Cached badge on RequestLogs rows.
5. Document opt-in in API info panel and FAQ.

Rollback: feature is purely additive and off by default. Revert commits.

## Open Questions

- Should we hash + record full prompt for diagnostic purposes (admin only) or only the key hash? Default: only key hash, no raw prompt stored outside the response payload itself. Confirm.
- Cross-key sharing default: off (per-key isolated). Some operators may want a shared "system prompt cache" — leave for follow-up.
- Should `force_skip` keys still see `x-gateway-cache: skipped` on response, or no header at all? Default: emit header for transparency.
