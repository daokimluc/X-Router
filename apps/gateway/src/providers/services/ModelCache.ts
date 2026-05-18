import type { ProviderModel } from "../base/types.js";

export type ModelCacheEntry = {
  models: ProviderModel[];
  fetchedAt: number;
  ttlMs: number;
};

const DEFAULT_TTL_MS = 300000; // 5 minutes

export class ModelCache {
  private cache: Map<string, ModelCacheEntry> = new Map();

  get(accountId: string): ProviderModel[] | null {
    const entry = this.cache.get(accountId);
    if (!entry) {
      return null;
    }

    const now = Date.now();
    if (now - entry.fetchedAt >= entry.ttlMs) {
      this.cache.delete(accountId);
      return null;
    }

    return entry.models;
  }

  set(accountId: string, models: ProviderModel[], ttlMs: number = DEFAULT_TTL_MS): void {
    this.cache.set(accountId, {
      models,
      fetchedAt: Date.now(),
      ttlMs,
    });
  }

  invalidate(accountId: string): void {
    this.cache.delete(accountId);
  }
}
