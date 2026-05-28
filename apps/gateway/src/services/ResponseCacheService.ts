/**
 * ResponseCacheService — Phase 32 — semantic-response-cache.
 *
 * In-process LRU+TTL cache for non-streaming chat-completion / messages responses
 * keyed by `sha256(model + canonical(messages) + canonical(params))`.
 *
 * Eviction: bounded by entry count (default 10000) AND total payload bytes
 * (default 200 MB). LRU order maintained via Map insertion order + re-touch
 * on read/write.
 *
 * TTL: per-entry; default 1 hour, max 24 hours. Lazy expiry on read; periodic
 * sweep on 60s interval cleans expired entries.
 */

import { createHash } from "node:crypto";

const DEFAULT_MAX_ENTRIES = 10000;
const DEFAULT_MAX_BYTES = 200 * 1024 * 1024;
const DEFAULT_TTL_SEC = 3600;
const MAX_TTL_SEC = 86400;
const SWEEP_INTERVAL_MS = 60_000;

export type CacheMode = "use" | "skip" | "refresh";
export type ApiKeyCacheMode = "client_choice" | "force_use" | "force_skip";

export type CacheKeyInput = {
  model: string;
  messages: unknown;
  /** Deterministic-affecting params */
  temperature?: number | null;
  top_p?: number | null;
  top_k?: number | null;
  max_tokens?: number | null;
  stop?: unknown;
  reasoning_effort?: string | null;
  /** Protocol the cache lookup belongs to (openai vs anthropic native shape). */
  protocol: "openai" | "anthropic";
  /** Optional API key hash for per-key isolation. Pass undefined for shared cache. */
  apiKeyHash?: string;
};

export type CacheEntry = {
  key: string;
  payload: unknown;
  sizeBytes: number;
  expiresAt: number;
  hits: number;
  lastHit: number;
  /** Top-level model that was cached, used in topHot output. */
  model: string;
};

export type CacheStats = {
  entries: number;
  bytesUsed: number;
  bytesMax: number;
  hits: number;
  misses: number;
  hitRatio: number;
  evictions: number;
  topHot: Array<{ keyHash: string; hits: number; model: string; lastHit: string }>;
};

function canonicalize(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const k of Object.keys(obj).sort()) {
      sorted[k] = canonicalize(obj[k]);
    }
    return sorted;
  }
  if (typeof value === "string") return value.trim();
  return value;
}

