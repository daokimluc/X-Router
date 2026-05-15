import { describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { testConfig } from "./helpers.js";

describe("GET /", () => {
  it("attempts to serve dashboard index.html (404 when dashboard-dist is missing)", async () => {
    const app = await buildApp(testConfig());

    const response = await app.inject({
      method: "GET",
      url: "/"
    });

    // In test environment without dashboard-dist/, the static plugin
    // cannot find index.html so the not-found handler serves 404.
    // In production with dashboard-dist/ present, this would return 200 with index.html.
    expect(response.statusCode).toBe(404);

    await app.close();
  });
});
