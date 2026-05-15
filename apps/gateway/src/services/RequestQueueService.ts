/**
 * Bounded request queue with timeout — adds backpressure when concurrency
 * limits are saturated. Caller awaits a slot; if the queue fills up, the
 * caller is rejected immediately. If the wait exceeds `timeoutMs`, the
 * request is rejected with a queue timeout error.
 *
 * Used by the OpenAI / Anthropic routes when ConcurrencyLimiter rejects:
 * before failing the client, the request enters the queue and waits for
 * an in-flight request to finish.
 */

export class RequestQueueTimeoutError extends Error {
  readonly code = "request_queue_timeout";
  readonly statusCode = 503;
  constructor() {
    super("Request queue timed out waiting for a free slot");
    this.name = "RequestQueueTimeoutError";
  }
}

export class RequestQueueFullError extends Error {
  readonly code = "request_queue_full";
  readonly statusCode = 503;
  constructor() {
    super("Gateway request queue is full");
    this.name = "RequestQueueFullError";
  }
}

export type RequestQueueOptions = {
  enabled: boolean;
  maxSize: number;
  timeoutMs: number;
};

const DEFAULTS: RequestQueueOptions = {
  enabled: false,
  maxSize: 100,
  timeoutMs: 10_000,
};

type Waiter = {
  resolve: () => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
};

export class RequestQueueService {
  private readonly waiters: Waiter[] = [];
  private options: RequestQueueOptions;

  constructor(options: Partial<RequestQueueOptions> = {}) {
    this.options = { ...DEFAULTS, ...options };
  }

  isEnabled(): boolean {
    return this.options.enabled;
  }

  size(): number {
    return this.waiters.length;
  }

  /**
   * Wait for a slot. Resolves when notified by `release()` or rejects on
   * timeout / queue full. If queue is disabled, rejects immediately with
   * RequestQueueFullError so callers fall back to the original error.
   */
  async waitForSlot(): Promise<void> {
    if (!this.options.enabled) {
      throw new RequestQueueFullError();
    }
    if (this.waiters.length >= this.options.maxSize) {
      throw new RequestQueueFullError();
    }
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this.waiters.findIndex((w) => w.timer === timer);
        if (idx >= 0) {
          this.waiters.splice(idx, 1);
        }
        reject(new RequestQueueTimeoutError());
      }, this.options.timeoutMs);
      this.waiters.push({ resolve, reject, timer });
    });
  }

  /** Release one queued waiter. Call when an in-flight request finishes. */
  release(): void {
    const waiter = this.waiters.shift();
    if (waiter) {
      clearTimeout(waiter.timer);
      waiter.resolve();
    }
  }

  /** Reject all queued waiters (e.g. on shutdown). */
  drain(reason: string = "queue drained"): void {
    while (this.waiters.length > 0) {
      const waiter = this.waiters.shift()!;
      clearTimeout(waiter.timer);
      waiter.reject(new Error(reason));
    }
  }

  updateOptions(partial: Partial<RequestQueueOptions>): void {
    this.options = { ...this.options, ...partial };
  }
}
