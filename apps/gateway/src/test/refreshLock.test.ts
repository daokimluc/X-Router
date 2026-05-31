import { describe, expect, it } from "vitest";
import { RefreshLockService } from "../services/RefreshLockService.js";
import type { ProviderAccount } from "../providers/base/ProviderAccount.js";
import { LocalEncryptionService } from "../services/LocalEncryptionService.js";
import { SecretService } from "../services/SecretService.js";
import type { ProviderInstance } from "../providers/base/ProviderInstance.js";
import type { SessionRefreshResult } from "../providers/base/types.js";

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

const PROVIDER_INSTANCE = { type: "mock" } as unknown as ProviderInstance;

function buildSecretService(accountId: string, payload: Record<string, unknown>): SecretService {
  const enc = new LocalEncryptionService("test-key");
  const svc = new SecretService(enc);
  svc.addSecret({
    id: `secret_${accountId}`,
    accountId,
    credentialType: "oauth",
    encryptedPayload: enc.encryptJson(payload),
    updatedAt: new Date("2026-01-01T00:00:00.000Z")
  });
  return svc;
}

describe("RefreshLockService.refreshIfNeeded", () => {
  it("runs exactly one refresh when two on-401 paths race for one account", async () => {
    const refreshLock = new RefreshLockService();
    const account = makeAccount("account_1");
    const secretService = buildSecretService("account_1", {
      accessToken: "old-token",
      refreshToken: "rt-1"
    });

    let refreshCalls = 0;
    const adapter = {
      refreshSession: async (): Promise<SessionRefreshResult> => {
        refreshCalls += 1;
        await new Promise((r) => setTimeout(r, 10));
        return {
          refreshed: true,
          credentialPayload: { accessToken: "new-token", refreshToken: "rt-2" }
        };
      }
    };

    const [a, b] = await Promise.all([
      refreshLock.refreshIfNeeded({
        account,
        adapter,
        providerInstance: PROVIDER_INSTANCE,
        secretService,
        trigger: "on_auth_error",
        staleAccessToken: "old-token"
      }),
      refreshLock.refreshIfNeeded({
        account,
        adapter,
        providerInstance: PROVIDER_INSTANCE,
        secretService,
        trigger: "on_auth_error",
        staleAccessToken: "old-token"
      })
    ]);

    // Only one refresh actually ran; the other observed the rotated token + skipped.
    expect(refreshCalls).toBe(1);
    const refreshed = [a, b].filter((r) => r.refreshed);
    const skipped = [a, b].filter((r) => r.skipped);
    expect(refreshed).toHaveLength(1);
    expect(skipped).toHaveLength(1);
    expect(skipped[0]?.reason).toBe("token_already_rotated");
  });

  it("background trigger skips when the credential is already fresh in-lock", async () => {
    const refreshLock = new RefreshLockService();
    const account = makeAccount("account_2");
    const future = new Date(Date.now() + 60 * 60_000).toISOString();
    const secretService = buildSecretService("account_2", {
      accessToken: "tok",
      refreshToken: "rt",
      expiresAt: future
    });

    let refreshCalls = 0;
    const adapter = {
      refreshSession: async (): Promise<SessionRefreshResult> => {
        refreshCalls += 1;
        return { refreshed: true, credentialPayload: { accessToken: "x" } };
      }
    };

    const outcome = await refreshLock.refreshIfNeeded({
      account,
      adapter,
      providerInstance: PROVIDER_INSTANCE,
      secretService,
      trigger: "background",
      refreshBeforeMs: 5 * 60_000
    });

    expect(refreshCalls).toBe(0);
    expect(outcome.skipped).toBe(true);
    expect(outcome.reason).toBe("already_fresh");
  });

  it("background loop and on-401 within the same window cause a single refresh", async () => {
    const refreshLock = new RefreshLockService();
    const account = makeAccount("account_3");
    // Expires soon → background loop would refresh.
    const soon = new Date(Date.now() + 60_000).toISOString();
    const secretService = buildSecretService("account_3", {
      accessToken: "old",
      refreshToken: "rt",
      expiresAt: soon
    });

    let refreshCalls = 0;
    const adapter = {
      refreshSession: async (): Promise<SessionRefreshResult> => {
        refreshCalls += 1;
        await new Promise((r) => setTimeout(r, 10));
        return {
          refreshed: true,
          credentialPayload: {
            accessToken: "fresh",
            refreshToken: "rt2",
            expiresAt: new Date(Date.now() + 60 * 60_000).toISOString()
          }
        };
      }
    };

    const [bg, on401] = await Promise.all([
      refreshLock.refreshIfNeeded({
        account,
        adapter,
        providerInstance: PROVIDER_INSTANCE,
        secretService,
        trigger: "background",
        refreshBeforeMs: 5 * 60_000
      }),
      refreshLock.refreshIfNeeded({
        account,
        adapter,
        providerInstance: PROVIDER_INSTANCE,
        secretService,
        trigger: "on_auth_error",
        staleAccessToken: "old"
      })
    ]);

    expect(refreshCalls).toBe(1);
    expect([bg, on401].filter((r) => r.refreshed)).toHaveLength(1);
    expect([bg, on401].filter((r) => r.skipped)).toHaveLength(1);
  });
});


