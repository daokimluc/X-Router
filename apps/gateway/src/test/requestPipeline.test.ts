import { describe, expect, it } from "vitest";
import { classifyError } from "../routes/pipeline/RequestPipeline.js";
import { NoAvailableAccountError } from "../account-pool/AccountPool.js";
import { CircuitBreakerOpenError } from "../services/CircuitBreaker.js";
import { ConcurrencyLimitError } from "../services/ConcurrencyLimiter.js";
import {
  ProviderError,
  ProviderRateLimitError,
  ProviderTimeoutError,
  ProviderUnavailableError,
  ProviderAuthError
} from "../providers/base/ProviderErrors.js";

describe("RequestPipeline error classification (R3 capacity failover)", () => {
  it("treats capacity/admission errors as failover signals (not abort)", () => {
    expect(classifyError(new NoAvailableAccountError())).toBe("capacity");
    expect(classifyError(new CircuitBreakerOpenError("p1"))).toBe("capacity");
    expect(classifyError(new ConcurrencyLimitError("provider_overloaded", "x"))).toBe("capacity");
  });

  it("treats transient provider errors as retryable", () => {
    expect(classifyError(new ProviderRateLimitError("kiro", 5))).toBe("retryable");
    expect(classifyError(new ProviderTimeoutError("kiro", "https://x", 1000))).toBe("retryable");
    expect(classifyError(new ProviderUnavailableError("kiro", 503))).toBe("retryable");
  });

  it("treats auth/config/unknown errors as terminal", () => {
    expect(classifyError(new ProviderAuthError("kiro", "bad token"))).toBe("terminal");
    expect(
      classifyError(new ProviderError({ code: "provider_bad_response", message: "x", retryable: false }))
    ).toBe("terminal");
    expect(classifyError(new Error("boom"))).toBe("terminal");
    expect(classifyError("not even an error")).toBe("terminal");
  });
});
