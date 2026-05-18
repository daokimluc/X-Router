import { describe, expect, it, beforeEach } from "vitest";
import { ProxyPoolService } from "../proxy/ProxyPoolService.js";

describe("ProxyPoolService", () => {
  let service: ProxyPoolService;

  beforeEach(() => {
    service = new ProxyPoolService();
  });

  describe("create", () => {
    it("creates a pool with required fields and defaults", () => {
      const pool = service.create({ name: "Test Pool", proxyUrl: "http://proxy:8080" });

      expect(pool.id).toBeDefined();
      expect(pool.name).toBe("Test Pool");
      expect(pool.proxyUrl).toBe("http://proxy:8080");
      expect(pool.noProxy).toBe("");
      expect(pool.isActive).toBe(true);
      expect(pool.strictProxy).toBe(false);
      expect(pool.type).toBe("http");
      expect(pool.testStatus).toBe("unknown");
      expect(pool.lastTestedAt).toBeNull();
      expect(pool.lastError).toBeNull();
      expect(pool.createdAt).toBeInstanceOf(Date);
      expect(pool.updatedAt).toBeInstanceOf(Date);
    });

    it("applies provided optional fields", () => {
      const pool = service.create({
        name: "Vercel Pool",
        proxyUrl: "https://relay.example.com",
        noProxy: ".internal.com,localhost",
        isActive: false,
        strictProxy: true,
        type: "vercel"
      });

      expect(pool.noProxy).toBe(".internal.com,localhost");
      expect(pool.isActive).toBe(false);
      expect(pool.strictProxy).toBe(true);
      expect(pool.type).toBe("vercel");
    });

    it("throws when name is empty", () => {
      expect(() => service.create({ name: "", proxyUrl: "http://proxy:8080" })).toThrow(
        "Name is required"
      );
    });

    it("throws when proxyUrl is empty", () => {
      expect(() => service.create({ name: "Pool", proxyUrl: "" })).toThrow(
        "Proxy URL is required"
      );
    });

    it("throws when name is whitespace only", () => {
      expect(() => service.create({ name: "   ", proxyUrl: "http://proxy:8080" })).toThrow(
        "Name is required"
      );
    });

    it("throws when proxyUrl is whitespace only", () => {
      expect(() => service.create({ name: "Pool", proxyUrl: "   " })).toThrow(
        "Proxy URL is required"
      );
    });
  });

  describe("getById", () => {
    it("returns the pool when it exists", () => {
      const created = service.create({ name: "Pool", proxyUrl: "http://proxy:8080" });
      const found = service.getById(created.id);
      expect(found).toEqual(created);
    });

    it("returns undefined for non-existent id", () => {
      expect(service.getById("non-existent")).toBeUndefined();
    });
  });

  describe("list", () => {
    it("returns all pools when no filter is provided", () => {
      service.create({ name: "Pool 1", proxyUrl: "http://p1:8080" });
      service.create({ name: "Pool 2", proxyUrl: "http://p2:8080", isActive: false });

      const pools = service.list();
      expect(pools).toHaveLength(2);
    });

    it("filters by isActive=true", () => {
      service.create({ name: "Active", proxyUrl: "http://p1:8080" });
      service.create({ name: "Inactive", proxyUrl: "http://p2:8080", isActive: false });

      const active = service.list({ isActive: true });
      expect(active).toHaveLength(1);
      expect(active[0].name).toBe("Active");
    });

    it("filters by isActive=false", () => {
      service.create({ name: "Active", proxyUrl: "http://p1:8080" });
      service.create({ name: "Inactive", proxyUrl: "http://p2:8080", isActive: false });

      const inactive = service.list({ isActive: false });
      expect(inactive).toHaveLength(1);
      expect(inactive[0].name).toBe("Inactive");
    });
  });

  describe("listWithUsage", () => {
    it("enriches pools with bound connection count", () => {
      const pool1 = service.create({ name: "Pool 1", proxyUrl: "http://p1:8080" });
      const pool2 = service.create({ name: "Pool 2", proxyUrl: "http://p2:8080" });

      const accounts = [
        { providerSpecificData: { proxyPoolId: pool1.id } },
        { providerSpecificData: { proxyPoolId: pool1.id } },
        { providerSpecificData: { proxyPoolId: pool2.id } },
        { providerSpecificData: {} },
        {}
      ];

      const result = service.listWithUsage(accounts);
      const p1 = result.find((p) => p.id === pool1.id)!;
      const p2 = result.find((p) => p.id === pool2.id)!;

      expect(p1.boundConnectionCount).toBe(2);
      expect(p2.boundConnectionCount).toBe(1);
    });

    it("applies isActive filter with usage", () => {
      service.create({ name: "Active", proxyUrl: "http://p1:8080" });
      service.create({ name: "Inactive", proxyUrl: "http://p2:8080", isActive: false });

      const result = service.listWithUsage([], { isActive: true });
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("Active");
      expect(result[0].boundConnectionCount).toBe(0);
    });
  });

  describe("update", () => {
    it("applies partial updates and updates updatedAt", async () => {
      const pool = service.create({ name: "Original", proxyUrl: "http://proxy:8080" });
      const originalUpdatedAt = pool.updatedAt;

      // Small delay to ensure updatedAt changes
      await new Promise((r) => setTimeout(r, 5));

      const updated = service.update(pool.id, { name: "Updated" });

      expect(updated.name).toBe("Updated");
      expect(updated.proxyUrl).toBe("http://proxy:8080");
      expect(updated.updatedAt.getTime()).toBeGreaterThan(originalUpdatedAt.getTime());
    });

    it("throws when pool not found", () => {
      expect(() => service.update("non-existent", { name: "X" })).toThrow(
        "Proxy pool not found"
      );
    });

    it("preserves unmodified fields", () => {
      const pool = service.create({
        name: "Pool",
        proxyUrl: "http://proxy:8080",
        noProxy: ".local",
        strictProxy: true,
        type: "vercel"
      });

      const updated = service.update(pool.id, { name: "New Name" });

      expect(updated.proxyUrl).toBe("http://proxy:8080");
      expect(updated.noProxy).toBe(".local");
      expect(updated.strictProxy).toBe(true);
      expect(updated.type).toBe("vercel");
      expect(updated.createdAt).toEqual(pool.createdAt);
    });
  });

  describe("delete", () => {
    it("deletes a pool with zero bound connections", () => {
      const pool = service.create({ name: "Pool", proxyUrl: "http://proxy:8080" });
      service.delete(pool.id, 0);
      expect(service.getById(pool.id)).toBeUndefined();
    });

    it("throws when pool has bound connections", () => {
      const pool = service.create({ name: "Pool", proxyUrl: "http://proxy:8080" });
      expect(() => service.delete(pool.id, 3)).toThrow("3 connection(s)");
    });

    it("throws when pool not found", () => {
      expect(() => service.delete("non-existent", 0)).toThrow("Proxy pool not found");
    });
  });

  describe("listAll", () => {
    it("returns all pools regardless of status", () => {
      service.create({ name: "Active", proxyUrl: "http://p1:8080" });
      service.create({ name: "Inactive", proxyUrl: "http://p2:8080", isActive: false });

      expect(service.listAll()).toHaveLength(2);
    });
  });

  describe("load", () => {
    it("replaces internal store with provided pools", () => {
      service.create({ name: "Existing", proxyUrl: "http://existing:8080" });

      const pools = [
        {
          id: "loaded-1",
          name: "Loaded Pool",
          proxyUrl: "http://loaded:8080",
          noProxy: "",
          isActive: true,
          strictProxy: false,
          type: "http" as const,
          testStatus: "unknown" as const,
          lastTestedAt: null,
          lastError: null,
          createdAt: new Date(),
          updatedAt: new Date()
        }
      ];

      service.load(pools);

      expect(service.listAll()).toHaveLength(1);
      expect(service.getById("loaded-1")?.name).toBe("Loaded Pool");
    });
  });
});
