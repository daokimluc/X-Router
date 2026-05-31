/**
 * SupplyHealthMonitor — provision-webhook (#7) proactive supply health.
 *
 * `supply.unhealthy` otherwise only fires reactively when a request to a
 * non-house seller fails terminally. That misses a seller whose account is
 * disabled / stuck in cooldown / has been failing without recent traffic. This
 * monitor periodically scans engine account runtime state (NO upstream probe —
 * cheap, read-only) and emits `supply.unhealthy` once on the transition INTO an
 * unhealthy state, per non-house seller account. It re-arms when the account
 * recovers, so a flapping account doesn't spam the webhook.
 *
 * "Unhealthy" = account disabled, OR in cooldown, OR consecutiveFailures past a
 * threshold. House supply is never reported (it's the platform's own backstop).
 */
import type { WebhookService } from "../../services/WebhookService.js";

const HOUSE_SELLER_ID = "house";

export type SupplyHealthAccount = {
  id: string;
  sellerId?: string;
  status: "active" | "cooldown" | "disabled";
  runtime: { consecutiveFailures: number };
};

export type SupplyHealthDeps = {
  /** Snapshot all routable accounts (engine ProviderRuntimeRegistry.listAccounts). */
  listAccounts: () => SupplyHealthAccount[];
  webhookService: WebhookService;
  /** consecutiveFailures at/above which an account counts unhealthy. Default 3. */
  failureThreshold?: number;
  /** Scan period in ms. Default 60_000. */
  intervalMs?: number;
};

export class SupplyHealthMonitor {
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly unhealthy = new Set<string>(); // accountIds currently flagged
  private readonly threshold: number;
  private readonly intervalMs: number;

  constructor(private readonly deps: SupplyHealthDeps) {
    this.threshold = deps.failureThreshold ?? 3;
    this.intervalMs = deps.intervalMs ?? 60_000;
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

  private isUnhealthy(a: SupplyHealthAccount): boolean {
    return a.status === "disabled" || a.status === "cooldown" || a.runtime.consecutiveFailures >= this.threshold;
  }

  /** One scan pass. Public so tests can drive it deterministically. */
  scan(): void {
    let accounts: SupplyHealthAccount[];
    try {
      accounts = this.deps.listAccounts();
    } catch {
      return; // never break on a snapshot failure
    }
    const seen = new Set<string>();
    for (const a of accounts) {
      const sellerId = a.sellerId ?? HOUSE_SELLER_ID;
      if (sellerId === HOUSE_SELLER_ID) continue; // house is the backstop
      seen.add(a.id);
      const bad = this.isUnhealthy(a);
      const wasBad = this.unhealthy.has(a.id);
      if (bad && !wasBad) {
        this.unhealthy.add(a.id);
        void this.deps.webhookService.notifyBusiness("supply.unhealthy", {
          sellerId,
          providerAccountId: a.id,
          reason: a.status === "disabled" ? "account_disabled"
            : a.status === "cooldown" ? "account_cooldown"
            : "consecutive_failures"
        });
      } else if (!bad && wasBad) {
        this.unhealthy.delete(a.id); // recovered → re-arm
      }
    }
    // Drop accounts that vanished (deleted) so they can re-alert if re-added.
    for (const id of [...this.unhealthy]) {
      if (!seen.has(id)) this.unhealthy.delete(id);
    }
  }
}
