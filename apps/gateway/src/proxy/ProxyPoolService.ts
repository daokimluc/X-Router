import { randomUUID } from "node:crypto";
import { request as undiciRequest } from "undici";
import { ProxyAgent } from "undici";
import type {
  ProxyPool,
  ProxyPoolCreateInput,
  ProxyPoolUpdateInput,
  ProxyPoolWithUsage,
  ProxyTestResult
} from "./types.js";

export class ProxyPoolService {
  private pools = new Map<string, ProxyPool>();

  create(input: ProxyPoolCreateInput): ProxyPool {
    if (!input.name || input.name.trim() === "") {
      throw new Error("Name is required");
    }
    if (!input.proxyUrl || input.proxyUrl.trim() === "") {
      throw new Error("Proxy URL is required");
    }

    const now = new Date();
    const pool: ProxyPool = {
      id: randomUUID(),
      name: input.name,
      proxyUrl: input.proxyUrl,
      noProxy: input.noProxy ?? "",
      isActive: input.isActive ?? true,
      strictProxy: input.strictProxy ?? false,
      type: input.type ?? "http",
      testStatus: "unknown",
      lastTestedAt: null,
      lastError: null,
      createdAt: now,
      updatedAt: now
    };

    this.pools.set(pool.id, pool);
    return pool;
  }

  getById(id: string): ProxyPool | undefined {
    return this.pools.get(id);
  }

  list(filters?: { isActive?: boolean }): ProxyPool[] {
    const all = Array.from(this.pools.values());
    if (filters?.isActive !== undefined) {
      return all.filter((p) => p.isActive === filters.isActive);
    }
    return all;
  }

  listWithUsage(
    accounts: Array<{ providerSpecificData?: { proxyPoolId?: string } }>,
    filters?: { isActive?: boolean }
  ): ProxyPoolWithUsage[] {
    const pools = this.list(filters);
    return pools.map((pool) => {
      const boundConnectionCount = accounts.filter(
        (a) => a.providerSpecificData?.proxyPoolId === pool.id
      ).length;
      return { ...pool, boundConnectionCount };
    });
  }

  update(id: string, input: ProxyPoolUpdateInput): ProxyPool {
    const pool = this.pools.get(id);
    if (!pool) {
      throw new Error("Proxy pool not found");
    }

    const updated: ProxyPool = {
      ...pool,
      ...(input.name !== undefined && { name: input.name }),
      ...(input.proxyUrl !== undefined && { proxyUrl: input.proxyUrl }),
      ...(input.noProxy !== undefined && { noProxy: input.noProxy }),
      ...(input.isActive !== undefined && { isActive: input.isActive }),
      ...(input.strictProxy !== undefined && { strictProxy: input.strictProxy }),
      ...(input.type !== undefined && { type: input.type }),
      updatedAt: new Date()
    };

    this.pools.set(id, updated);
    return updated;
  }

  delete(id: string, boundConnectionCount: number): void {
    const pool = this.pools.get(id);
    if (!pool) {
      throw new Error("Proxy pool not found");
    }

    if (boundConnectionCount > 0) {
      throw new Error(
        `Cannot delete proxy pool: it is bound to ${boundConnectionCount} connection(s)`
      );
    }

    this.pools.delete(id);
  }

  /**
   * Test proxy connectivity by performing a HEAD request (http type) or
   * GET with relay headers (vercel type) to a test URL.
   *
   * Updates the pool's testStatus, lastTestedAt, lastError, and isActive based on result.
   *
   * @param id - The proxy pool ID to test
   * @param options - Optional configuration: testUrl, timeoutMs (default 8000, max 30000)
   * @returns ProxyTestResult with ok, status, statusText, error, elapsedMs, testedAt
   */
  async testProxy(
    id: string,
    options?: { testUrl?: string; timeoutMs?: number }
  ): Promise<ProxyTestResult> {
    const pool = this.pools.get(id);
    if (!pool) {
      throw new Error("Proxy pool not found");
    }

    const testUrl = options?.testUrl ?? "https://www.google.com/";
    const timeoutMs = Math.min(options?.timeoutMs ?? 8000, 30000);
    const testedAt = new Date();
    const start = Date.now();

    let result: ProxyTestResult;

    try {
      if (pool.type === "http") {
        // Standard HTTP proxy: perform HEAD request through the proxy
        const dispatcher = new ProxyAgent(pool.proxyUrl);
        try {
          const response = await undiciRequest(testUrl, {
            method: "HEAD",
            dispatcher,
            signal: AbortSignal.timeout(timeoutMs),
          });
          const elapsedMs = Date.now() - start;

          result = {
            ok: response.statusCode >= 200 && response.statusCode < 400,
            status: response.statusCode,
            statusText: getStatusText(response.statusCode),
            elapsedMs,
            testedAt: testedAt.toISOString(),
          };
        } finally {
          await dispatcher.close();
        }
      } else {
        // Vercel relay: perform GET with x-relay-target and x-relay-path headers
        const targetUrlParsed = new URL(testUrl);
        const relayTarget = `${targetUrlParsed.protocol}//${targetUrlParsed.host}`;
        const relayPath = `${targetUrlParsed.pathname}${targetUrlParsed.search}`;

        const response = await undiciRequest(pool.proxyUrl, {
          method: "GET",
          headers: {
            "x-relay-target": relayTarget,
            "x-relay-path": relayPath,
          },
          signal: AbortSignal.timeout(timeoutMs),
        });
        const elapsedMs = Date.now() - start;

        result = {
          ok: response.statusCode >= 200 && response.statusCode < 400,
          status: response.statusCode,
          statusText: getStatusText(response.statusCode),
          elapsedMs,
          testedAt: testedAt.toISOString(),
        };
      }
    } catch (error) {
      const elapsedMs = Date.now() - start;
      const errorMessage = error instanceof Error ? error.message : "Unknown error";

      result = {
        ok: false,
        status: 0,
        error: errorMessage,
        elapsedMs,
        testedAt: testedAt.toISOString(),
      };
    }

    // Update pool state based on test result
    if (result.ok) {
      pool.testStatus = "active";
      pool.lastTestedAt = testedAt;
      pool.lastError = null;
    } else {
      pool.testStatus = "error";
      pool.lastTestedAt = testedAt;
      pool.lastError = result.error ?? `HTTP ${result.status}`;
      pool.isActive = false;
    }
    pool.updatedAt = new Date();
    this.pools.set(id, pool);

    return result;
  }

  listAll(): ProxyPool[] {
    return Array.from(this.pools.values());
  }

  load(pools: ProxyPool[]): void {
    this.pools.clear();
    for (const pool of pools) {
      this.pools.set(pool.id, pool);
    }
  }
}

/**
 * Map common HTTP status codes to status text.
 */
function getStatusText(statusCode: number): string {
  const statusTexts: Record<number, string> = {
    200: "OK",
    201: "Created",
    204: "No Content",
    301: "Moved Permanently",
    302: "Found",
    304: "Not Modified",
    400: "Bad Request",
    401: "Unauthorized",
    403: "Forbidden",
    404: "Not Found",
    405: "Method Not Allowed",
    408: "Request Timeout",
    500: "Internal Server Error",
    502: "Bad Gateway",
    503: "Service Unavailable",
    504: "Gateway Timeout",
  };
  return statusTexts[statusCode] ?? "";
}