export function buildCacheKey(input: CacheKeyInput): string {
  const canonical = canonicalize({
    model: input.model,
    protocol: input.protocol,
    messages: input.messages,
    temperature: input.temperature ?? null,
    top_p: input.top_p ?? null,
    top_k: input.top_k ?? null,
    max_tokens: input.max_tokens ?? null,
    stop: input.stop ?? null,
    reasoning_effort: input.reasoning_effort ?? null,
    apiKeyHash: input.apiKeyHash ?? null
  });
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

export class ResponseCacheService {
  private readonly entries = new Map<string, CacheEntry>();
  private bytesUsed = 0;
  private hits = 0;
  private misses = 0;
  private evictions = 0;
  private sweepHandle: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly maxEntries = DEFAULT_MAX_ENTRIES,
    private readonly maxBytes = DEFAULT_MAX_BYTES
  ) {}

  start(): void {
    if (this.sweepHandle) return;
    this.sweepHandle = setInterval(() => this.sweep(), SWEEP_INTERVAL_MS);
  }

  stop(): void {
    if (this.sweepHandle) {
      clearInterval(this.sweepHandle);
      this.sweepHandle = null;
    }
  }

  read(key: string): unknown | null {
    const entry = this.entries.get(key);
    if (!entry) {
      this.misses += 1;
      return null;
    }
    if (entry.expiresAt < Date.now()) {
      this.entries.delete(key);
      this.bytesUsed -= entry.sizeBytes;
      this.misses += 1;
      return null;
    }
    // LRU touch: re-insert
    this.entries.delete(key);
    entry.hits += 1;
    entry.lastHit = Date.now();
    this.entries.set(key, entry);
    this.hits += 1;
    return entry.payload;
  }

  write(key: string, payload: unknown, model: string, ttlSec = DEFAULT_TTL_SEC): void {
    const ttl = Math.min(Math.max(1, ttlSec), MAX_TTL_SEC);
    const serialized = JSON.stringify(payload);
    const sizeBytes = Buffer.byteLength(serialized, "utf8");

    // Drop existing entry for this key (overwrite path)
    const existing = this.entries.get(key);
    if (existing) {
      this.bytesUsed -= existing.sizeBytes;
      this.entries.delete(key);
    }

    // Evict LRU until under both caps after adding the new entry
    while (
      this.entries.size >= this.maxEntries ||
      this.bytesUsed + sizeBytes > this.maxBytes
    ) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey === undefined) break;
      const old = this.entries.get(oldestKey);
      if (!old) break;
      this.entries.delete(oldestKey);
      this.bytesUsed -= old.sizeBytes;
      this.evictions += 1;
    }

    const entry: CacheEntry = {
      key,
      payload,
      sizeBytes,
      expiresAt: Date.now() + ttl * 1000,
      hits: 0,
      lastHit: Date.now(),
      model
    };
    this.entries.set(key, entry);
    this.bytesUsed += sizeBytes;
  }

  /**
   * Delete a single entry by exact key, or all entries with a given hex prefix
   * if `prefix` is supplied. Returns count cleared.
   */
  delete(prefix?: string): number {
    if (!prefix) {
      const count = this.entries.size;
      this.entries.clear();
      this.bytesUsed = 0;
      return count;
    }
    let cleared = 0;
    for (const key of Array.from(this.entries.keys())) {
      if (key.startsWith(prefix)) {
        const e = this.entries.get(key);
        if (e) this.bytesUsed -= e.sizeBytes;
        this.entries.delete(key);
        cleared += 1;
      }
    }
    return cleared;
  }

  /** Periodic sweep — drop expired entries. */
  sweep(): void {
    const now = Date.now();
    for (const [key, entry] of Array.from(this.entries.entries())) {
      if (entry.expiresAt < now) {
        this.entries.delete(key);
        this.bytesUsed -= entry.sizeBytes;
      }
    }
  }

  stats(): CacheStats {
    const totalReqs = this.hits + this.misses;
    const hitRatio = totalReqs === 0 ? 0 : Math.round((this.hits / totalReqs) * 1000) / 1000;
    const topHot = Array.from(this.entries.values())
      .filter((e) => e.hits > 0)
      .sort((a, b) => b.hits - a.hits)
      .slice(0, 20)
      .map((e) => ({
        keyHash: e.key.slice(0, 16),
        hits: e.hits,
        model: e.model,
        lastHit: new Date(e.lastHit).toISOString()
      }));
    return {
      entries: this.entries.size,
      bytesUsed: this.bytesUsed,
      bytesMax: this.maxBytes,
      hits: this.hits,
      misses: this.misses,
      hitRatio,
      evictions: this.evictions,
      topHot
    };
  }

  /** Test helper. */
  size(): number {
    return this.entries.size;
  }
}

/**
 * Resolve effective cache mode for a request.
 * Priority: per-key admin override > client `cache_control.mode` > header > default skip.
 * Then apply non-determinism policy: high temperature with top_p/top_k → coerce to skip.
 */
export function resolveCacheMode(args: {
  bodyMode?: string;
  headerMode?: string;
  apiKeyMode?: ApiKeyCacheMode;
  temperature?: number | null;
  top_p?: number | null;
  top_k?: number | null;
  isStream?: boolean;
}): CacheMode {
  if (args.isStream) return "skip";
  if (args.apiKeyMode === "force_skip") return "skip";

  let mode: CacheMode = "skip";
  const body = (args.bodyMode ?? "").toLowerCase();
  const header = (args.headerMode ?? "").toLowerCase();
  if (body === "use" || body === "skip" || body === "refresh") mode = body as CacheMode;
  else if (header === "use" || header === "skip" || header === "refresh") mode = header as CacheMode;

  if (args.apiKeyMode === "force_use" && mode !== "refresh") mode = "use";

  // Non-determinism guard: when caller asked for use/refresh AND temperature > 0
  // AND a non-default top_p/top_k is present, downgrade to skip.
  if ((mode === "use" || mode === "refresh") && (args.temperature ?? 0) > 0) {
    const hasTopP = args.top_p !== null && args.top_p !== undefined && args.top_p !== 1;
    const hasTopK = args.top_k !== null && args.top_k !== undefined;
    if (hasTopP || hasTopK) return "skip";
  }
  return mode;
}
