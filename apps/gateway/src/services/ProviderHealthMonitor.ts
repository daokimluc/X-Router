/**
 * ProviderHealthMonitor — Periodic health checks per connection with
 * auto-disable on consecutive failures and cooldown timer with auto-recovery.
 */

export type HealthStatus = "healthy" | "degraded" | "unhealthy" | "unknown";

export type ConnectionHealth = {
  providerInstanceId: string;
  accountId: string;
  status: HealthStatus;
  consecutiveFailures: number;
  lastCheckAt: Date | null;
  lastSuccessAt: Date | null;
  lastError: string | null;
  disabledAt: Date | null;
  cooldownUntil: Date | null;
};

export type HealthMonitorConfig = {
  /** Interval between health checks in ms (default: 60000 = 1 min) */
  checkIntervalMs: number;
  /** Number of consecutive failures before auto-disabling (default: 3) */
  failureThreshold: number;
  /** Cooldown duration after auto-disable in ms (default: 300000 = 5 min) */
  cooldownMs: number;
  /** Whether auto-recovery is enabled after cooldown (default: true) */
  autoRecoveryEnabled: boolean;
  /** Timeout for individual health check requests in ms (default: 10000) */
  healthCheckTimeoutMs: number;
};

const DEFAULT_CONFIG: HealthMonitorConfig = {
  checkIntervalMs: 60_000,
  failureThreshold: 3,
  cooldownMs: 300_000,
  autoRecoveryEnabled: true,
  healthCheckTimeoutMs: 10_000
};

export type HealthCheckFn = (
  providerInstanceId: string,
  accountId: string
) => Promise<{ ok: boolean; message?: string }>;

export type AccountDisableFn = (accountId: string, reason: string) => void;
export type AccountEnableFn = (accountId: string) => void;

export class ProviderHealthMonitor {
  private readonly config: HealthMonitorConfig;
  private readonly connections = new Map<string, ConnectionHealth>();
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private healthCheckFn: HealthCheckFn | null = null;
  private accountDisableFn: AccountDisableFn | null = null;
  private accountEnableFn: AccountEnableFn | null = null;

