import { describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { testConfig } from "./helpers.js";

describe("body size limit", () => {
  it("returns 413 for oversized request bodies", async () => {
    const app = await buildApp(testConfig({ requestBodyLimit: "16b" }));

    const response = await app.inject({
      method: "POST",
      url: "/v1/models",
      headers: {
        authorization: "Bearer dev-key-1",
        "content-type": "application/json"
      },
      payload: {
        value: "this payload is intentionally larger than sixteen bytes"
      }
    });

    expect(response.statusCode).toBe(413);
    expect(response.json()).toEqual({
      error: {
        type: "request_error",
        message: "Request body too large",
        code: "payload_too_large"
      }
    });

    await app.close();
  });
});

