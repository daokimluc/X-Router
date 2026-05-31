## Why

Many real-world LLM workloads send identical or near-identical prompts repeatedly: code-completion seed prompts, system message + small variation user input, idempotent batch jobs, retries after a network blip. Every duplicate hits an upstream provider for full cost. A response cache keyed by prompt-hash + model + parameters can drop cost and latency for these by 50-90% on hot prompts. Other gateways (LiteLLM, Helicone) treat this as a flagship feature; we have all primitives (`UsageRecord`, deterministic body) to build it cleanly.

## What Changes

- New `ResponseCacheService` with bounded LRU + TTL eviction, keyed by `sha256(model + canonical(messages) + canonical(params))`.
- A request with a cache hit SHALL return the cached body (with synthetic `id`/`created` fields and `x-gateway-cache: hit` header) and SHALL NOT call any provider.
- Cache is **opt-in per request** — clients pass `cache_control: { mode: "use" | "skip" | "refresh" }` (OpenAI-compatible custom field) or header `x-gateway-cache-control`. Default: `skip` (cache disabled). This avoids surprising existing integrations.
- Streaming requests are NOT cached (stream-replay too complex, defer to future iteration).
- Per-key flag `cacheEnabled` lets admins force-enable or force-disable caching for a key regardless of client preference.
- Admin endpoint `GET /admin/v1/cache/stats` returns hit ratio, total entries, memory estimate, top-N hot keys.
- `DELETE /admin/v1/cache` flushes the cache (for incident response).
- `UsageRecord` carries `cacheHit: boolean` so the Usage panel can show savings.
- **BREAKING** none — opt-in only.

## Capabilities

### New Capabilities
- `response-cache`: In-process LRU+TTL cache for non-streaming chat-completion / messages responses keyed by prompt+model+params, with opt-in client control.
- `response-cache-admin`: Admin endpoints to inspect cache stats and flush.

### Modified Capabilities
- (none — additive, off by default)

## Impact

- New service: `apps/gateway/src/services/ResponseCacheService.ts`.
- Modified routes: `routes/openai.ts` and `routes/anthropic.ts` — pre-flight cache lookup, post-completion cache store.
- Modified `UsageRecord` type: add optional `cacheHit?: boolean`.
- Frontend: small "Cache hit ratio" stat on Overview, "Cached" tag on RequestLogs rows.
- New dependency: none (use Node `crypto.createHash`).
- Memory: configurable, default `200 MB` ceiling for cache; LRU evicts when over.
- Persistence: in-memory only (cache rebuilds on restart). Acceptable for a cost-saving optimization.
