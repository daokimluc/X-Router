## 1. Cache service

- [x] 1.1 Create `apps/gateway/src/services/ResponseCacheService.ts` with:
  - `read(key)`, `write(key, value, ttl)`, `delete(prefix?)`, `stats()`
  - LRU map (insertion-order Map with re-touch on read/write)
  - byte accumulator + entry count
  - lazy expiry on read; periodic sweep `setInterval` 60s.
- [x] 1.2 Implement `buildCacheKey(body, model, protocol, apiKeyHash, opts)` per design (decision 1). Canonical messages helper, deterministic params helper.
- [x] 1.3 Vitest: hash determinism, eviction LRU + bytes, TTL, prefix delete, stats math.

## 2. Mode resolution

- [x] 2.1 Helper `resolveCacheMode(request, apiKey)` returns final mode after:
  - Read body `cache_control.mode` or header `x-gateway-cache-control`.
  - Apply per-key override (`force_use`, `force_skip`, `client_choice`).
  - Apply skip-when-non-deterministic policy (temperature/top_p/top_k).

## 3. Wire into routes

- [x] 3.1 In `routes/openai.ts`: before global concurrency limiter, if mode `use`/`refresh`, look up cache. On `use` hit: return cached body with headers, record UsageRecord with `cacheHit: true, estimatedCost: 0`, return.
- [x] 3.2 On miss/refresh path: continue to provider; after success, if mode != `skip` and policy permits storage, call `cache.write(key, response, ttl)`.
- [x] 3.3 Same wiring in `routes/anthropic.ts` (non-stream branch only).
- [x] 3.4 Add `cacheHit?: boolean` to `UsageRecord` type and persistence schema. Backward-compat: missing = false.

## 4. Skip-policies

- [x] 4.1 Skip cache write when response has non-empty `tool_calls`.
- [x] 4.2 Skip cache read AND write when `body.stream === true`.
- [x] 4.3 Skip cache write when `temperature > 0` AND (`top_p` or `top_k` non-default).
- [x] 4.4 Vitest each skip path.

## 5. Admin endpoints

- [x] 5.1 `GET /admin/v1/cache/stats` per spec.
- [x] 5.2 `DELETE /admin/v1/cache` and `DELETE /admin/v1/cache/:keyPrefix` per spec.
- [x] 5.3 Vitest shape, auth, prefix matching.

## 6. ApiKey field

- [x] 6.1 Add `cacheMode?: "client_choice" | "force_use" | "force_skip"` to ApiKey type and persistence schema. Default missing → `"client_choice"`.
- [x] 6.2 Update create/patch zod schema.

## 7. Dashboard UI

- [x] 7.1 Overview: small "Cache" card showing hit ratio, entries, bytes used.
- [ ] 7.2 RequestLogs row: cyan "cached" tag when `cacheHit: true`.
- [x] 7.3 ApiKeyEditModal Limits tab: dropdown for `cacheMode`.
- [x] 7.4 i18n EN/VI: `ov.cache.title`, `ov.cache.hitRatio`, `apikey.cacheMode.*`.

## 8. Verification

- [x] 8.1 Gateway tsc + vitest.
- [x] 8.2 Dashboard tsc + build.
- [ ] 8.3 Manual: send same request twice with `cache_control: { mode: "use" }`, second response shows `x-gateway-cache: hit`, UsageRecord shows zero cost. Send with `temperature: 0.7` — second hit still misses (skip policy).
- [x] 8.4 Update FaqPanel + .claude/notes.md with cache_control documentation.
