import { describe, expect, it } from "vitest";
import { RefreshLockService } from "../services/RefreshLockService.js";
import type { ProviderAccount } from "../providers/base/ProviderAccount.js";

function makeAccount(id: string): ProviderAccount {
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
    updatedAt: now
  };
}

describe("RefreshLockService", () => {
  it("runs refresh tasks sequentially for the same account", async () => {
    const refreshLock = new RefreshLockService();
    const account = makeAccount("account_1");
    const events: string[] = [];

    await Promise.all([
      refreshLock.runForAccount(account, async () => {
        events.push("first:start");
        await new Promise((resolve) => setTimeout(resolve, 20));
        events.push("first:end");
        return {
          refreshed: true
        };
      }),
      refreshLock.runForAccount(account, async () => {
        events.push("second:start");
        events.push("second:end");
        return {
          refreshed: true
        };
      })
    ]);

    expect(events).toEqual([
      "first:start",
      "first:end",
      "second:start",
      "second:end"
    ]);
  });

  it("allows different accounts to refresh independently", async () => {
    const refreshLock = new RefreshLockService();
    const events: string[] = [];

    await Promise.all([
      refreshLock.runForAccount(makeAccount("account_1"), async () => {
        events.push("first");
        return {
          refreshed: true
        };
      }),
      refreshLock.runForAccount(makeAccount("account_2"), async () => {
        events.push("second");
        return {
          refreshed: true
        };
      })
    ]);

    expect(events.sort()).toEqual(["first", "second"]);
  });
});

