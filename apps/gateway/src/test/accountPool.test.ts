import { describe, expect, it } from "vitest";
import { AccountPool, NoAvailableAccountError } from "../account-pool/AccountPool.js";
import { LeastBusyStrategy } from "../account-pool/LeastBusyStrategy.js";
import { WeightedRoundRobinStrategy } from "../account-pool/WeightedRoundRobinStrategy.js";
import type { ProviderAccount } from "../providers/base/ProviderAccount.js";

function makeAccount(
  id: string,
  overrides: Partial<ProviderAccount> = {}
): ProviderAccount {
  const now = new Date("2026-01-01T00:00:00.000Z");

  return {
    id,
    providerInstanceId: "provider_mock_main",
    providerType: "mock",
    displayName: id,
    status: "active",
    weight: 1,
    maxConcurrency: 1,
    credentialRef: `secret_${id}`,
    runtime: {
      activeRequests: 0,
      totalRequests: 0,
      failedRequests: 0,
      consecutiveFailures: 0
    },
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

describe("AccountPool", () => {
  it("selects accounts in round-robin order", () => {
    const pool = new AccountPool([makeAccount("a"), makeAccount("b")]);

    const first = pool.acquire();
    first.releaseSuccess();
    const second = pool.acquire();
    second.releaseSuccess();
    const third = pool.acquire();

    expect(first.account.id).toBe("a");
    expect(second.account.id).toBe("b");
    expect(third.account.id).toBe("a");
  });

  it("skips cooldown accounts", () => {
    const pool = new AccountPool([
      makeAccount("a", {
        status: "cooldown",
        runtime: {
          activeRequests: 0,
          totalRequests: 0,
          failedRequests: 0,
          consecutiveFailures: 0,
          cooldownUntil: new Date("2026-01-01T01:00:00.000Z")
        }
      }),
      makeAccount("b")
    ]);

    expect(pool.acquire({ now: new Date("2026-01-01T00:00:00.000Z") }).account.id).toBe(
      "b"
    );
  });

  it("skips disabled accounts", () => {
    const pool = new AccountPool([
      makeAccount("a", {
        status: "disabled"
      }),
      makeAccount("b")
    ]);

    expect(pool.acquire().account.id).toBe("b");
  });

  it("skips accounts that exceed max concurrency", () => {
    const pool = new AccountPool([makeAccount("a"), makeAccount("b")]);

    const first = pool.acquire();
    const second = pool.acquire();

    expect(first.account.id).toBe("a");
    expect(second.account.id).toBe("b");
  });

  it("throws when no account is available", () => {
    const pool = new AccountPool([makeAccount("a")]);

    pool.acquire();

    expect(() => pool.acquire()).toThrow(NoAvailableAccountError);
  });

  it("reactivates accounts after cooldown expires", () => {
    const pool = new AccountPool([
      makeAccount("a", {
        status: "cooldown",
        runtime: {
          activeRequests: 0,
          totalRequests: 0,
          failedRequests: 0,
          consecutiveFailures: 0,
          cooldownUntil: new Date("2026-01-01T00:00:00.000Z")
        }
      })
    ]);

    const lease = pool.acquire({
      now: new Date("2026-01-01T00:00:01.000Z")
    });

    expect(lease.account.id).toBe("a");
    expect(pool.getAccount("a")?.status).toBe("active");
  });

  it("updates counters on success and failure release", () => {
    const pool = new AccountPool([makeAccount("a", { maxConcurrency: 2 })]);

    const success = pool.acquire();
    success.releaseSuccess();
    const afterSuccess = pool.getAccount("a");

    expect(afterSuccess?.runtime.activeRequests).toBe(0);
    expect(afterSuccess?.runtime.totalRequests).toBe(1);
    expect(afterSuccess?.runtime.consecutiveFailures).toBe(0);
    expect(afterSuccess?.runtime.lastSuccessAt).toBeInstanceOf(Date);

    const failure = pool.acquire();
    failure.releaseFailure("rate limited");
    const afterFailure = pool.getAccount("a");

    expect(afterFailure?.runtime.activeRequests).toBe(0);
    expect(afterFailure?.runtime.totalRequests).toBe(2);
    expect(afterFailure?.runtime.failedRequests).toBe(1);
    expect(afterFailure?.runtime.consecutiveFailures).toBe(1);
    expect(afterFailure?.runtime.lastError).toBe("rate limited");

    const recovery = pool.acquire();
    recovery.releaseSuccess();
    const afterRecovery = pool.getAccount("a");

    expect(afterRecovery?.runtime.lastError).toBeUndefined();
  });

  it("filters accounts by allowed model", () => {
    const pool = new AccountPool([
      makeAccount("a", {
        allowedModels: ["kiro-sonnet"]
      }),
      makeAccount("b", {
        allowedModels: ["windsurf-sonnet"]
      })
    ]);

    expect(pool.acquire({ model: "windsurf-sonnet" }).account.id).toBe("b");
  });

  it("supports least-busy selection", () => {
    const pool = new AccountPool(
      [
        makeAccount("a", {
          maxConcurrency: 3,
          runtime: {
            activeRequests: 2,
            totalRequests: 0,
            failedRequests: 0,
            consecutiveFailures: 0
          }
        }),
        makeAccount("b", {
          maxConcurrency: 3,
          runtime: {
            activeRequests: 1,
            totalRequests: 0,
            failedRequests: 0,
            consecutiveFailures: 0
          }
        })
      ],
      new LeastBusyStrategy()
    );

    expect(pool.acquire().account.id).toBe("b");
  });

  it("supports weighted round-robin selection", () => {
    const pool = new AccountPool(
      [
        makeAccount("a", { maxConcurrency: 10, weight: 2 }),
        makeAccount("b", { maxConcurrency: 10, weight: 1 })
      ],
      new WeightedRoundRobinStrategy()
    );

    const first = pool.acquire();
    const second = pool.acquire();
    const third = pool.acquire();

    expect([first.account.id, second.account.id, third.account.id]).toEqual([
      "a",
      "a",
      "b"
    ]);
  });
});
