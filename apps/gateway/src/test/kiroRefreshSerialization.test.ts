import { describe, expect, it } from "vitest";
import { KiroProviderAdapter } from "../providers/adapters/kiro/KiroProviderAdapter.js";
import { RefreshLockService } from "../services/RefreshLockService.js";
import type { ProviderInstance } from "../providers/base/ProviderInstance.js";

const providerInstance = {
  id: "provider_kiro_main",
  type: "kiro",
  name: "Kiro",
  enabled: true,
  config: { baseUrl: "https://kiro.test", chatCompletionsPath: "/chat", defaultModel: "sonnet" },
  defaultTimeoutMs: 30000,
  maxRetries: 0,
  cooldownMs: 30000,
  accountSelectionStrategy: "round_robin",
  maxConcurrentRequests: 10,
  maxConcurrentRequestsPerAccount: 3,
  circuitBreaker: { enabled: true, failureThreshold: 5, cooldownMs: 30000, halfOpenMaxRequests: 1 },
  createdAt: new Date(),
  updatedAt: new Date()
} as ProviderInstance;

describe("Kiro in-band refresh serialization (refreshCoordinator)", () => {
  it("two concurrent expired-token requests for one account refresh exactly once", async () => {
    const refreshLock = new RefreshLockService();

    // A live credential store the coordinator re-reads inside the lock.
    let live: Record<string, unknown> = {
      refreshToken: "rt-old",
      expiresAt: new Date(Date.now() - 60_000).toISOString() // expired -> needs refresh
    };

    let refreshCalls = 0;
    const authClient = {
      refreshToken: async (_cred: unknown) => {
        refreshCalls += 1;
        await new Promise((r) => setTimeout(r, 10));
        return {
          accessToken: "at-new",
          refreshToken: "rt-new",
          expiresAt: new Date(Date.now() + 60 * 60_000).toISOString()
        };
      }
    } as unknown as ConstructorParameters<typeof KiroProviderAdapter>[1];

    const onRefreshed = (_id: string, payload: Record<string, unknown>) => {
      live = { ...payload };
    };

    const coordinator: ConstructorParameters<typeof KiroProviderAdapter>[3] = (accountId, _stale, doRefresh) =>
      refreshLock.serialize(accountId, () => doRefresh(live as never));

    const adapter = new KiroProviderAdapter(undefined, authClient, onRefreshed, coordinator);
    // Access the private resolveCredential via the public path is heavy; call the
    // private method through a typed cast for a focused unit test.
    const resolve = (adapter as unknown as {
      resolveCredential: (c: Record<string, unknown>, id?: string) => Promise<Record<string, unknown>>;
    }).resolveCredential.bind(adapter);

    const [a, b] = await Promise.all([
      resolve({ refreshToken: "rt-old", expiresAt: live.expiresAt }, "acc1"),
      resolve({ refreshToken: "rt-old", expiresAt: live.expiresAt }, "acc1")
    ]);

    // Exactly one network refresh ran; the second observed the rotated token.
    expect(refreshCalls).toBe(1);
    expect(a.accessToken).toBe("at-new");
    expect(b.accessToken).toBe("at-new");
  });
});
