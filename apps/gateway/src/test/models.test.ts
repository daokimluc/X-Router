import { describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { testConfig } from "./helpers.js";

describe("GET /v1/models", () => {
  it("returns model mappings and routing profiles with a valid internal API key", async () => {
    const app = await buildApp(testConfig());

    const response = await app.inject({
      method: "GET",
      url: "/v1/models",
      headers: {
        authorization: "Bearer dev-key-1"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      object: "list",
      data: [
        {
          id: "kiro-sonnet",
          object: "model",
          owned_by: "internal-ai-gateway"
        },
        {
          id: "windsurf-sonnet",
          object: "model",
          owned_by: "internal-ai-gateway"
        },
        {
          id: "auto",
          object: "model",
          owned_by: "internal-ai-gateway"
        },
        {
          id: "coding",
          object: "model",
          owned_by: "internal-ai-gateway"
        },
        {
          id: "fast",
          object: "model",
          owned_by: "internal-ai-gateway"
        },
        {
          id: "balanced",
          object: "model",
          owned_by: "internal-ai-gateway"
        },
        {
          id: "strong",
          object: "model",
          owned_by: "internal-ai-gateway"
        }
      ]
    });

    await app.close();
  });

  it("echoes a safe request ID", async () => {
    const app = await buildApp(testConfig());

    const response = await app.inject({
      method: "GET",
      url: "/v1/models",
      headers: {
        authorization: "Bearer dev-key-1",
        "x-request-id": "test-request-1"
      }
    });

    expect(response.headers["x-request-id"]).toBe("test-request-1");

    await app.close();
  });
});
