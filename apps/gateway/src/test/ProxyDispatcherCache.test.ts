import { describe, expect, it, afterEach } from "vitest";
import { ProxyDispatcherCache } from "../proxy/ProxyDispatcherCache.js";

describe("ProxyDispatcherCache", () => {
  let cache: ProxyDispatcherCache;

  afterEach(() => {
    cache?.closeAll();
  });

  it("creates a new ProxyAgent for an unseen proxy URL", () => {
    cache = new ProxyDispatcherCache();
    const agent = cache.get("http://proxy.example.com:8080");
    expect(agent).toBeDefined();
    expect(agent.constructor.name).toBe("ProxyAgent");
  });

  it("returns the same ProxyAgent for the same proxy URL", () => {
    cache = new ProxyDispatcherCache();
    const url = "http://proxy.example.com:8080";
    const agent1 = cache.get(url);
    const agent2 = cache.get(url);
    expect(agent1).toBe(agent2);
  });

  it("returns different ProxyAgents for different proxy URLs", () => {
    cache = new ProxyDispatcherCache();
    const agent1 = cache.get("http://proxy1.example.com:8080");
    const agent2 = cache.get("http://proxy2.example.com:9090");
    expect(agent1).not.toBe(agent2);
  });

  it("removes a cached dispatcher", () => {
    cache = new ProxyDispatcherCache();
    const url = "http://proxy.example.com:8080";
    const agent1 = cache.get(url);
    cache.remove(url);
    const agent2 = cache.get(url);
    expect(agent2).not.toBe(agent1);
  });

  it("remove is a no-op for unknown URLs", () => {
    cache = new ProxyDispatcherCache();
    // Should not throw
    cache.remove("http://unknown.proxy.com:1234");
  });

  it("closeAll clears all cached dispatchers", () => {
    cache = new ProxyDispatcherCache();
    const url1 = "http://proxy1.example.com:8080";
    const url2 = "http://proxy2.example.com:9090";
    const agent1 = cache.get(url1);
    const agent2 = cache.get(url2);
    cache.closeAll();
    // After closeAll, getting the same URLs should create new agents
    const newAgent1 = cache.get(url1);
    const newAgent2 = cache.get(url2);
    expect(newAgent1).not.toBe(agent1);
    expect(newAgent2).not.toBe(agent2);
  });
});
