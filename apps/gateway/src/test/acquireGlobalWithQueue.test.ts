import { describe, expect, it } from "vitest";
import { acquireGlobalWithQueue } from "../routes/pipeline/RequestPipeline.js";
import { ConcurrencyLimiter, ConcurrencyLimitError } from "../services/ConcurrencyLimiter.js";

/** A queue stub whose waitForSlot resolves immediately a fixed number of times. */
function queueStub(opts: { enabled: boolean; resolves?: number; throwOnWait?: Error }) {
  let waited = 0;
  return {
    isEnabled: () => opts.enabled,
    waitForSlot: async () => {
      waited += 1;
      if (opts.throwOnWait) throw opts.throwOnWait;
    },
    waitedCount: () => waited
  };
}

describe("acquireGlobalWithQueue (F1 queue handoff race)", () => {
  it("acquires directly when a slot is free", async () => {
    const limiter = new ConcurrencyLimiter(2);
    const queue = queueStub({ enabled: true });
    const release = await acquireGlobalWithQueue(limiter, queue);
    expect(typeof release).toBe("function");
    expect(queue.waitedCount()).toBe(0); // never queued
    expect(limiter.getGlobalActive()).toBe(1);
  });

  it("throws immediately when saturated and the queue is disabled", async () => {
    const limiter = new ConcurrencyLimiter(1);
    limiter.acquireGlobal(); // fill it
    const queue = queueStub({ enabled: false });
    await expect(acquireGlobalWithQueue(limiter, queue)).rejects.toBeInstanceOf(ConcurrencyLimitError);
  });

  it("re-queues when a woken waiter loses the freed slot to a racing request, then wins", async () => {
    const limiter = new ConcurrencyLimiter(1);
    // A racer currently holds the only slot.
    let racerRelease = limiter.acquireGlobal();
    let waits = 0;
    const queue = {
      isEnabled: () => true,
      waitForSlot: async () => {
        waits += 1;
        // 1st wake: racer still holds the slot → our acquire will throw (re-queue).
        // 2nd wake: free the racer's slot → our acquire wins.
        if (waits >= 2) racerRelease();
      }
    };

    const release = await acquireGlobalWithQueue(limiter, queue, 4);
    expect(typeof release).toBe("function");
    expect(waits).toBeGreaterThanOrEqual(2); // had to re-queue at least once
    expect(limiter.getGlobalActive()).toBe(1); // we hold the slot now
  });

  it("gives up after maxAttempts when the slot is never winnable", async () => {
    const limiter = new ConcurrencyLimiter(1);
    limiter.acquireGlobal(); // permanently full
    const queue = queueStub({ enabled: true });
    await expect(acquireGlobalWithQueue(limiter, queue, 3)).rejects.toBeInstanceOf(ConcurrencyLimitError);
    expect(queue.waitedCount()).toBe(3); // waited maxAttempts times then surfaced overload
  });

  it("propagates a queue timeout/full error from waitForSlot", async () => {
    const limiter = new ConcurrencyLimiter(1);
    limiter.acquireGlobal();
    const boom = new Error("queue full");
    const queue = queueStub({ enabled: true, throwOnWait: boom });
    await expect(acquireGlobalWithQueue(limiter, queue)).rejects.toBe(boom);
  });
});
