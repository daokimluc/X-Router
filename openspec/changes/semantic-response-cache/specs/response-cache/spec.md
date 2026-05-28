## ADDED Requirements

### Requirement: Hash-keyed in-process LRU response cache

The gateway SHALL maintain an in-process cache keyed by `sha256` of `(canonical model, canonical messages, deterministic params)`. The cache SHALL store full normalized response bodies for non-streaming successful completions only.

The cache SHALL enforce both an entry-count cap (default 10000) and a byte cap (default 200 MB). On insert that exceeds either cap, the cache SHALL evict least-recently-used entries until under both caps.

The cache SHALL apply per-entry TTL (default 1 hour, max 24 hours). Expired entries SHALL be treated as misses on read and SHALL be removed lazily on access OR by periodic sweep (≤ 60s interval).

#### Scenario: Identical request body produces same cache key

- **WHEN** two requests differ only in non-determinism fields (`stream`, `user`, fluctuating `tool_choice: "auto"`)
- **THEN** they SHALL hash to the same cache key

#### Scenario: Different temperature produces different cache key

- **WHEN** two requests have `temperature: 0.0` and `temperature: 0.1` respectively, all other fields equal
- **THEN** they SHALL hash to different cache keys

#### Scenario: LRU eviction when over byte cap

- **WHEN** the cache is at exactly `bytesMax` and a new entry of size `S` is inserted
- **THEN** the cache SHALL evict the oldest entry (or entries) until total bytes ≤ `bytesMax - S`, then insert the new entry

#### Scenario: TTL expiry on read

- **WHEN** an entry was inserted 90 minutes ago with default TTL `3600` seconds and a request hashes to its key
- **THEN** the cache SHALL treat it as a miss, remove the entry, and let the request proceed to the provider

### Requirement: Cache modes — `skip` (default), `use`, `refresh`

Clients SHALL be able to express their cache preference per request via either body field `cache_control.mode` or header `x-gateway-cache-control`. When neither is set, behavior defaults to `skip`.

The gateway SHALL behave per mode:
- `skip`: bypass cache read and write entirely.
- `use`: read cache; on hit return cached response; on miss call provider and store result on success.
- `refresh`: bypass cache read; call provider; on success overwrite cache regardless of any existing entry.

#### Scenario: Default behavior bypasses cache

- **WHEN** a client sends a request with no `cache_control` and no header
- **THEN** the gateway SHALL NOT read the cache and SHALL NOT write to the cache

#### Scenario: `use` mode hit returns cached response

- **WHEN** a client sends `cache_control: { mode: "use" }` and the cache contains a non-expired entry for the matching key
- **THEN** the gateway SHALL return the cached response body without calling the provider, with response header `x-gateway-cache: hit` and `x-gateway-cache-age: <seconds>`

#### Scenario: `use` mode miss stores response

- **WHEN** a client sends `cache_control: { mode: "use" }` and no entry exists
- **THEN** the gateway SHALL call the provider, return the response with header `x-gateway-cache: miss`, and store the successful response in the cache for future reads

#### Scenario: `refresh` mode forces overwrite

- **WHEN** a client sends `cache_control: { mode: "refresh" }` and an entry exists for the key
- **THEN** the gateway SHALL call the provider regardless of the existing entry, return the fresh response, and overwrite the cache entry

### Requirement: Per-key cache mode override

`ApiKey` SHALL support `cacheMode: "client_choice" | "force_use" | "force_skip"` (default `client_choice`). When the key is `force_use`, all client `cache_control.mode` values are coerced to `use`. When `force_skip`, all are coerced to `skip`.

#### Scenario: `force_skip` key ignores client `use` request

- **WHEN** a request authenticates with a key whose `cacheMode = "force_skip"` and the body contains `cache_control: { mode: "use" }`
- **THEN** the gateway SHALL behave as `skip` for this request — neither read nor write the cache

### Requirement: Cache excluded for non-deterministic and tool-using requests

The gateway SHALL skip cache write (but not read) when:
- `temperature > 0.0` AND a non-zero `top_p` or `top_k` is present (non-deterministic generation).
- The provider response includes one or more non-empty `tool_calls` (tool-call results are not safe to replay).
- The HTTP response is non-2xx.
- The request is streaming (`body.stream === true`).

Cache READ for these requests is also skipped because no entry should ever exist for them; if one does (defensively), it is treated as miss.

#### Scenario: Tool-call response not stored

- **WHEN** a `cache_control: { mode: "use" }` request returns a response containing `tool_calls: [{...}]`
- **THEN** the gateway SHALL return the response with header `x-gateway-cache: skip-toolcall` and SHALL NOT store it

#### Scenario: Streaming request never reads or writes cache

- **WHEN** a request has `stream: true`
- **THEN** the gateway SHALL skip cache read and write regardless of `cache_control.mode`

### Requirement: Cached hit logged as zero-cost UsageRecord

When a request is served from cache, the gateway SHALL still record a `UsageRecord` with `cacheHit: true`, `estimatedCost: 0`, and the original token counts from the cached response, so the Usage page can display savings without inflating billing.

#### Scenario: Cache hit produces zero-cost usage record

- **WHEN** a request is served from cache with cached `prompt_tokens: 1000` and `completion_tokens: 500`
- **THEN** the recorded UsageRecord SHALL have `cacheHit: true`, `estimatedCost: 0`, `promptTokens: 1000`, `completionTokens: 500`
