import { randomUUID } from "node:crypto";

export type UsageLogType = "consume" | "manage" | "system" | "error" | "refund" | "topup";

export type UsageRecord = {
  id: string;
  requestId: string;
  protocol: "openai" | "anthropic";
  model: string;
  providerType: string;
  providerInstanceId: string;
  accountId?: string;
  apiKeyHash?: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /** Tokens served from provider cache (subset of promptTokens) */
  cachedTokens?: number;
  estimatedCost?: number;
  /** Phase 29 — was this a streaming request? */
  isStream?: boolean;
  /** Phase 29 — client IP captured from auth context. */
  clientIp?: string;
  /** Phase 29 — log type for filtering. Defaults to 'consume' when omitted. */
  logType?: UsageLogType;
  /** Phase 29 — upstream request id when provider returned one. */
  upstreamRequestId?: string;
  createdAt: Date;
};

export type UsageFilter = {
  apiKeyHash?: string;
  model?: string;
  providerType?: string;
  protocol?: "openai" | "anthropic";
  logType?: UsageLogType;
  from?: Date;
  to?: Date;
};

export type UsageQuery = UsageFilter & {
  limit?: number;
  offset?: number;
};

export type UsageDailyAggregate = {
  date: string;
  requests: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

export class UsageService {
  private readonly records: UsageRecord[] = [];

  constructor(private readonly maxRecords = 1000) {}

  record(input: Omit<UsageRecord, "id" | "createdAt">): UsageRecord {
    const record: UsageRecord = {
      ...input,
      id: `usage_${randomUUID()}`,
      createdAt: new Date()
    };

    this.records.unshift(record);

    if (this.records.length > this.maxRecords) {
      this.records.length = this.maxRecords;
    }

    return structuredClone(record);
  }

  list(limit = 100): UsageRecord[] {
    return this.records.slice(0, limit).map((record) => structuredClone(record));
  }

  listAll(): UsageRecord[] {
    return this.records.map((record) => structuredClone(record));
  }

  query(q: UsageQuery = {}): { data: UsageRecord[]; total: number } {
    const filtered = this.applyFilter(q);
    const offset = Math.max(0, q.offset ?? 0);
    const limit = Math.max(1, Math.min(q.limit ?? 100, 1000));
    const slice = filtered.slice(offset, offset + limit);
    return {
      total: filtered.length,
      data: slice.map((r) => structuredClone(r))
    };
  }

  dailyAggregates(filter: UsageFilter = {}): UsageDailyAggregate[] {
    const filtered = this.applyFilter(filter);
    const buckets = new Map<string, UsageDailyAggregate>();
    for (const r of filtered) {
      const date = r.createdAt.toISOString().slice(0, 10);
      const bucket = buckets.get(date) ?? {
        date,
        requests: 0,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0
      };
      bucket.requests += 1;
      bucket.promptTokens += r.promptTokens;
      bucket.completionTokens += r.completionTokens;
      bucket.totalTokens += r.totalTokens;
      buckets.set(date, bucket);
    }
    return Array.from(buckets.values()).sort((a, b) => a.date.localeCompare(b.date));
  }

  private applyFilter(filter: UsageFilter): UsageRecord[] {
    return this.records.filter((r) => {
      if (filter.apiKeyHash && r.apiKeyHash !== filter.apiKeyHash) return false;
      if (filter.model && r.model !== filter.model) return false;
      if (filter.providerType && r.providerType !== filter.providerType) return false;
      if (filter.protocol && r.protocol !== filter.protocol) return false;
      if (filter.logType && (r.logType ?? "consume") !== filter.logType) return false;
      if (filter.from && r.createdAt < filter.from) return false;
      if (filter.to && r.createdAt > filter.to) return false;
      return true;
    });
  }

  load(records: UsageRecord[]): void {
    this.records.length = 0;
    for (const r of records) {
      this.records.push({ ...r, createdAt: new Date(r.createdAt) });
    }
  }

  clear(): void {
    this.records.length = 0;
  }
}
