import { describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { testConfig } from "./helpers.js";

describe("GET /", () => {
  it("serves the dashboard index.html", async () => {
    const app = await buildApp(testConfig());

    const response = await app.inject({
      method: "GET",
      url: "/"
    });

    // dashboard-dist/index.html is committed, so the static plugin
    // serves it on root requests.
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toMatch(/text\/html/);

    await app.close();
  });
});
