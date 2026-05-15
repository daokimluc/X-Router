/**
 * Single-instance language-server manager.
 *
 * Ported (subset, simplified) from dwgx/WindsurfAPI/src/langserver.js (MIT).
 * See LICENSE-WindsurfAPI.md in this directory for attribution.
 *
 * Key differences from the upstream multi-LS pool:
 *   - one LS per gateway process (no proxy pool, no per-account segregation)
 *   - no auto-restart loop (single shot — if the LS crashes the next call respawns)
 *   - no Cascade workspace warmup here; that lives in {@link LsClient}
 */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import http2 from "node:http2";
import { arch as osArch, platform as osPlatform, homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

import { closeSessionForPort } from "./grpc.js";

const DEFAULT_CSRF = "windsurf-api-csrf-fixed-token";
const DEFAULT_API_URL = "https://server.self-serve.windsurf.com";
const DEFAULT_PORT = 42_100;

export type LsLogger = {
  debug?: (msg: string, meta?: Record<string, unknown>) => void;
  info?: (msg: string, meta?: Record<string, unknown>) => void;
  warn?: (msg: string, meta?: Record<string, unknown>) => void;
  error?: (msg: string, meta?: Record<string, unknown>) => void;
};

export type LangServerOptions = {
  /** Path to the language_server_* binary. */
  binaryPath: string;
  /**
   * Local TCP port to bind. Default 42100. The manager probes the port
   * before spawning; if it is already in use the next call to {@link ensure}
   * will throw. Override per-instance to colocate multiple gateways on a
   * single host.
   */
  port?: number;
  /** Upstream Windsurf cloud URL. Default `https://server.self-serve.windsurf.com`. */
  apiServerUrl?: string;
  /** Codeium dir + database dir root. Default `<os tmp>/windsurf-gateway`. */
  dataRoot?: string;
  /**
   * CSRF token sent on every gRPC request and to the LS at spawn. Must
   * match between client and server, and must be stable across the
   * lifetime of this manager.
   */
  csrfToken?: string;
  /** Spawn readiness timeout, ms. Default 25_000. */
  readyTimeoutMs?: number;
  /** Logger. Defaults to no-op. */
  logger?: LsLogger;
};

export type LsEntry = {
  process: ChildProcessWithoutNullStreams;
  port: number;
  csrfToken: string;
  apiKey: string | null;
  /** Stable per-spawn UUID; bump when respawning. */
  generation: string;
  /** Session id used for Cascade flow. Filled by client.warmup. */
  sessionId: string | null;
  /** Cached promise of the workspace-init handshake (one-shot per LS). */
  workspaceInit: Promise<void> | null;
  startedAt: number;
};

const noopLogger: Required<LsLogger> = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

export class LangServerManager {
  private readonly options: Required<Omit<LangServerOptions, "logger">> & {
    logger: Required<LsLogger>;
  };
  private entry: LsEntry | null = null;
  private pending: Promise<LsEntry> | null = null;

  constructor(options: LangServerOptions) {
    const logger = { ...noopLogger, ...(options.logger ?? {}) };
    this.options = {
      binaryPath: options.binaryPath,
      port: options.port ?? DEFAULT_PORT,
      apiServerUrl: options.apiServerUrl ?? DEFAULT_API_URL,
      dataRoot:
        options.dataRoot ?? resolve(tmpdir(), "windsurf-gateway"),
      csrfToken: options.csrfToken ?? DEFAULT_CSRF,
      readyTimeoutMs: options.readyTimeoutMs ?? 25_000,
      logger,
    };
  }

  /** Get the running LS, spawning it if needed. */
  async ensure(): Promise<LsEntry> {
    if (this.entry && !this.entry.process.killed) {
      return this.entry;
    }
    if (this.pending) {
      return this.pending;
    }
    this.pending = this.spawnLs().finally(() => {
      this.pending = null;
    });
    return this.pending;
  }

  /**
   * Stop the LS subprocess and release its HTTP/2 session. Idempotent.
   */
  async stop(): Promise<void> {
    const current = this.entry;
    this.entry = null;
    if (!current) {
      return;
    }
    try {
      closeSessionForPort(current.port);
    } catch {
      // ignore
    }
    if (!current.process.killed) {
      try {
        current.process.kill("SIGTERM");
      } catch {
        // ignore
      }
    }
  }

  private async spawnLs(): Promise<LsEntry> {
    const { binaryPath, port, apiServerUrl, dataRoot, csrfToken, readyTimeoutMs, logger } =
      this.options;

    if (!existsSync(binaryPath)) {
      throw new Error(
        `Windsurf language-server binary not found at ${binaryPath}. ` +
          `Set WINDSURF_LS_BINARY_PATH or install the Windsurf desktop app.`
      );
    }

    try {
      mkdirSync(`${dataRoot}/db`, { recursive: true });
    } catch (err) {
      logger.warn(
        `mkdirSync ${dataRoot}/db failed: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }

    const args = [
      `--api_server_url=${apiServerUrl}`,
      `--server_port=${port}`,
      `--csrf_token=${csrfToken}`,
      `--register_user_url=https://api.codeium.com/register_user/`,
      `--codeium_dir=${dataRoot}`,
      `--database_dir=${dataRoot}/db`,
      `--detect_proxy=false`,
    ];

    logger.info(
      `Spawning Windsurf language server: port=${port} dataRoot=${dataRoot}`
    );

    const env = buildEnv(process.env);
    const proc = spawn(binaryPath, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env,
    });

    proc.stdout.on("data", (data: Buffer) => {
      for (const line of data.toString().split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) {
          continue;
        }
        if (/ERROR|error/.test(trimmed)) {
          logger.error(`[LS] ${trimmed}`);
        } else {
          logger.debug(`[LS] ${trimmed}`);
        }
      }
    });
    proc.stderr.on("data", (data: Buffer) => {
      const trimmed = data.toString().trim();
      if (trimmed) {
        logger.warn(`[LS:stderr] ${trimmed}`);
      }
    });
    proc.on("exit", (code, signal) => {
      logger.warn(`Windsurf LS exited: code=${code} signal=${signal}`);
      try {
        closeSessionForPort(port);
      } catch {
        // ignore
      }
      if (this.entry?.process === proc) {
        this.entry = null;
      }
    });
    proc.on("error", (err) => {
      logger.error(`Windsurf LS spawn error: ${err.message}`);
      if (this.entry?.process === proc) {
        this.entry = null;
      }
    });

    const entry: LsEntry = {
      process: proc,
      port,
      csrfToken,
      apiKey: null,
      generation: randomUUID(),
      sessionId: null,
      workspaceInit: null,
      startedAt: Date.now(),
    };
    this.entry = entry;

    try {
      await waitPortReady(port, readyTimeoutMs);
    } catch (err) {
      logger.error(
        `Windsurf LS failed to become ready on port ${port}: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
      try {
        proc.kill("SIGKILL");
      } catch {
        // ignore
      }
      this.entry = null;
      throw err;
    }

    logger.info(`Windsurf LS ready on port ${port}`);
    return entry;
  }
}

/**
 * Best-effort search for the Windsurf language-server binary on the
 * current host. Returns the first existing path. Caller can override
 * via `WINDSURF_LS_BINARY_PATH`.
 */
export function detectLanguageServerBinary(): string | null {
  const env = process.env.WINDSURF_LS_BINARY_PATH;
  if (env && existsSync(env)) {
    return env;
  }
  const platform = osPlatform();
  const arch = osArch();
  const home = homedir();

  const candidates: string[] = [];
  if (platform === "win32") {
    const local = process.env.LOCALAPPDATA;
    if (local) {
      candidates.push(
        join(
          local,
          "Programs",
          "Windsurf",
          "resources",
          "app",
          "extensions",
          "windsurf",
          "bin",
          "language_server_windows_x64.exe"
        )
      );
    }
    const appData = process.env.APPDATA;
    if (appData) {
      candidates.push(
        join(appData, "Windsurf", "bin", "language_server_windows_x64.exe")
      );
    }
  } else if (platform === "darwin") {
    const armName =
      arch === "arm64"
        ? "language_server_macos_arm"
        : "language_server_macos_x64";
    candidates.push(
      join(
        home,
        "Library",
        "Application Support",
        "Windsurf",
        "resources",
        "app",
        "extensions",
        "windsurf",
        "bin",
        armName
      ),
      join(home, ".windsurf", armName)
    );
  } else {
    const linuxName =
      arch === "arm64"
        ? "language_server_linux_arm"
        : "language_server_linux_x64";
    candidates.push(
      join(home, ".windsurf", "bin", linuxName),
      `/opt/Windsurf/resources/app/extensions/windsurf/bin/${linuxName}`,
      `/opt/windsurf/${linuxName}`
    );
  }
  return candidates.find((p) => existsSync(p)) ?? null;
}

function buildEnv(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const allow = [
    "HOME",
    "PATH",
    "LANG",
    "LC_ALL",
    "TMPDIR",
    "TMP",
    "TEMP",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "NO_PROXY",
    "http_proxy",
    "https_proxy",
    "no_proxy",
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
    "NODE_EXTRA_CA_CERTS",
    "USERPROFILE",
    "APPDATA",
    "LOCALAPPDATA",
    "SYSTEMROOT",
  ];
  const env: NodeJS.ProcessEnv = {};
  for (const key of allow) {
    const v = source[key];
    if (v !== undefined && v !== "") {
      env[key] = v;
    }
  }
  if (!env.HOME) {
    env.HOME = source.HOME || homedir();
  }
  return env;
}

async function waitPortReady(port: number, timeoutMs: number): Promise<void> {
  const start = Date.now();
  let lastErr: Error | null = null;
  while (Date.now() - start < timeoutMs) {
    try {
      await probeOnce(port);
      return;
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      await sleep(500);
    }
  }
  throw new Error(
    `LS port ${port} not ready after ${timeoutMs}ms${
      lastErr ? `: ${lastErr.message}` : ""
    }`
  );
}

function probeOnce(port: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const client = http2.connect(`http://localhost:${port}`);
    const timer = setTimeout(() => {
      try {
        client.close();
      } catch {
        // ignore
      }
      reject(new Error("probe timeout"));
    }, 2_000);
    client.on("connect", () => {
      clearTimeout(timer);
      try {
        client.close();
      } catch {
        // ignore
      }
      resolve();
    });
    client.on("error", (err) => {
      clearTimeout(timer);
      try {
        client.close();
      } catch {
        // ignore
      }
      reject(err);
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}
