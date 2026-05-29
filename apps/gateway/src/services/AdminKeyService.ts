import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/**
 * AdminKeyService — single source of truth for the admin login key(s) at
 * runtime.
 *
 * Why this exists: the admin key used to be an immutable startup snapshot
 * (`config.adminApiKeys` copied into `new Set()` inside each auth middleware),
 * so the "Change Password" button could only ever validate — it had no way to
 * actually change the live key without a process restart.
 *
 * This service holds the keys array and, crucially, **mutates the same array
 * instance** that `config.adminApiKeys` points to (via `spliceInto`). Auth
 * middleware reads that array live on each request, so a password change takes
 * effect immediately.
 *
 * Persistence target is `~/.x-router/config.json` — the exact file the
 * `x-router` CLI launcher reads on the next launch (key `adminApiKeys`,
 * comma-separated string). This keeps the dashboard, the CLI, and the running
 * process in agreement.
 */

export const DEFAULT_ADMIN_KEY = "admin";

function configPath(): string {
  return join(homedir(), ".x-router", "config.json");
}

export class AdminKeyService {
  /** The live keys array — same reference as config.adminApiKeys. */
  private readonly keys: string[];
  private readonly persistPath: string;

  constructor(keys: string[], options: { persistPath?: string } = {}) {
    this.keys = keys;
    this.persistPath = options.persistPath ?? configPath();
  }

  /** True if the given token is a currently-valid admin key. */
  isValid(token: string): boolean {
    return this.keys.includes(token);
  }

  /** True if the only admin key is still the out-of-the-box default. */
  isDefault(): boolean {
    return this.keys.length === 1 && this.keys[0] === DEFAULT_ADMIN_KEY;
  }

  /** Snapshot of current keys (defensive copy). */
  list(): string[] {
    return [...this.keys];
  }

  /**
   * Replace all admin keys with a single new key and persist. The array
   * instance is mutated in place so live middleware sees the change without a
   * restart.
   */
  setKey(newKey: string): void {
    const trimmed = newKey.trim();
    if (trimmed.length < 4) {
      throw new Error("Admin key must be at least 4 characters");
    }
    this.replaceAll([trimmed]);
    this.persist();
  }

  /** Reset the admin key back to the default ("admin") and persist. */
  reset(): void {
    this.replaceAll([DEFAULT_ADMIN_KEY]);
    this.persist();
  }

  private replaceAll(next: string[]): void {
    this.keys.splice(0, this.keys.length, ...next);
  }

  private persist(): void {
    try {
      const dir = dirname(this.persistPath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      let cfg: Record<string, unknown> = {};
      if (existsSync(this.persistPath)) {
        try {
          cfg = JSON.parse(readFileSync(this.persistPath, "utf8")) as Record<string, unknown>;
        } catch {
          cfg = {};
        }
      }
      // CLI reads adminApiKeys as a comma-separated string.
      cfg.adminApiKeys = this.keys.join(",");
      writeFileSync(this.persistPath, JSON.stringify(cfg, null, 2));
    } catch {
      // Persistence is best-effort: the in-memory change already took effect
      // for the running process. A failure here (read-only FS, etc.) should
      // not break the password change for this session.
    }
  }
}
