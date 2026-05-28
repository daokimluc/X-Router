/**
 * LatencyTrackerService Ã¢â‚¬â€ Phase 32 Ã¢â‚¬â€ latency-observability.
 *
 * Per-(providerInstanceId, publicModel, accountId) latency histogram over a
 * rolling 5-minute window made of 5 one-minute slots. Records both `ok` and
 * `error` outcomes separately. LRU caps total tuple cardinality at 2000.
 *
 * Buckets are fixed log-scale boundaries from 10ms to 30s (plus +Inf overflow)
 * Ã¢â‚¬â€ see HDR_BOUNDS_MS. Memory: ~200 bytes per tuple per slot Ãƒâ€” 5 slots Ã¢â€°Ë† 1 KB
 * per active tuple, ~2 MB at full capacity.
 *
 * Read API returns p50, p95, p99 computed across all 5 active slots, plus
 * cumulative count and sum. Prometheus exporter consumes the same internal
 * state.
 */

export const HDR_BOUNDS_MS: number[] = [
  10, 20, 30, 50, 75, 100, 150, 200, 300, 500, 750,
  1000, 1500, 2000, 3000, 5000, 7500, 10000, 15000, 20000, 30000
];

export const HDR_BOUND_LABELS: string[] = [...HDR_BOUNDS_MS.map(String), "+Inf"];

const SLOT_COUNT = 5;
const SLOT_MS = 60_000;
const TUPLE_CAP = 2000;

type Outcome = "ok" | "error";

type Slot = {
  /** Cumulative bucket counts for each HDR boundary (length = HDR_BOUNDS_MS.length + 1 for +Inf) */
  buckets: Uint32Array;
  count: number;
  sumMs: number;
};

type TupleHist = {
  ok: Slot[];
  error: Slot[];
  /** rotation cursor Ã¢â‚¬â€ index of the slot that's currently "live" */
  liveIdx: number;
};

export type LatencyRecordInput = {
  providerInstanceId: string;
  publicModel: string;
  accountId: string;
  durationMs: number;
  ok: boolean;
};

export type LatencyPercentiles = {
  count: number;
  p50: number | null;
  p95: number | null;
  p99: number | null;
};

export type LatencySnapshotEntry = {
  providerInstanceId: string;
  publicModel: string;
  accountId: string;
  ok: LatencyPercentiles;
  error: LatencyPercentiles;
};

export type LatencySnapshot = {
  windowSeconds: number;
  tuples: LatencySnapshotEntry[];
};

function emptySlot(): Slot {
  return {
    buckets: new Uint32Array(HDR_BOUNDS_MS.length + 1),
    count: 0,
    sumMs: 0
  };
}

function emptyTupleHist(): TupleHist {
  return {
    ok: Array.from({ length: SLOT_COUNT }, emptySlot),
    error: Array.from({ length: SLOT_COUNT }, emptySlot),
    liveIdx: 0
  };
}

function placeBucket(durationMs: number): number {
  for (let i = 0; i < HDR_BOUNDS_MS.length; i++) {
    if (durationMs <= HDR_BOUNDS_MS[i]) return i;
  }
  return HDR_BOUNDS_MS.length; // +Inf
}

function tupleKey(t: { providerInstanceId: string; publicModel: string; accountId: string }): string {
  return [t.providerInstanceId, t.publicModel, t.accountId].join("|");
}

function unpackKey(k: string): { providerInstanceId: string; publicModel: string; accountId: string } {
  const [providerInstanceId, publicModel, accountId] = k.split("|");
  return { providerInstanceId, publicModel, accountId };
}

function percentile(slots: Slot[], pct: number): number | null {
  // Sum totals across slots
  let totalCount = 0;
  for (const s of slots) totalCount += s.count;
  if (totalCount === 0) return null;
  const target = Math.ceil(totalCount * pct);
  // Walk buckets accumulating across all slots
  let cum = 0;
  for (let b = 0; b <= HDR_BOUNDS_MS.length; b++) {
    let bucketSum = 0;
    for (const s of slots) bucketSum += s.buckets[b];
    cum += bucketSum;
    if (cum >= target) {
      // Return upper boundary of the bucket
      return b < HDR_BOUNDS_MS.length ? HDR_BOUNDS_MS[b] : HDR_BOUNDS_MS[HDR_BOUNDS_MS.length - 1] * 2;
    }
  }
  return null;
}

