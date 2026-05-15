import { describe, expect, it } from "vitest";
import { hashApiKey } from "../utils/hash.js";
import { redactObject } from "../utils/redaction.js";

describe("redaction utilities", () => {
  it("redacts sensitive keys recursively", () => {
    expect(
      redactObject({
        authorization: "Bearer secret",
        cookie: "sid=secret",
        nested: {
          accessToken: "access-token",
          refresh_token: "refresh-token",
          session_cookie: "session-cookie",
          providerToken: "provider-token",
          normal: "visible"
        }
      })
    ).toEqual({
      authorization: "[REDACTED]",
      cookie: "[REDACTED]",
      nested: {
        accessToken: "[REDACTED]",
        refresh_token: "[REDACTED]",
        session_cookie: "[REDACTED]",
        providerToken: "[REDACTED]",
        normal: "visible"
      }
    });
  });

  it("hashes API keys without exposing the raw value", () => {
    const hash = hashApiKey("dev-key-1");

    expect(hash).toHaveLength(12);
    expect(hash).not.toContain("dev-key-1");
  });
});
