import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { buildApp } from "../app.js";
import { testConfig } from "./helpers.js";
import type { FastifyInstance } from "fastify";

describe("Latency endpoints (Phase 32)", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildApp(testConfig());
  });

  afterEach(async () => {
    await app.close();
  });

  it("GET /admin/v1/metrics/latency requires admin auth", async () => {
    const r = await app.inject({ method: "GET", url: "/admin/v1/metrics/latency" });
    expect(r.statusCode).toBe(401);
  });

  it("GET /admin/v1/metrics/latency returns empty snapshot when no traffic", async () => {
    const r = await app.inject({
      method: "GET",
      url: "/admin/v1/metrics/latency",
      headers: { authorization: "Bearer admin-key-1" }
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.windowSeconds).toBe(300);
    expect(body.tuples).toEqual([]);
  });

  it("GET /admin/v1/metrics/latency reflects recorded samples", async () => {
    app.latencyTracker.record({
      providerInstanceId: "kiro_main",
      publicModel: "claude-opus-4-7",
      accountId: "acc_1",
      durationMs: 850,
      ok: true
    });

    const r = await app.inject({
      method: "GET",
      url: "/admin/v1/metrics/latency",
      headers: { authorization: "Bearer admin-key-1" }
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.tuples).toHaveLength(1);
    expect(body.tuples[0].providerInstanceId).toBe("kiro_main");
    expect(body.tuples[0].ok.count).toBe(1);
    expect(body.tuples[0].ok.p50).toBe(1000);
  });

  it("GET /metrics emits histogram cumulative buckets when latency is recorded", async () => {
    app.latencyTracker.record({
      providerInstanceId: "kiro_main",
      publicModel: "claude-opus-4-7",
      accountId: "acc_1",
      durationMs: 850,
      ok: true
    });

    const r = await app.inject({
      method: "GET",
      url: "/metrics",
      headers: { authorization: "Bearer admin-key-1" }
    });
    expect(r.statusCode).toBe(200);
    expect(r.headers["content-type"]).toMatch(/text\/plain/);
    expect(r.body).toContain("gateway_request_duration_ms_bucket");
    expect(r.body).toContain('le="+Inf"');
    expect(r.body).toMatch(/gateway_request_duration_ms_count\{[^}]*\} 1/);

    const bucketLines = r.body.split("\n").filter((l) =>
      l.startsWith("gateway_request_duration_ms_bucket{") &&
      l.includes('provider="kiro_main"')
    );
    let lastCount = -1;
    for (const line of bucketLines) {
      const m = line.match(/\}\s+(\d+)$/);
      expect(m).toBeTruthy();
      const count = Number(m![1]);
      expect(count).toBeGreaterThanOrEqual(lastCount);
      lastCount = count;
    }
  });

  it("GET /metrics requires auth by default", async () => {
    const r = await app.inject({ method: "GET", url: "/metrics" });
    expect(r.statusCode).toBe(401);
  });
});