function readPercentiles(slots: Slot[]): LatencyPercentiles {
  let count = 0;
  for (const s of slots) count += s.count;
  return {
    count,
    p50: percentile(slots, 0.5),
    p95: percentile(slots, 0.95),
    p99: percentile(slots, 0.99)
  };
}

export class LatencyTrackerService {
  // Insertion-order Map for LRU: re-inserting on access moves to back
  private readonly tuples = new Map<string, TupleHist>();
  private rotationHandle: ReturnType<typeof setInterval> | null = null;

  /** Start the slot rotation interval. Called by app.ts on startup. */
  start(): void {
    if (this.rotationHandle) return;
    this.rotationHandle = setInterval(() => this.rotate(), SLOT_MS);
  }

  /** Stop the rotation interval. Called on app.close. */
  stop(): void {
    if (this.rotationHandle) {
      clearInterval(this.rotationHandle);
      this.rotationHandle = null;
    }
  }

  record(input: LatencyRecordInput): void {
    const key = tupleKey(input);
    let hist = this.tuples.get(key);
    if (hist) {
      // Touch for LRU: re-insert
      this.tuples.delete(key);
      this.tuples.set(key, hist);
    } else {
      hist = emptyTupleHist();
      // Cap eviction
      if (this.tuples.size >= TUPLE_CAP) {
        const oldestKey = this.tuples.keys().next().value;
        if (oldestKey !== undefined) this.tuples.delete(oldestKey);
      }
      this.tuples.set(key, hist);
    }

    const slot = (input.ok ? hist.ok : hist.error)[hist.liveIdx];
    const bIdx = placeBucket(input.durationMs);
    slot.buckets[bIdx] += 1;
    slot.count += 1;
    slot.sumMs += input.durationMs;
  }

  /** Advance the rotation cursor: oldest slot is dropped, fresh empty slot becomes live. */
  rotate(): void {
    for (const hist of this.tuples.values()) {
      hist.liveIdx = (hist.liveIdx + 1) % SLOT_COUNT;
      hist.ok[hist.liveIdx] = emptySlot();
      hist.error[hist.liveIdx] = emptySlot();
    }
  }

  snapshot(): LatencySnapshot {
    const tuples: LatencySnapshotEntry[] = [];
    for (const [key, hist] of this.tuples.entries()) {
      const id = unpackKey(key);
      tuples.push({
        ...id,
        ok: readPercentiles(hist.ok),
        error: readPercentiles(hist.error)
      });
    }
    return {
      windowSeconds: SLOT_COUNT * (SLOT_MS / 1000),
      tuples
    };
  }

  /**
   * Internal accessor for Prometheus exporter Ã¢â‚¬â€ exposes raw histograms.
   * Returns one entry per tuple per outcome, summed across all slots.
   */
  exportHistograms(): Array<{
    providerInstanceId: string;
    publicModel: string;
    accountId: string;
    outcome: Outcome;
    /** cumulative bucket counts including +Inf */
    cumulativeBuckets: number[];
    count: number;
    sumMs: number;
  }> {
    const out: Array<{
      providerInstanceId: string;
      publicModel: string;
      accountId: string;
      outcome: Outcome;
      cumulativeBuckets: number[];
      count: number;
      sumMs: number;
    }> = [];

    for (const [key, hist] of this.tuples.entries()) {
      const id = unpackKey(key);
      for (const outcome of ["ok", "error"] as const) {
        const slots = outcome === "ok" ? hist.ok : hist.error;
        let count = 0;
        let sumMs = 0;
        const buckets = new Array<number>(HDR_BOUNDS_MS.length + 1).fill(0);
        for (const s of slots) {
          count += s.count;
          sumMs += s.sumMs;
          for (let i = 0; i < buckets.length; i++) buckets[i] += s.buckets[i];
        }
        if (count === 0) continue;
        // Convert per-bucket counts to cumulative (Prometheus convention)
        const cumulative = new Array<number>(buckets.length).fill(0);
        let running = 0;
        for (let i = 0; i < buckets.length; i++) {
          running += buckets[i];
          cumulative[i] = running;
        }
        out.push({
          ...id,
          outcome,
          cumulativeBuckets: cumulative,
          count,
          sumMs
        });
      }
    }
    return out;
  }

  /** Test helper Ã¢â‚¬â€ clear all state. */
  clear(): void {
    this.tuples.clear();
  }

  /** Test helper Ã¢â‚¬â€ current tuple count. */
  size(): number {
    return this.tuples.size;
  }
}
