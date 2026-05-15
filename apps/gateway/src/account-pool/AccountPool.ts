import type { ProviderAccount } from "../providers/base/ProviderAccount.js";
import type {
  AccountSelectionContext,
  AccountSelectionStrategy,
  AccountPoolLease
} from "./types.js";
import { RoundRobinStrategy } from "./RoundRobinStrategy.js";

export class NoAvailableAccountError extends Error {
  readonly code = "no_available_account";
  readonly statusCode = 503;

  constructor(message = "No available provider account") {
    super(message);
    this.name = "NoAvailableAccountError";
  }
}

export class AccountPool {
  private readonly accounts = new Map<string, ProviderAccount>();
  private readonly selectionStrategy: AccountSelectionStrategy;

  constructor(
    accounts: ProviderAccount[] = [],
    selectionStrategy: AccountSelectionStrategy = new RoundRobinStrategy()
  ) {
    this.selectionStrategy = selectionStrategy;

    for (const account of accounts) {
      this.addAccount(account);
    }
  }

  addAccount(account: ProviderAccount): void {
    this.accounts.set(account.id, cloneAccount(account));
  }

  listAccounts(): ProviderAccount[] {
    return Array.from(this.accounts.values()).map(cloneAccount);
  }

  getAccount(accountId: string): ProviderAccount | undefined {
    const account = this.accounts.get(accountId);
    return account ? cloneAccount(account) : undefined;
  }

  removeAccount(accountId: string): ProviderAccount {
    const account = this.requireAccount(accountId);
    this.accounts.delete(accountId);
    return cloneAccount(account);
  }

  updateAccount(
    accountId: string,
    patch: Partial<Omit<ProviderAccount, "id" | "runtime" | "createdAt">>
  ): ProviderAccount {
    const current = this.requireAccount(accountId);
    const updated: ProviderAccount = {
      ...current,
      ...patch,
      id: current.id,
      runtime: current.runtime,
      createdAt: current.createdAt,
      updatedAt: new Date()
    };

    this.accounts.set(accountId, cloneAccount(updated));
    return cloneAccount(updated);
  }

  acquire(context: Partial<AccountSelectionContext> = {}): AccountPoolLease {
    const now = context.now ?? new Date();
    this.reactivateExpiredCooldowns(now);

    const availableAccounts = Array.from(this.accounts.values()).filter((account) =>
      this.isAccountAvailable(account, {
        ...context,
        now
      })
    );
    const selected = this.selectionStrategy.select(availableAccounts, {
      ...context,
      now
    });

    if (!selected) {
      throw new NoAvailableAccountError();
    }

    selected.runtime.activeRequests += 1;
    selected.runtime.totalRequests += 1;
    selected.runtime.lastUsedAt = now;
    selected.updatedAt = now;

    let released = false;

    return {
      account: cloneAccount(selected),
      releaseSuccess: () => {
        if (released) {
          return;
        }

        released = true;
        this.markSuccess(selected.id, new Date());
      },
      releaseFailure: (error: string) => {
        if (released) {
          return;
        }

        released = true;
        this.markFailure(selected.id, error, new Date());
      }
    };
  }

  setCooldown(accountId: string, cooldownUntil: Date, error?: string): void {
    const account = this.requireAccount(accountId);
    account.status = "cooldown";
    account.runtime.cooldownUntil = cooldownUntil;
    account.runtime.lastError = error;
    account.updatedAt = new Date();
  }

  disable(accountId: string, error?: string): void {
    const account = this.requireAccount(accountId);
    account.status = "disabled";
    account.runtime.lastError = error;
    account.updatedAt = new Date();
  }

  enable(accountId: string): void {
    const account = this.requireAccount(accountId);
    account.status = "active";
    account.runtime.cooldownUntil = undefined;
    account.updatedAt = new Date();
  }

  private markSuccess(accountId: string, now: Date): void {
    const account = this.requireAccount(accountId);
    account.runtime.activeRequests = Math.max(0, account.runtime.activeRequests - 1);
    account.runtime.consecutiveFailures = 0;
    account.runtime.lastSuccessAt = now;
    account.runtime.lastError = undefined;
    account.updatedAt = now;
  }

  private markFailure(accountId: string, error: string, now: Date): void {
    const account = this.requireAccount(accountId);
    account.runtime.activeRequests = Math.max(0, account.runtime.activeRequests - 1);
    account.runtime.failedRequests += 1;
    account.runtime.consecutiveFailures += 1;
    account.runtime.lastFailureAt = now;
    account.runtime.lastError = error;
    account.updatedAt = now;
  }

  private reactivateExpiredCooldowns(now: Date): void {
    for (const account of this.accounts.values()) {
      if (
        account.status === "cooldown" &&
        account.runtime.cooldownUntil &&
        account.runtime.cooldownUntil <= now
      ) {
        account.status = "active";
        account.runtime.cooldownUntil = undefined;
        account.updatedAt = now;
      }
    }
  }

  private isAccountAvailable(
    account: ProviderAccount,
    context: AccountSelectionContext
  ): boolean {
    if (account.status === "disabled") {
      return false;
    }

    if (account.status === "cooldown") {
      return false;
    }

    if (account.runtime.activeRequests >= account.maxConcurrency) {
      return false;
    }

    if (
      context.model &&
      account.allowedModels &&
      account.allowedModels.length > 0 &&
      !account.allowedModels.includes(context.model)
    ) {
      return false;
    }

    return true;
  }

  private requireAccount(accountId: string): ProviderAccount {
    const account = this.accounts.get(accountId);

    if (!account) {
      throw new Error(`Account ${accountId} not found`);
    }

    return account;
  }
}

function cloneAccount(account: ProviderAccount): ProviderAccount {
  return structuredClone(account);
}
