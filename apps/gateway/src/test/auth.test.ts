import { describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { testConfig } from "./helpers.js";

const authError = {
  error: {
    type: "authentication_error",
    message: "Missing or invalid API key",
    code: "invalid_api_key"
  }
};

describe("internal API auth", () => {
  it("rejects missing authorization", async () => {
    const app = await buildApp(testConfig());

    const response = await app.inject({
      method: "GET",
      url: "/v1/models"
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual(authError);

    await app.close();
  });

  it("rejects invalid internal API keys", async () => {
    const app = await buildApp(testConfig());

    const response = await app.inject({
      method: "GET",
      url: "/v1/models",
      headers: {
        authorization: "Bearer wrong-key"
      }
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual(authError);

    await app.close();
  });

  it("does not allow admin keys as normal internal API keys", async () => {
    const app = await buildApp(testConfig());

    const response = await app.inject({
      method: "GET",
      url: "/v1/models",
      headers: {
        authorization: "Bearer admin-key-1"
      }
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual(authError);

    await app.close();
  });

  it("returns 429 when per-key minute rate limit is exceeded", async () => {
    const app = await buildApp(
      testConfig({
        internalRateLimitPerMinute: 1
      })
    );

    const first = await app.inject({
      method: "GET",
      url: "/v1/models",
      headers: {
        authorization: "Bearer dev-key-1"
      }
    });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({
      method: "GET",
      url: "/v1/models",
      headers: {
        authorization: "Bearer dev-key-1"
      }
    });
    expect(second.statusCode).toBe(429);
    expect(second.json()).toEqual({
      error: {
        type: "rate_limit_error",
        message: "Internal rate limit exceeded",
        code: "internal_rate_limit_exceeded"
      }
    });

    await app.close();
  });

  it("returns 429 when per-key daily quota is exceeded", async () => {
    const app = await buildApp(
      testConfig({
        internalDailyRequestQuota: 1
      })
    );

    const first = await app.inject({
      method: "GET",
      url: "/v1/models",
      headers: {
        authorization: "Bearer dev-key-1"
      }
    });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({
      method: "GET",
      url: "/v1/models",
      headers: {
        authorization: "Bearer dev-key-1"
      }
    });
    expect(second.statusCode).toBe(429);
    expect(second.json()).toEqual({
      error: {
        type: "rate_limit_error",
        message: "Internal daily request quota exceeded",
        code: "internal_quota_exceeded"
      }
    });

    const otherKey = await app.inject({
      method: "GET",
      url: "/v1/models",
      headers: {
        authorization: "Bearer dev-key-2"
      }
    });
    expect(otherKey.statusCode).toBe(200);

    await app.close();
  });
});
