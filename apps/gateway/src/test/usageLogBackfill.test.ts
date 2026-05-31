import { describe, expect, it } from "vitest";
import { Database } from "../services/Database.js";
import { UsageLogStore } from "../services/UsageLogStore.js";

describe("UsageLogStore.importRows (legacy usage backfill)", () => {
  it("imports historical rows preserving id + timestamp, idempotently", () => {
    const db = new Database(":memory:");
    const store = new UsageLogStore(db);
    expect(store.count()).toBe(0);

    const ts = new Date("2026-05-29T11:00:52.553Z").getTime();
    const rows = [
      { id: "usage_a", ts, requestId: "r1", apiKeyHash: "h1", model: "claude-opus-4-7", providerType: "kiro", protocol: "anthropic", promptTokens: 57, completionTokens: 54, totalTokens: 111, estimatedCost: 0.001 },
      { id: "usage_b", ts: ts + 1000, model: "gpt-5.5", providerType: "openai", protocol: "openai", promptTokens: 10, completionTokens: 20, totalTokens: 30 }
    ];

    expect(store.importRows(rows)).toBe(2);
    expect(store.count()).toBe(2);

    // Original timestamp preserved (not Date.now()).
    const q = store.query({ limit: 10 });
    const a = q.data.find((r) => r.id === "usage_a")!;
    expect(a.ts).toBe(ts);
    expect(a.model).toBe("claude-opus-4-7");
    expect(a.totalTokens).toBe(111);

    // Re-import is a no-op (INSERT OR IGNORE on id).
    expect(store.importRows(rows)).toBe(0);
    expect(store.count()).toBe(2);

    db.close();
  });

  it("skips a malformed row without aborting the batch", () => {
    const db = new Database(":memory:");
    const store = new UsageLogStore(db);
    const inserted = store.importRows([
      { id: "ok1", ts: Date.now(), promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      { id: "ok2", ts: Date.now(), promptTokens: 3, completionTokens: 4, totalTokens: 7 }
    ]);
    expect(inserted).toBe(2);
    db.close();
  });
});
