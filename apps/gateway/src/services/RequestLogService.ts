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
