#!/usr/bin/env bun
/**
 * Bun entrypoint — used by `bun build --compile` to produce a single-file
 * binary (Windows .exe / macOS / Linux). Wraps server.ts with CLI flag
 * parsing identical to bin/ai-gateway.js.
 *
 * Dashboard assets are NOT embedded into the binary. They ship alongside
 * as `dashboard-dist/` in the release zip. Gateway resolves them via
 * DASHBOARD_DIST env var or relative path from process.cwd().
 */

import { resolve, dirname } from "node:path";

// Parse CLI flags
const args = process.argv.slice(2);
let port = "3100";
let host = "0.0.0.0";

for (let i = 0; i < args.length; i++) {
  switch (args[i]) {
    case "--port":
      port = args[++i];
      break;
    case "--host":
      host = args[++i];
      break;
    case "--help":
    case "-h":
      console.log(`
Usage: ai-gateway [options]

Options:
  --port <number>     Port to listen on (default: 3100)
  --host <string>     Host to bind to (default: 0.0.0.0)
  --help, -h          Show this help message

Environment Variables:
  INTERNAL_API_KEYS   Comma-separated API keys for /v1 routes (REQUIRED)
  ADMIN_API_KEYS      Comma-separated API keys for /admin routes (REQUIRED)
  DASHBOARD_DIST      Override path to dashboard-dist/ folder
                      (default: ./dashboard-dist next to binary)
`.trim());
      process.exit(0);
    case "--version":
    case "-v":
      console.log("ai-gateway 0.1.0");
      process.exit(0);
  }
}

const portNum = Number(port);
if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
  process.stderr.write(`Invalid port: ${port}. Must be an integer between 1 and 65535\n`);
  process.exit(1);
}

const requiredEnvVars = ["INTERNAL_API_KEYS", "ADMIN_API_KEYS"];
const missingVars = requiredEnvVars.filter((v) => !process.env[v]);
if (missingVars.length > 0) {
  for (const v of missingVars) {
    process.stderr.write(`Missing required environment variable: ${v}\n`);
  }
  process.stderr.write(`\nRun \`${process.argv[0]} --help\` for usage.\n`);
  process.exit(1);
}

process.env.PORT = String(portNum);
process.env.HOST = host;

// Resolve dashboard-dist relative to the binary's directory if not overridden
if (!process.env.DASHBOARD_DIST) {
  // Bun.main resolves to the entry script path within the embedded fs
  // process.execPath is the path to the binary itself
  const binaryDir = dirname(process.execPath);
  process.env.DASHBOARD_DIST = resolve(binaryDir, "dashboard-dist");
}

// Import the actual server (Bun resolves the TS file from embedded fs)
await import("../apps/gateway/src/server.ts");
