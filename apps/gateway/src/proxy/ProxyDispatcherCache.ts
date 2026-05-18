import { ProxyAgent } from "undici";

/**
 * Lazily creates and caches HTTP proxy agent dispatchers keyed by proxy URL.
 * Reuses existing dispatchers to avoid connection overhead when multiple
 * requests use the same proxy.
 */
export class ProxyDispatcherCache {
  private cache = new Map<string, ProxyAgent>();

  /**
   * Get or create a ProxyAgent dispatcher for the given proxy URL.
   * Reuses existing dispatchers to avoid connection overhead.
   */
  get(proxyUrl: string): ProxyAgent {
    let agent = this.cache.get(proxyUrl);
    if (!agent) {
      agent = new ProxyAgent(proxyUrl);
      this.cache.set(proxyUrl, agent);
    }
    return agent;
  }

  /**
   * Remove a cached dispatcher (e.g., when proxy pool is deleted or URL changes).
   */
  remove(proxyUrl: string): void {
    const agent = this.cache.get(proxyUrl);
    if (agent) {
      agent.close();
      this.cache.delete(proxyUrl);
    }
  }

  /**
   * Close all cached dispatchers and clear the cache.
   */
  closeAll(): void {
    for (const agent of this.cache.values()) {
      agent.close();
    }
    this.cache.clear();
  }
}
