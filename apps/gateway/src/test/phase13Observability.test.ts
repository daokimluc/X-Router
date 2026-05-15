import { describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { testConfig } from "./helpers.js";

describe("Phase 13 observability and config revisions", () => {
  it("requires auth for readyz", async () => {
    const app = await buildApp(testConfig());

    const response = await app.inject({
      method: "GET",
      url: "/readyz"
    });

    expect(response.statusCode).toBe(401);

    await app.close();
  });

  it("returns readiness checks with an internal key", async () => {
    const app = await buildApp(testConfig());

    const response = await app.inject({
      method: "GET",
      url: "/readyz",
      headers: {
        authorization: "Bearer dev-key-1"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: "ready",
      checks: {
        providerRegistry: true,
        providerRuntime: true,
        modelRegistry: true
      }
    });

    await app.close();
  });

  it("exposes metrics only to internal or admin callers", async () => {
    const app = await buildApp(testConfig());

    const unauthenticated = await app.inject({
      method: "GET",
      url: "/metrics"
    });
    expect(unauthenticated.statusCode).toBe(401);

    await app.inject({
      method: "GET",
      url: "/healthz"
    });

    const response = await app.inject({
      method: "GET",
      url: "/metrics",
      headers: {
        authorization: "Bearer admin-key-1"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("gateway_requests_total");
    expect(response.body).toContain("gateway_requests_by_status_total");

    await app.close();
  });

  it("allows dynamically created API keys to access readyz and metrics", async () => {
    const app = await buildApp(testConfig());

    const createKey = await app.inject({
      method: "POST",
      url: "/admin/v1/api-keys",
      headers: {
        authorization: "Bearer admin-key-1"
      },
      payload: {
        owner: "observability"
      }
    });
    const apiKey = createKey.json().key;

    const readyz = await app.inject({
      method: "GET",
      url: "/readyz",
      headers: {
        authorization: `Bearer ${apiKey}`
      }
    });
    expect(readyz.statusCode).toBe(200);

    const metrics = await app.inject({
      method: "GET",
      url: "/metrics",
      headers: {
        authorization: `Bearer ${apiKey}`
      }
    });
    expect(metrics.statusCode).toBe(200);

    await app.close();
  });

  it("lists request logs through the admin API", async () => {
    const app = await buildApp(testConfig());

    await app.inject({
      method: "GET",
      url: "/healthz"
    });

    const response = await app.inject({
      method: "GET",
      url: "/admin/v1/request-logs",
      headers: {
        authorization: "Bearer admin-key-1"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: "GET",
          statusCode: 200
        })
      ])
    );

    await app.close();
  });

  it("publishes and rolls back config revisions", async () => {
    const app = await buildApp(testConfig());
    const headers = {
      authorization: "Bearer admin-key-1"
    };

    const firstPublish = await app.inject({
      method: "POST",
      url: "/admin/v1/config/publish",
      headers,
      payload: {
        config: {
          routingMode: "first"
        }
      }
    });
    expect(firstPublish.statusCode).toBe(200);
    const firstRevision = firstPublish.json();

    const secondPublish = await app.inject({
      method: "POST",
      url: "/admin/v1/config/publish",
      headers,
      payload: {
        config: {
          routingMode: "second"
        }
      }
    });
    expect(secondPublish.statusCode).toBe(200);

    const rollback = await app.inject({
      method: "POST",
      url: `/admin/v1/config/revisions/${firstRevision.id}/rollback`,
      headers
    });
    expect(rollback.statusCode).toBe(200);
    expect(rollback.json()).toMatchObject({
      version: 3,
      config: {
        routingMode: "first"
      }
    });

    const current = await app.inject({
      method: "GET",
      url: "/admin/v1/config/current",
      headers
    });
    expect(current.json().data).toEqual({
      routingMode: "first"
    });

    const audit = await app.inject({
      method: "GET",
      url: "/admin/v1/audit-logs",
      headers
    });
    expect(audit.json().data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: "config.publish" }),
        expect.objectContaining({ action: "config.rollback" })
      ])
    );

    await app.close();
  });
});
