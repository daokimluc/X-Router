import { randomUUID } from "node:crypto";

export type RequestLogRecord = {
  id: string;
  requestId: string;
  method: string;
  route: string;
  statusCode: number;
  durationMs: number;
  apiKeyHash?: string;
  createdAt: Date;
};

export type RequestLogFilter = {
  apiKeyHash?: string;
  route?: string;
  method?: string;
  statusFamily?: "2xx" | "3xx" | "4xx" | "5xx";
  from?: Date;
  to?: Date;
};

export type RequestLogQuery = RequestLogFilter & {
  limit?: number;
  offset?: number;
};

export class RequestLogService {
  private readonly records: RequestLogRecord[] = [];

  constructor(private readonly maxRecords = 500) {}

  record(input: Omit<RequestLogRecord, "id" | "createdAt">): RequestLogRecord {
    const record: RequestLogRecord = {
      ...input,
      id: `request_log_${randomUUID()}`,
      createdAt: new Date()
    };

    this.records.unshift(record);

    if (this.records.length > this.maxRecords) {
      this.records.length = this.maxRecords;
    }

    return structuredClone(record);
  }

  list(limit = 100): RequestLogRecord[] {
    return this.records.slice(0, limit).map((record) => structuredClone(record));
  }

  listAll(): RequestLogRecord[] {
    return this.records.map((record) => structuredClone(record));
  }

  query(q: RequestLogQuery = {}): { data: RequestLogRecord[]; total: number } {
    const filtered = this.records.filter((r) => {
      if (q.apiKeyHash && r.apiKeyHash !== q.apiKeyHash) return false;
      if (q.route && !r.route.includes(q.route)) return false;
      if (q.method && r.method.toUpperCase() !== q.method.toUpperCase()) return false;
      if (q.statusFamily) {
        const family = `${Math.floor(r.statusCode / 100)}xx` as const;
        if (family !== q.statusFamily) return false;
      }
      if (q.from && r.createdAt < q.from) return false;
      if (q.to && r.createdAt > q.to) return false;
      return true;
    });
    const offset = Math.max(0, q.offset ?? 0);
    const limit = Math.max(1, Math.min(q.limit ?? 100, 1000));
    const slice = filtered.slice(offset, offset + limit);
    return {
      total: filtered.length,
      data: slice.map((r) => structuredClone(r))
    };
  }

  load(records: RequestLogRecord[]): void {
    this.records.length = 0;
    for (const r of records) {
      this.records.push({ ...r, createdAt: new Date(r.createdAt) });
    }
  }

  clear(): void {
    this.records.length = 0;
  }
}
