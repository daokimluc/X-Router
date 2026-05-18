/**
 * Proxy-Aware Fetch Utility
 *
 * Resolves proxy configuration and applies it to outbound HTTP requests.
 * Supports:
 * - `http` type: Routes through ProxyAgent dispatcher
 * - `vercel` type: Routes via Vercel relay using x-relay-target/x-relay-path headers
 * - Direct connection: No proxy applied
 *
 * Implements strict proxy mode (fail on proxy error) vs non-strict (fallback to direct).
 * Checks noProxy patterns before applying proxy.
 *
 * Requirements: 3.2, 3.3, 3.4, 3.5, 3.6, 3.7
 */

import { request as undiciRequest, type Dispatcher } from "undici";
import type { ProxyFetchOptions } from "./types.js";
import { ProxyDispatcherCache } from "./ProxyDispatcherCache.js";
import { shouldBypassProxy } from "./noProxyMatcher.js";

export type ProxyAwareFetchOptions = {
  url: string;
  method?: Dispatcher.HttpMethod;
  headers?: Record<string, string>;
  body?: string | Buffer | null;
  signal?: AbortSignal;
  proxyOptions?: ProxyFetchOptions;
};

export type ProxyAwareFetchResult = {
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
  usedProxy: boolean;
};

// Shared dispatcher cache for reusing ProxyAgent instances
const dispatcherCache = new ProxyDispatcherCache();

/**
 * Perform an HTTP request with proxy-aware routing.
 *
 * Resolution order:
 * 1. Check if proxy is enabled in options
 * 2. Check noProxy patterns — bypass proxy if target matches
 * 3. Apply proxy based on type (http or vercel)
 * 4. On proxy failure: fail if strictProxy, otherwise fallback to direct
 */
export async function proxyAwareFetch(
  options: ProxyAwareFetchOptions
): Promise<ProxyAwareFetchResult> {
  const {
    url,
    method = "GET",
    headers = {},
    body = null,
    signal,
    proxyOptions,
  } = options;

  // If proxy is not enabled or no proxy options, connect directly
  if (!proxyOptions?.enabled) {
    return directFetch(url, method, headers, body, signal);
  }

  // Check noProxy patterns — bypass proxy if target matches
  if (proxyOptions.noProxy && shouldBypassProxy(url, proxyOptions.noProxy)) {
    return directFetch(url, method, headers, body, signal);
  }

  // Determine proxy type and route accordingly
  const proxyUrl = proxyOptions.url ?? proxyOptions.vercelRelayUrl;
  if (!proxyUrl) {
    // No proxy URL configured, connect directly
    return directFetch(url, method, headers, body, signal);
  }

  // Determine if this is a vercel relay proxy
  const isVercel = proxyOptions.vercelRelayUrl !== undefined;

  try {
    if (isVercel) {
      return await vercelRelayFetch(
        proxyOptions.vercelRelayUrl!,
        url,
        method,
        headers,
        body,
        signal
      );
    } else {
      return await httpProxyFetch(
        proxyOptions.url!,
        url,
        method,
        headers,
        body,
        signal
      );
    }
  } catch (error) {
    // Strict proxy mode: fail on proxy error
    if (proxyOptions.strictProxy) {
      const message = error instanceof Error ? error.message : "Proxy connection failed";
      throw new ProxyError(
        `Proxy required but failed: ${message}`,
        "proxy_required_but_failed"
      );
    }

    // Non-strict mode: fallback to direct connection
    return directFetch(url, method, headers, body, signal);
  }
}

/**
 * Perform a direct HTTP request without any proxy.
 */
async function directFetch(
  url: string,
  method: Dispatcher.HttpMethod,
  headers: Record<string, string>,
  body: string | Buffer | null,
  signal?: AbortSignal
): Promise<ProxyAwareFetchResult> {
  const response = await undiciRequest(url, {
    method,
    headers,
    body: body ?? undefined,
    signal,
  });

  const responseBody = Buffer.from(await response.body.arrayBuffer());
  const responseHeaders: Record<string, string | string[] | undefined> = {};
  for (const [key, value] of Object.entries(response.headers)) {
    responseHeaders[key] = value;
  }

  return {
    statusCode: response.statusCode,
    headers: responseHeaders,
    body: responseBody,
    usedProxy: false,
  };
}

/**
 * Perform an HTTP request through an HTTP/SOCKS proxy using ProxyAgent.
 */
async function httpProxyFetch(
  proxyUrl: string,
  targetUrl: string,
  method: Dispatcher.HttpMethod,
  headers: Record<string, string>,
  body: string | Buffer | null,
  signal?: AbortSignal
): Promise<ProxyAwareFetchResult> {
  const dispatcher = dispatcherCache.get(proxyUrl);

  const response = await undiciRequest(targetUrl, {
    method,
    headers,
    body: body ?? undefined,
    signal,
    dispatcher,
  });

  const responseBody = Buffer.from(await response.body.arrayBuffer());
  const responseHeaders: Record<string, string | string[] | undefined> = {};
  for (const [key, value] of Object.entries(response.headers)) {
    responseHeaders[key] = value;
  }

  return {
    statusCode: response.statusCode,
    headers: responseHeaders,
    body: responseBody,
    usedProxy: true,
  };
}

/**
 * Perform an HTTP request via Vercel relay using x-relay-target and x-relay-path headers.
 *
 * The relay server receives the request at its own URL with:
 * - x-relay-target: {protocol}//{host} of the original target
 * - x-relay-path: {pathname}{search} of the original target
 */
async function vercelRelayFetch(
  relayUrl: string,
  targetUrl: string,
  method: Dispatcher.HttpMethod,
  headers: Record<string, string>,
  body: string | Buffer | null,
  signal?: AbortSignal
): Promise<ProxyAwareFetchResult> {
  const targetParsed = new URL(targetUrl);
  const relayTarget = `${targetParsed.protocol}//${targetParsed.host}`;
  const relayPath = `${targetParsed.pathname}${targetParsed.search}`;

  const relayHeaders: Record<string, string> = {
    ...headers,
    "x-relay-target": relayTarget,
    "x-relay-path": relayPath,
  };

  const response = await undiciRequest(relayUrl, {
    method,
    headers: relayHeaders,
    body: body ?? undefined,
    signal,
  });

  const responseBody = Buffer.from(await response.body.arrayBuffer());
  const responseHeaders: Record<string, string | string[] | undefined> = {};
  for (const [key, value] of Object.entries(response.headers)) {
    responseHeaders[key] = value;
  }

  return {
    statusCode: response.statusCode,
    headers: responseHeaders,
    body: responseBody,
    usedProxy: true,
  };
}

/**
 * Custom error class for proxy failures.
 */
export class ProxyError extends Error {
  code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = "ProxyError";
    this.code = code;
  }
}

/**
 * Get the shared dispatcher cache instance.
 * Useful for cleanup or cache management.
 */
export function getDispatcherCache(): ProxyDispatcherCache {
  return dispatcherCache;
}