  constructor(config: Partial<HealthMonitorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** Register the health check function that will be called for each connection. */
  setHealthCheckFn(fn: HealthCheckFn): void {
    this.healthCheckFn = fn;
  }

  /** Register callback for disabling accounts on consecutive failures. */
  setAccountDisableFn(fn: AccountDisableFn): void {
    this.accountDisableFn = fn;
  }

  /** Register callback for re-enabling accounts after cooldown recovery. */
  setAccountEnableFn(fn: AccountEnableFn): void {
    this.accountEnableFn = fn;
  }

  /** Register a connection to be monitored. */
  registerConnection(providerInstanceId: string, accountId: string): void {
    const key = this.connectionKey(providerInstanceId, accountId);
    if (!this.connections.has(key)) {
      this.connections.set(key, {
        providerInstanceId,
        accountId,
        status: "unknown",
        consecutiveFailures: 0,
        lastCheckAt: null,
        lastSuccessAt: null,
        lastError: null,
        disabledAt: null,
        cooldownUntil: null
      });
    }
  }

  /** Unregister a connection from monitoring. */
  unregisterConnection(providerInstanceId: string, accountId: string): void {
    const key = this.connectionKey(providerInstanceId, accountId);
    this.connections.delete(key);
  }

  /** Get health status for a specific connection. */
  getConnectionHealth(providerInstanceId: string, accountId: string): ConnectionHealth | undefined {
    return this.connections.get(this.connectionKey(providerInstanceId, accountId));
  }

  /** Get all connection health statuses. */
  listConnectionHealth(): ConnectionHealth[] {
    return Array.from(this.connections.values());
  }

  /** Start periodic health monitoring. */
  start(): void {
    if (this.intervalHandle) return;
    this.intervalHandle = setInterval(() => {
      void this.runHealthChecks();
    }, this.config.checkIntervalMs);
  }

  /** Stop periodic health monitoring. */
  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  /** Run health checks for all registered connections. */
  async runHealthChecks(): Promise<void> {
    if (!this.healthCheckFn) return;

    const now = new Date();
    const checks: Promise<void>[] = [];

    for (const [, conn] of this.connections) {
      // Skip connections in cooldown (unless cooldown expired and auto-recovery is on)
      if (conn.cooldownUntil) {
        if (now < conn.cooldownUntil) continue;

        // Cooldown expired — attempt auto-recovery
        if (this.config.autoRecoveryEnabled) {
          conn.cooldownUntil = null;
          conn.disabledAt = null;
          conn.consecutiveFailures = 0;
          this.accountEnableFn?.(conn.accountId);
        }
      }

      checks.push(this.checkConnection(conn, now));
    }

    await Promise.allSettled(checks);
  }

  /** Manually trigger a health check for a specific connection. */
  async checkSingle(providerInstanceId: string, accountId: string): Promise<ConnectionHealth | null> {
    const key = this.connectionKey(providerInstanceId, accountId);
    const conn = this.connections.get(key);
    if (!conn) return null;
    await this.checkConnection(conn, new Date());
    return conn;
  }

  /** Record an external failure (e.g., from a request that failed). */
  recordFailure(providerInstanceId: string, accountId: string, error: string): void {
    const key = this.connectionKey(providerInstanceId, accountId);
    const conn = this.connections.get(key);
    if (!conn) return;

    conn.consecutiveFailures += 1;
    conn.lastError = error;
    conn.status = conn.consecutiveFailures >= this.config.failureThreshold ? "unhealthy" : "degraded";

    if (conn.consecutiveFailures >= this.config.failureThreshold && !conn.disabledAt) {
      conn.disabledAt = new Date();
      conn.cooldownUntil = new Date(Date.now() + this.config.cooldownMs);
      this.accountDisableFn?.(accountId, `Auto-disabled after ${conn.consecutiveFailures} consecutive failures: ${error}`);
    }
  }

  /** Record an external success (e.g., from a successful request). */
  recordSuccess(providerInstanceId: string, accountId: string): void {
    const key = this.connectionKey(providerInstanceId, accountId);
    const conn = this.connections.get(key);
    if (!conn) return;

    conn.consecutiveFailures = 0;
    conn.status = "healthy";
    conn.lastSuccessAt = new Date();
    conn.lastError = null;
  }

  /** Get current config. */
  getConfig(): HealthMonitorConfig {
    return { ...this.config };
  }

  /** Update config at runtime. */
  updateConfig(patch: Partial<HealthMonitorConfig>): void {
    Object.assign(this.config, patch);

    // Restart interval if it changed
    if (patch.checkIntervalMs && this.intervalHandle) {
      this.stop();
      this.start();
    }
  }

  // ─── Private ─────────────────────────────────────────────

  private async checkConnection(conn: ConnectionHealth, now: Date): Promise<void> {
    if (!this.healthCheckFn) return;

    conn.lastCheckAt = now;

    try {
      const result = await this.healthCheckFn(conn.providerInstanceId, conn.accountId);

      if (result.ok) {
        conn.consecutiveFailures = 0;
        conn.status = "healthy";
        conn.lastSuccessAt = now;
        conn.lastError = null;
      } else {
        conn.consecutiveFailures += 1;
        conn.lastError = result.message ?? "Health check failed";
        conn.status = conn.consecutiveFailures >= this.config.failureThreshold
          ? "unhealthy"
          : "degraded";

        // Auto-disable on threshold
        if (conn.consecutiveFailures >= this.config.failureThreshold && !conn.disabledAt) {
          conn.disabledAt = now;
          conn.cooldownUntil = new Date(now.getTime() + this.config.cooldownMs);
          this.accountDisableFn?.(
            conn.accountId,
            `Auto-disabled after ${conn.consecutiveFailures} failures: ${conn.lastError}`
          );
        }
      }
    } catch (error) {
      conn.consecutiveFailures += 1;
      conn.lastError = error instanceof Error ? error.message : "Unknown error";
      conn.status = "degraded";
    }
  }

  private connectionKey(providerInstanceId: string, accountId: string): string {
    return `${providerInstanceId}::${accountId}`;
  }
}
