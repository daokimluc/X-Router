import "server-only";

/**
 * Minimal in-memory rate limiter for auth-sensitive server actions
 * (login attempts, verification-email resends, registrations). Fixed-window
 * counter keyed by `${action}:${identifier}`.
 *
 * Scope & limits: this is a single-process, in-memory guard — it resets on
 * restart and does NOT coordinate across multiple instances. It is a meaningful
 * brute-force / email-bomb speed bump for a single-node deployment, not a
 * distributed quota. For multi-instance production, back this with Redis (same
 * interface). It is deliberately dependency-free so it works in any runtime.
 */

type Bucket = { count: number; resetAt: number };

// Singleton across dev module re-evaluation (same pattern as the DB/ledger).
const g = globalThis as unknown as { __vexaRateBuckets?: Map<string, Bucket> };
const buckets: Map<string, Bucket> = (g.__vexaRateBuckets ??= new Map());

export type RateResult = { allowed: boolean; retryAfterMs: number };

/**
 * Consume one unit from the window for `key`. Returns `allowed: false` with the
 * time until the window resets once `limit` is exceeded.
 */
export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): RateResult {
  const now = Date.now();
  const b = buckets.get(key);

  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterMs: 0 };
  }

  if (b.count >= limit) {
    return { allowed: false, retryAfterMs: b.resetAt - now };
  }

  b.count += 1;
  return { allowed: true, retryAfterMs: 0 };
}

// Opportunistic cleanup so the map can't grow unbounded from one-off keys.
// Runs at most once per minute, walking expired buckets only.
let lastSweep = 0;
export function sweepExpired(now = Date.now()): void {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [k, b] of buckets) {
    if (b.resetAt <= now) buckets.delete(k);
  }
}
