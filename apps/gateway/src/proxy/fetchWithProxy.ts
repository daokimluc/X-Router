/**
 * fetchWithProxy — drop-in `fetch`-compatible wrapper that applies per-request
 * proxy options. Unlike `proxyAwareFetch`, this preserves the standard `Response`
 * shape (including streaming `body`), so it can be used in adapters that expect
 * a normal Response object.
 *
 * Resolution:
 * - If `proxyOptions?.enabled` is false/undefined, calls the underlying fetch directly.
 * - If a noProxy pattern matches the URL, bypasses proxy.
 * - Vercel relay (`vercelRelayUrl`) is converted to header rewrite + new URL.
 * - HTTP proxy (`url`) is applied via undici dispatcher.
 *
 * Note: streaming requests over an HTTP proxy require Node 18+ with undici fetch
 * which honors the `dispatcher` option.
 */
import type { ProxyFetchOptions } from "./types.js";
import { shouldBypassProxy } from "./noProxyMatcher.js";
import { getDispatcherCache } from "./ProxyAwareFetch.js";

export type FetchLike = (
  url: string | URL,
  init?: RequestInit & { dispatcher?: unknown }
) => Promise<Response>;

export async function fetchWithProxy(
  url: string | URL,
  init: RequestInit | undefined,
  proxyOptions: ProxyFetchOptions | undefined,
  fetchImpl: FetchLike = fetch
): Promise<Response> {
  if (!proxyOptions?.enabled) {
    return fetchImpl(url, init);
  }

  const targetUrl = typeof url === "string" ? url : url.toString();

  if (proxyOptions.noProxy && shouldBypassProxy(targetUrl, proxyOptions.noProxy)) {
    return fetchImpl(url, init);
  }

  // Vercel relay: rewrite to relay endpoint, encode target via headers
  if (proxyOptions.vercelRelayUrl) {
    const parsed = new URL(targetUrl);
    const headers = new Headers(init?.headers);
    headers.set("x-relay-target", `${parsed.protocol}//${parsed.host}`);
    headers.set("x-relay-path", parsed.pathname + parsed.search);
    try {
      return await fetchImpl(proxyOptions.vercelRelayUrl, { ...init, headers });
    } catch (err) {
      if (proxyOptions.strictProxy) throw err;
      return fetchImpl(url, init);
    }
  }

  // HTTP proxy: dispatcher
  if (!proxyOptions.url) {
    return fetchImpl(url, init);
  }

  const dispatcher = getDispatcherCache().get(proxyOptions.url);
  try {
    return await fetchImpl(url, { ...init, dispatcher });
  } catch (err) {
    if (proxyOptions.strictProxy) throw err;
    return fetchImpl(url, init);
  }
}
