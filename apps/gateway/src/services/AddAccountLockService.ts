/**
 * Lock service for add-account operations.
 * Serializes concurrent add-account requests for the same (providerType, label) pair.
 * @module services/AddAccountLockService
 */

import { KeyedMutex } from "../utils/mutex.js";

export class AddAccountLockTimeoutError extends Error {
  readonly code = "add_account_in_progress" as const;
  readonly statusCode = 409 as const;

  constructor(key: string) {
    super(`Add account operation in progress for ${key}`);
    this.name = "AddAccountLockTimeoutError";
  }
}

export class AddAccountLockService {
  private readonly mutex = new KeyedMutex();
  private readonly timeoutMs: number;

  constructor(timeoutMs = 5000) {
    this.timeoutMs = timeoutMs;
  }

  /**
   * Acquire lock for add-account operation.
   * Lock key format: add-account:{providerType}:{normalizedLabel}
   * Throws AddAccountLockTimeoutError if lock cannot be acquired within timeout.
   */
  async acquire<T>(
    providerType: string,
    normalizedLabel: string,
    task: () => Promise<T>
  ): Promise<T> {
    const key = `add-account:${providerType}:${normalizedLabel}`;

    return Promise.race([
      this.mutex.runExclusive(key, task),
      this.timeout(key),
    ]) as Promise<T>;
  }

  private timeout(key: string): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => {
        reject(new AddAccountLockTimeoutError(key));
      }, this.timeoutMs);
    });
  }
}
