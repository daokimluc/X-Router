/**
 * In-memory store for idempotency key tracking.
 * Stores response for idempotent replay within TTL window.
 * @module services/IdempotencyStore
 */

export type IdempotencyRecord = {
  key: string;
  statusCode: number;
  body: unknown;
  createdAt: number;
};

const DEFAULT_TTL_MS = 600_000; // 10 minutes

export class IdempotencyStore {
  private readonly ttlMs: number;
  private readonly records = new Map<string, IdempotencyRecord>();

  constructor(ttlMs: number = DEFAULT_TTL_MS) {
    this.ttlMs = ttlMs;
  }

  /**
   * Get idempotency record by key.
   * Returns undefined if not found or expired.
   * Auto-cleans expired entries.
   */
  get(key: string): IdempotencyRecord | undefined {
    this.cleanup();
    const record = this.records.get(key);
    if (!record) return undefined;

    if (this.isExpired(record)) {
      this.records.delete(key);
      return undefined;
    }

    return record;
  }

  /**
   * Store idempotency record.
   * Auto-cleans expired entries.
   */
  set(key: string, statusCode: number, body: unknown): void {
    this.cleanup();
    const record: IdempotencyRecord = {
      key,
      statusCode,
      body,
      createdAt: Date.now(),
    };
    this.records.set(key, record);
  }

  /**
   * Check if a key exists and is not expired.
   */
  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  /**
   * Delete a specific key.
   */
  delete(key: string): boolean {
    return this.records.delete(key);
  }

  /**
   * Get current size (for testing/monitoring).
   */
  get size(): number {
    this.cleanup();
    return this.records.size;
  }

  private isExpired(record: IdempotencyRecord): boolean {
    return Date.now() - record.createdAt > this.ttlMs;
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, record] of this.records) {
      if (now - record.createdAt > this.ttlMs) {
        this.records.delete(key);
      }
    }
  }
}
