/**
 * AutoRefreshService — Background job that proactively refreshes
 * Kiro/OAuth tokens before they expire (5 minutes before expiry).
 * Runs every 60 seconds, checks all accounts with expiresAt.
 */

import type { FastifyInstance } from "fastify";

const CHECK_INTERVAL_MS = 60_000; // Check every 60 seconds
const REFRESH_BEFORE_MS = 5 * 60_000; // Refresh 5 minutes before expiry

export class AutoRefreshService {
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private running = false;

  start(app: FastifyInstance): void {
    if (this.intervalHandle) return;

    this.intervalHandle = setInterval(() => {
      if (this.running) return;
      this.running = true;
      void this.tick(app).finally(() => { this.running = false; });
    }, CHECK_INTERVAL_MS);
  }

  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  private async tick(app: FastifyInstance): Promise<void> {
    const accounts = app.providerRuntimeRegistry.listAccounts();
    const now = Date.now();

    for (const account of accounts) {
      if (account.status === "disabled") continue;

      const secret = app.secretService.getSecretForAccount(account.id);
      if (!secret) continue;

      const payload = app.secretService.decryptSecretPayload(secret) as Record<string, unknown>;
      const expiresAt = payload.expiresAt as string | undefined;
      if (!expiresAt) continue;

      const expiryTime = new Date(expiresAt).getTime();
      if (isNaN(expiryTime)) continue;

      const timeUntilExpiry = expiryTime - now;
      if (timeUntilExpiry > REFRESH_BEFORE_MS) continue;
      if (timeUntilExpiry < -60_000 * 30) continue; // Skip if expired > 30 min ago

      // Needs refresh
      const refreshToken = payload.refreshToken as string | undefined;
      if (!refreshToken) continue;

      try {
        const providerInstance = app.providerRuntimeRegistry.getProviderInstance(account.providerInstanceId);
        if (!providerInstance) continue;

        const adapter = app.providerRegistry.getAdapter(providerInstance.type);
        if (!adapter.refreshSession) continue;

        const result = await adapter.refreshSession(account, {
          providerInstance,
          credentialPayload: payload
        });

        if (result.refreshed && result.credentialPayload) {
          app.secretService.updateSecretPayload(secret.id, result.credentialPayload);
        }
      } catch {
        // Silently skip — will retry next tick
      }
    }
  }
}
