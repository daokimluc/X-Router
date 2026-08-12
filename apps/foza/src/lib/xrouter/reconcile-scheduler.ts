import "server-only";
import { xrouterConfig } from "./config";

/**
 * Background reconcile scheduler. The realtime money path is the webhook stream
 * (usage.recorded + settlement.reversed); this periodic sweep is the BACKSTOP
 * that catches anything a missed/late webhook left behind — it replays
 * /provision/settlements (forward `since` + `reversedSince`) and folds the diff
 * idempotently (see reconcile.ts).
 *
 * Started once from instrumentation.ts at server boot (Node runtime only). Guards:
 *  - singleton on globalThis so Next.js dev module re-eval / a second register()
 *    call never starts a second timer;
 *  - a `running` re-entrancy lock so a slow sweep can't overlap the next tick;
 *  - never throws into the timer (a failed sweep logs and waits for the next one).
 */

const DEFAULT_INTERVAL_MS = 5 * 60_000; // 5 min — webhook is realtime; this is a safety net
const MIN_INTERVAL_MS = 60_000; // floor so a misconfig can't hammer the gateway
const FIRST_RUN_DELAY_MS = 30_000; // let the server settle before the first sweep

type SchedulerState = {
  timer: NodeJS.Timeout | null;
  running: boolean;
  lastRunAt: number | null;
  lastError: string | null;
  runs: number;
};

const g = globalThis as unknown as { __fozaReconcileScheduler?: SchedulerState };

function intervalMs(): number {
  const raw = Number(process.env.RECONCILE_INTERVAL_MS);
  if (Number.isFinite(raw) && raw >= MIN_INTERVAL_MS) return raw;
  return DEFAULT_INTERVAL_MS;
}

/** Run one sweep, guarded against overlap and never throwing. */
async function tick(state: SchedulerState): Promise<void> {
  if (state.running) {
    // Previous sweep still in flight (slow gateway) — skip this tick rather than
    // pile up concurrent reconciles racing on the same checkpoints.
    return;
  }
  state.running = true;
  try {
    // Import lazily so this module stays import-safe in any runtime; reconcile is
    // server-only and pulls in the DB.
    const { reconcileSettlements } = await import("./reconcile");
    const res = await reconcileSettlements();
    state.lastRunAt = Date.now();
    state.lastError = null;
    state.runs += 1;
    if (res.folded > 0 || res.reversedSynced > 0) {
      console.info(
        `[reconcile-scheduler] swept: folded=${res.folded} reversedSynced=${res.reversedSynced} scanned=${res.scanned}`,
      );
    }
  } catch (err) {
    state.lastError = err instanceof Error ? err.message : String(err);
    console.error("[reconcile-scheduler] sweep failed (will retry next tick):", err);
  } finally {
    state.running = false;
  }
}

/**
 * Start the periodic reconcile sweep. Idempotent: a second call is a no-op while
 * a timer is already live. No-op when the X-Router integration is disabled
 * (nothing to reconcile against).
 */
export function startReconcileScheduler(): void {
  if (xrouterConfig.enabled === false) return;

  const state: SchedulerState =
    g.__fozaReconcileScheduler ??
    (g.__fozaReconcileScheduler = {
      timer: null,
      running: false,
      lastRunAt: null,
      lastError: null,
      runs: 0,
    });

  if (state.timer) return; // already scheduled

  const period = intervalMs();
  // Kick off shortly after boot, then on a fixed interval. unref() so the timer
  // never keeps the process alive on its own (clean shutdown in dev/CI).
  const first = setTimeout(() => {
    void tick(state);
    state.timer = setInterval(() => void tick(state), period);
    state.timer.unref?.();
  }, FIRST_RUN_DELAY_MS);
  first.unref?.();

  console.info(
    `[reconcile-scheduler] started (interval ${Math.round(period / 1000)}s, first run in ${FIRST_RUN_DELAY_MS / 1000}s)`,
  );
}
