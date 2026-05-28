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
  /** Phase 32 — was this response served from semantic-response-cache? */
  cacheHit?: boolean;
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

// Phase 32 — usage-time-series-charts
export type AggregateBucket = "hour" | "day";
export type AggregateGroupBy = "model" | "provider";

export type AggregateOptions = {
  from: Date;
  to: Date;
  bucket?: AggregateBucket;
  groupBy?: AggregateGroupBy;
};

export type AggregateBucketDatum = {
  cost: number;
  tokens: number;
  requests: number;
};

export type AggregateSeries = {
  key: string;
  totalCost: number;
  totalTokens: number;
  totalRequests: number;
  perBucket: AggregateBucketDatum[];
};

export type AggregateResult = {
  bucket: AggregateBucket;
  groupBy: AggregateGroupBy;
  from: string;
  to: string;
  buckets: string[];
  series: AggregateSeries[];
};

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const TOP_N = 10;
const CACHE_TTL_MS = 30_000;

export function floorToBucket(timestamp: number | Date, bucket: AggregateBucket): number {
  const ms = typeof timestamp === "number" ? timestamp : timestamp.getTime();
  if (bucket === "hour") {
    return Math.floor(ms / HOUR_MS) * HOUR_MS;
  }
  // day
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

export class UsageService {
  private readonly records: UsageRecord[] = [];
  // Phase 32 — aggregate cache (30s TTL or invalidated on record())
  private aggregateCache = new Map<string, { value: AggregateResult; expiresAt: number }>();

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

    // Invalidate aggregate cache on any new record
    this.aggregateCache.clear();

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
    this.aggregateCache.clear();
  }

  clear(): void {
    this.records.length = 0;
    this.aggregateCache.clear();
  }

  /**
   * Phase 32 — usage-time-series-charts.
   * Aggregate UsageRecord into time buckets grouped by model or provider.
   * Returns at most TOP_N series plus an `_other` rollup when more groups exist.
   */
  aggregate(opts: AggregateOptions): AggregateResult {
    const bucket: AggregateBucket = opts.bucket ?? "hour";
    const groupBy: AggregateGroupBy = opts.groupBy ?? "model";
    const fromMs = opts.from.getTime();
    const toMs = opts.to.getTime();
    const cacheKey = `${fromMs}:${toMs}:${bucket}:${groupBy}`;

    const cached = this.aggregateCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return structuredClone(cached.value);
    }

    // Build bucket index
    const stepMs = bucket === "hour" ? HOUR_MS : DAY_MS;
    const startBucket = floorToBucket(fromMs, bucket);
    const endBucket = floorToBucket(toMs, bucket);
    const buckets: string[] = [];
    for (let t = startBucket; t <= endBucket; t += stepMs) {
      buckets.push(new Date(t).toISOString());
    }
    const bucketIndexByMs = new Map<number, number>();
    buckets.forEach((iso, idx) => {
      bucketIndexByMs.set(new Date(iso).getTime(), idx);
    });

    // Group accumulator
    type GroupAcc = {
      key: string;
      totalCost: number;
      totalTokens: number;
      totalRequests: number;
      perBucket: AggregateBucketDatum[];
    };
    const groups = new Map<string, GroupAcc>();

    for (const r of this.records) {
      const ts = r.createdAt.getTime();
      if (ts < fromMs || ts > toMs) continue;
      const bucketStart = floorToBucket(ts, bucket);
      const idx = bucketIndexByMs.get(bucketStart);
      if (idx === undefined) continue;

      const key = groupBy === "model" ? r.model : r.providerType;
      let g = groups.get(key);
      if (!g) {
        g = {
          key,
          totalCost: 0,
          totalTokens: 0,
          totalRequests: 0,
          perBucket: buckets.map(() => ({ cost: 0, tokens: 0, requests: 0 }))
        };
        groups.set(key, g);
      }
      const cost = r.estimatedCost ?? 0;
      g.perBucket[idx].cost += cost;
      g.perBucket[idx].tokens += r.totalTokens;
      g.perBucket[idx].requests += 1;
      g.totalCost += cost;
      g.totalTokens += r.totalTokens;
      g.totalRequests += 1;
    }

    // Top-N truncation
    const sorted = Array.from(groups.values()).sort((a, b) => b.totalCost - a.totalCost);
    const top = sorted.slice(0, TOP_N);
    const tail = sorted.slice(TOP_N);

    let series: AggregateSeries[] = top.map((g) => ({ ...g, perBucket: g.perBucket.map((d) => ({ ...d })) }));

    if (tail.length > 0) {
      const other: AggregateSeries = {
        key: "_other",
        totalCost: 0,
        totalTokens: 0,
        totalRequests: 0,
        perBucket: buckets.map(() => ({ cost: 0, tokens: 0, requests: 0 }))
      };
      for (const g of tail) {
        other.totalCost += g.totalCost;
        other.totalTokens += g.totalTokens;
        other.totalRequests += g.totalRequests;
        for (let i = 0; i < buckets.length; i++) {
          other.perBucket[i].cost += g.perBucket[i].cost;
          other.perBucket[i].tokens += g.perBucket[i].tokens;
          other.perBucket[i].requests += g.perBucket[i].requests;
        }
      }
      series.push(other);
    }

    const result: AggregateResult = {
      bucket,
      groupBy,
      from: opts.from.toISOString(),
      to: opts.to.toISOString(),
      buckets,
      series
    };

    this.aggregateCache.set(cacheKey, { value: result, expiresAt: Date.now() + CACHE_TTL_MS });
    return structuredClone(result);
  }
}
