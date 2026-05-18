import { describe, expect, it } from "vitest";
import { shouldBypassProxy } from "../proxy/noProxyMatcher.js";

describe("shouldBypassProxy", () => {
  describe("empty/falsy noProxyPatterns", () => {
    it("returns false when noProxyPatterns is empty string", () => {
      expect(shouldBypassProxy("https://example.com/path", "")).toBe(false);
    });
  });

  describe("wildcard pattern", () => {
    it("returns true when pattern is *", () => {
      expect(shouldBypassProxy("https://anything.com/path", "*")).toBe(true);
    });

    it("returns true when * is among other patterns", () => {
      expect(
        shouldBypassProxy("https://anything.com/path", "localhost, *")
      ).toBe(true);
    });
  });

  describe("exact hostname match", () => {
    it("matches exact hostname", () => {
      expect(
        shouldBypassProxy("https://example.com/path", "example.com")
      ).toBe(true);
    });

    it("is case-insensitive", () => {
      expect(
        shouldBypassProxy("https://Example.COM/path", "example.com")
      ).toBe(true);
    });

    it("does not match subdomains for exact pattern", () => {
      expect(
        shouldBypassProxy("https://sub.example.com/path", "example.com")
      ).toBe(false);
    });

    it("does not match partial hostnames", () => {
      expect(
        shouldBypassProxy("https://notexample.com/path", "example.com")
      ).toBe(false);
    });
  });

  describe("dot-prefix pattern (.example.com)", () => {
    it("matches subdomains", () => {
      expect(
        shouldBypassProxy("https://sub.example.com/path", ".example.com")
      ).toBe(true);
    });

    it("matches deeply nested subdomains", () => {
      expect(
        shouldBypassProxy(
          "https://deep.sub.example.com/path",
          ".example.com"
        )
      ).toBe(true);
    });

    it("matches the domain itself (without leading dot)", () => {
      expect(
        shouldBypassProxy("https://example.com/path", ".example.com")
      ).toBe(true);
    });

    it("does not match unrelated domains", () => {
      expect(
        shouldBypassProxy("https://other.com/path", ".example.com")
      ).toBe(false);
    });

    it("does not match domains that merely end with the same suffix", () => {
      expect(
        shouldBypassProxy("https://notexample.com/path", ".example.com")
      ).toBe(false);
    });
  });

  describe("multiple patterns", () => {
    it("matches if any pattern matches", () => {
      const patterns = "localhost,.internal.com,example.org";
      expect(shouldBypassProxy("https://localhost/path", patterns)).toBe(true);
      expect(
        shouldBypassProxy("https://api.internal.com/path", patterns)
      ).toBe(true);
      expect(shouldBypassProxy("https://example.org/path", patterns)).toBe(
        true
      );
    });

    it("returns false if no pattern matches", () => {
      const patterns = "localhost,.internal.com";
      expect(shouldBypassProxy("https://external.com/path", patterns)).toBe(
        false
      );
    });

    it("handles whitespace around patterns", () => {
      expect(
        shouldBypassProxy("https://example.com/path", "  example.com  , other.com ")
      ).toBe(true);
    });

    it("skips empty patterns after split", () => {
      expect(
        shouldBypassProxy("https://example.com/path", "example.com,,,.other.com")
      ).toBe(true);
    });
  });

  describe("edge cases", () => {
    it("returns false for invalid URL", () => {
      expect(shouldBypassProxy("not-a-url", "example.com")).toBe(false);
    });

    it("returns false for empty URL", () => {
      expect(shouldBypassProxy("", "example.com")).toBe(false);
    });

    it("handles URL with port", () => {
      expect(
        shouldBypassProxy("https://example.com:8080/path", "example.com")
      ).toBe(true);
    });

    it("handles IP address as hostname", () => {
      expect(
        shouldBypassProxy("http://192.168.1.1:3000/api", "192.168.1.1")
      ).toBe(true);
    });

    it("handles localhost", () => {
      expect(
        shouldBypassProxy("http://localhost:3000/api", "localhost")
      ).toBe(true);
    });
  });
});
