import { AccountPool } from "../account-pool/AccountPool.js";
import { createAccountSelectionStrategy } from "../account-pool/strategyFactory.js";
import type { ProviderInstance } from "../providers/base/ProviderInstance.js";

export class ProviderRuntimeRegistry {
  private readonly providerInstances = new Map<string, ProviderInstance>();
  private readonly accountPools = new Map<string, AccountPool>();

  constructor(
    providerInstances: ProviderInstance[] = [],
    accountPools: Array<{
      providerInstanceId: string;
      accountPool: AccountPool;
    }> = []
  ) {
    for (const providerInstance of providerInstances) {
      this.registerProviderInstance(providerInstance);
    }

    for (const accountPool of accountPools) {
      this.registerAccountPool(
        accountPool.providerInstanceId,
        accountPool.accountPool
      );
    }
  }

  registerProviderInstance(providerInstance: ProviderInstance): void {
    this.providerInstances.set(providerInstance.id, structuredClone(providerInstance));
  }

  registerAccountPool(providerInstanceId: string, accountPool: AccountPool): void {
    this.accountPools.set(providerInstanceId, accountPool);
  }

  getProviderInstance(providerInstanceId: string): ProviderInstance | undefined {
    const providerInstance = this.providerInstances.get(providerInstanceId);
    return providerInstance ? structuredClone(providerInstance) : undefined;
  }

  listProviderInstances(): ProviderInstance[] {
    return Array.from(this.providerInstances.values()).map((providerInstance) =>
      structuredClone(providerInstance)
    );
  }

  updateProviderInstance(
    providerInstanceId: string,
    patch: Partial<ProviderInstance>
  ): ProviderInstance {
    const current = this.providerInstances.get(providerInstanceId);

    if (!current) {
      throw new Error(`Provider instance ${providerInstanceId} not found`);
    }

    const updated: ProviderInstance = {
      ...current,
      ...patch,
      id: current.id,
      updatedAt: new Date()
    };

    this.providerInstances.set(providerInstanceId, structuredClone(updated));

    if (patch.accountSelectionStrategy) {
      const currentPool = this.accountPools.get(providerInstanceId);
      this.accountPools.set(
        providerInstanceId,
        new AccountPool(
          currentPool?.listAccounts() ?? [],
          createAccountSelectionStrategy(updated.accountSelectionStrategy)
        )
      );
    }

    return structuredClone(updated);
  }

  getAccountPool(providerInstanceId: string): AccountPool | undefined {
    return this.accountPools.get(providerInstanceId);
  }

  listAccounts(): ReturnType<AccountPool["listAccounts"]> {
    return Array.from(this.accountPools.values()).flatMap((pool) =>
      pool.listAccounts()
    );
  }

  /** Find a specific account across all pools by id. */
  getAccount(accountId: string) {
    for (const pool of this.accountPools.values()) {
      const acc = pool.getAccount(accountId);
      if (acc) return acc;
    }
    return undefined;
  }

  /** Set account status (active/cooldown/disabled). */
  setAccountStatus(accountId: string, status: "active" | "cooldown" | "disabled"): void {
    for (const pool of this.accountPools.values()) {
      const acc = pool.getAccount(accountId);
      if (acc) {
        if (status === "disabled") {
          pool.disable(accountId, "manual");
        } else if (status === "active") {
          pool.enable(accountId);
        } else if (status === "cooldown") {
          pool.setCooldown(accountId, new Date(Date.now() + 60_000), "manual");
        }
        return;
      }
    }
    throw new Error(`Account ${accountId} not found`);
  }
}

export function createDefaultProviderRuntimeRegistry(): ProviderRuntimeRegistry {
  const now = new Date();
  return new ProviderRuntimeRegistry(
    [
      {
        id: "provider_kiro_main",
        type: "kiro",
        name: "Kiro Main",
        enabled: true,
        config: {
          region: "us-east-1",
          defaultModel: "claude-sonnet-4.5"
        },
        defaultTimeoutMs: 30000,
        maxRetries: 1,
        cooldownMs: 60000,
        accountSelectionStrategy: "round_robin",
        maxConcurrentRequests: 20,
        maxConcurrentRequestsPerAccount: 3,
        circuitBreaker: {
          enabled: true,
          failureThreshold: 5,
          cooldownMs: 60000,
          halfOpenMaxRequests: 1
        },
        createdAt: now,
        updatedAt: now
      },
      {
        id: "provider_windsurf_main",
        type: "windsurf",
        name: "Windsurf Main",
        enabled: true,
        config: {
          defaultModel: "claude-sonnet-4-6-thinking"
        },
        defaultTimeoutMs: 30000,
        maxRetries: 1,
        cooldownMs: 60000,
        accountSelectionStrategy: "round_robin",
        maxConcurrentRequests: 20,
        maxConcurrentRequestsPerAccount: 3,
        circuitBreaker: {
          enabled: true,
          failureThreshold: 5,
          cooldownMs: 60000,
          halfOpenMaxRequests: 1
        },
        createdAt: now,
        updatedAt: now
      }
    ],
    [
      {
        providerInstanceId: "provider_kiro_main",
        accountPool: new AccountPool(
          [],
          createAccountSelectionStrategy("round_robin")
        )
      },
      {
        providerInstanceId: "provider_windsurf_main",
        accountPool: new AccountPool(
          [],
          createAccountSelectionStrategy("round_robin")
        )
      }
    ]
  );
}
