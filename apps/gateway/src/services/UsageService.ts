import { randomUUID } from "node:crypto";

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
  estimatedCost?: number;
  createdAt: Date;
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
