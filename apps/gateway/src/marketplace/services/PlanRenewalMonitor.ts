/**
 * PlanRenewalMonitor — marketplace-plan-subscription.
 *
 * Lazy renewal in the policy check is the source of truth for keys that send
 * traffic. This monitor covers IDLE keys: a plan-bound key whose subscription
 * period has elapsed but which sends no requests would otherwise never renew (or
 * downgrade). It periodically scans all plan-bound keys and calls the SAME
 * `renewIfDue` routine, so a key renewed lazily a moment before the scan is a
 * no-op here (its period already advanced — `renewIfDue` re-checks the guard).
 *
 * Modeled on SupplyHealthMonitor: setInterval + unref(), public scan() for
 * deterministic tests, start()/stop() driven from registerMarketplace.
 */

const HOUR_MS = 60 * 60_000;

export type PlanRenewalDeps = {
  /** Snapshot all keys (engine ApiKeyService.list()). */
  listKeys: () => Array<{ id: string; planId?: string; planPeriodEnd?: number }>;
  /** Shared renewal routine (PlanSubscriptionService.renewIfDue). */
  renewIfDue: (keyId: string) => unknown;
  /** Scan period in ms. Default 1 hour. */
  intervalMs?: number;
  /** Injectable clock for tests. Defaults to Date.now. */
  now?: () => number;
};

export class PlanRenewalMonitor {
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly intervalMs: number;
  private readonly now: () => number;

  constructor(private readonly deps: PlanRenewalDeps) {
    this.intervalMs = deps.intervalMs ?? HOUR_MS;
    this.now = deps.now ?? (() => Date.now());
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.scan(), this.intervalMs);
    if (typeof this.timer === "object" && "unref" in this.timer) this.timer.unref();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** One scan pass. Public so tests can drive it deterministically. */
  scan(): void {
    let keys: Array<{ id: string; planId?: string; planPeriodEnd?: number }>;
    try {
      keys = this.deps.listKeys();
    } catch {
      return; // never break on a snapshot failure
    }
    const now = this.now();
    for (const k of keys) {
      // Renew due keys (period elapsed) and grandfather legacy keys (plan bound,
      // no period). renewIfDue is the single decision point + re-checks the guard.
      if (!k.planId) continue;
      if (typeof k.planPeriodEnd === "number" && now < k.planPeriodEnd) continue;
      try {
        this.deps.renewIfDue(k.id);
      } catch {
        // one bad key must not stop the sweep
      }
    }
  }
}
