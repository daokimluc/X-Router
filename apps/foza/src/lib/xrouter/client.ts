import "server-only";
import { xrouterConfig } from "./config";
import { XRouterError, XRouterRateLimitError } from "./types";

type FetchOpts = RequestInit & {
  /** Which auth dimension to use. */
  auth?: "provision" | "internal" | "admin";
};

const MAX_ATTEMPTS = 4;
const BASE_BACKOFF_MS = 500;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Server-only fetch wrapper for X-Router. Prefixes the base URL, attaches the
 * appropriate bearer key, applies a timeout, and throws XRouterError on failure.
 * Parses the documented error shape `{ error: { message, code } }`.
 *
 * Rate-limit aware: on HTTP 429 (provision_rate_limit_exceeded) it honors the
 * `retry-after` header and retries with capped exponential backoff, up to
 * MAX_ATTEMPTS. After the cap it throws XRouterRateLimitError so callers can show
 * a friendly message rather than a generic failure.
 */
export async function xrouterFetch<T>(
  path: string,
  opts: FetchOpts = {},
): Promise<T> {
  const { auth = "provision", headers, ...rest } = opts;
  const key =
    auth === "internal"
      ? xrouterConfig.internalKey
      : auth === "admin"
        ? xrouterConfig.adminKey
        : xrouterConfig.provisionKey;

  let lastRateLimitMsg = "X-Router rate limit exceeded";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), xrouterConfig.timeoutMs);
    try {
      const res = await fetch(`${xrouterConfig.url}${path}`, {
        ...rest,
        headers: {
          "Content-Type": "application/json",
          ...(key ? { Authorization: `Bearer ${key}` } : {}),
          ...headers,
        },
        signal: controller.signal,
        cache: "no-store",
      });

      const text = await res.text();

      // Rate limited: back off and retry (unless this was the last attempt).
      if (res.status === 429) {
        try {
          const body = JSON.parse(text);
          if (body?.error?.message) lastRateLimitMsg = body.error.message;
        } catch {
          /* keep default */
        }
        if (attempt < MAX_ATTEMPTS) {
          const retryAfter = Number(res.headers.get("retry-after"));
          const headerMs =
            Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 0;
          const backoffMs = BASE_BACKOFF_MS * 2 ** (attempt - 1);
          clearTimeout(timer);
          await sleep(Math.max(headerMs, backoffMs));
          continue;
        }
        clearTimeout(timer);
        throw new XRouterRateLimitError(lastRateLimitMsg);
      }

      if (!res.ok) {
        let message = `X-Router ${path} responded ${res.status}`;
        let code: string | undefined;
        try {
          const body = JSON.parse(text);
          if (body?.error?.message) message = body.error.message;
          if (body?.error?.code) code = body.error.code;
        } catch {
          /* keep default */
        }
        throw new XRouterError(message, res.status, code);
      }
      return (text ? JSON.parse(text) : {}) as T;
    } catch (err) {
      if (err instanceof XRouterError) throw err;
      throw new XRouterError(
        `X-Router ${path} request failed: ${(err as Error).message}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }
  // Unreachable (loop either returns or throws); satisfies the type checker.
  throw new XRouterRateLimitError(lastRateLimitMsg);
}
