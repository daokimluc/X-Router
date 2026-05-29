#!/usr/bin/env node
/**
 * x-router — interactive CLI launcher.
 *
 * When run with no flags:
 *   1. Loads or auto-generates INTERNAL_API_KEYS / ADMIN_API_KEYS in
 *      ~/.x-router/config.json
 *   2. Starts the gateway in this process (logs go to ~/.x-router/server.log)
 *   3. Shows a menu: Open in browser / Show logs / Stop / Exit
 *
 * Flag-driven mode (CI / scripts):
 *   x-router --port 3100 --host 0.0.0.0
 *   Honors INTERNAL_API_KEYS / ADMIN_API_KEYS env vars; if not set, falls
 *   back to the saved config or auto-generates.
 *
 *   --no-menu           skip the interactive menu (useful for systemd / docker)
 *   --print-keys        print the generated/loaded keys then exit
 *   --help / -h         show usage
 */

import { mkdirSync, existsSync, readFileSync, writeFileSync, appendFileSync, openSync, closeSync, statSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import readline from 'node:readline';
import { spawn, exec } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VERSION = readVersion();

const args = process.argv.slice(2);
let port = '3100';
let host = '0.0.0.0';
let noMenu = false;
let printKeysOnly = false;

for (let i = 0; i < args.length; i++) {
  switch (args[i]) {
    case '--port': port = args[++i]; break;
    case '--host': host = args[++i]; break;
    case '--no-menu': noMenu = true; break;
    case '--print-keys': printKeysOnly = true; break;
    case '--help':
    case '-h':
      printHelp();
      process.exit(0);
  }
}

function printHelp() {
  console.log(`
Usage: x-router [options]

Options:
  --port <number>     Port to listen on (default: 3100)
  --host <string>     Host to bind to (default: 0.0.0.0)
  --no-menu           Don't show the interactive menu (background/CI mode)
  --print-keys        Print the saved/generated API keys and exit
  --help, -h          Show this help

Environment Variables:
  INTERNAL_API_KEYS   Override saved internal API keys
  ADMIN_API_KEYS      Override saved admin API keys
  DASHBOARD_DIST      Override path to the dashboard build output

Configuration:
  ~/.x-router/config.json   Auto-generated keys (created on first run)
  ~/.x-router/server.log    Server log file

Docs: https://github.com/daokimluc/AI-Gateway
`.trim());
}

const portNum = Number(port);
if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
  process.stderr.write(`Invalid port: ${port}\n`);
  process.exit(1);
}

// ─── Config ──────────────────────────────────────────────────
const CONFIG_DIR = path.join(homedir(), '.x-router');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');
const LOG_PATH = path.join(CONFIG_DIR, 'server.log');

function ensureConfig() {
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });

  let cfg = {};
  if (existsSync(CONFIG_PATH)) {
    try { cfg = JSON.parse(readFileSync(CONFIG_PATH, 'utf8')); } catch {}
  }

  let changed = false;
  if (!cfg.internalApiKeys) {
    cfg.internalApiKeys = `xrk_${randomBytes(16).toString('hex')}`;
    changed = true;
  }
  if (!cfg.adminApiKeys) {
    cfg.adminApiKeys = `xra_${randomBytes(16).toString('hex')}`;
    changed = true;
  }
  if (changed) {
    writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
  }
  return cfg;
}

const cfg = ensureConfig();
const internalKeys = process.env.INTERNAL_API_KEYS || cfg.internalApiKeys;
const adminKeys = process.env.ADMIN_API_KEYS || cfg.adminApiKeys;

if (printKeysOnly) {
  console.log(`INTERNAL_API_KEYS=${internalKeys}`);
  console.log(`ADMIN_API_KEYS=${adminKeys}`);
  process.exit(0);
}

process.env.PORT = String(portNum);
process.env.HOST = host;
process.env.INTERNAL_API_KEYS = internalKeys;
process.env.ADMIN_API_KEYS = adminKeys;

// ─── Banner ──────────────────────────────────────────────────
const url = `http://localhost:${portNum}`;
function banner() {
  const line = '='.repeat(40);
  console.log('');
  console.log(line);
  console.log(`  X-Router v${VERSION}`);
  console.log(`  🚀 Server: ${url}`);
  console.log(line);
  console.log('');
}

// ─── Start gateway in background ─────────────────────────────
async function startGateway() {
  // Clear log
  writeFileSync(LOG_PATH, '');

  // Redirect server stdout/stderr to log file
  const logFd = openSync(LOG_PATH, 'a');
  process.stdout.write = (chunk, ...rest) => {
    appendFileSync(LOG_PATH, typeof chunk === 'string' ? chunk : chunk.toString());
    return true;
  };
  process.stderr.write = (chunk, ...rest) => {
    appendFileSync(LOG_PATH, typeof chunk === 'string' ? chunk : chunk.toString());
    return true;
  };

  try {
    await import('../dist/server.js');
  } catch (err) {
    // Restore stderr so we can show the error
    delete process.stderr.write;
    if (err && err.code === 'EADDRINUSE') {
      console.error(`\nPort ${portNum} is already in use. Try a different --port.`);
      process.exit(1);
    }
    console.error(err);
    process.exit(1);
  }

  // Wait briefly for fastify listen to actually bind
  await waitForServer(url + '/healthz', 5000);
}

async function waitForServer(checkUrl, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(checkUrl);
      if (res.ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

// ─── Cross-platform helpers ──────────────────────────────────
function openInBrowser(target) {
  const cmd =
    platform() === 'win32' ? `start "" "${target}"` :
    platform() === 'darwin' ? `open "${target}"` :
    `xdg-open "${target}"`;
  exec(cmd, () => {});
}

function tailLog(lines = 30) {
  if (!existsSync(LOG_PATH)) {
    console.log('(no log file yet)');
    return;
  }
  const text = readFileSync(LOG_PATH, 'utf8');
  const all = text.split(/\r?\n/);
  const last = all.slice(Math.max(0, all.length - lines));
  // Pretty-print each pino JSON line if possible
  for (const line of last) {
    if (!line.trim()) continue;
    try {
      const j = JSON.parse(line);
      const t = j.time ? new Date(j.time).toISOString().slice(11, 19) : '';
      const lvl = j.level === 50 ? 'ERR' : j.level === 40 ? 'WRN' : j.level === 30 ? 'INF' : j.level === 20 ? 'DBG' : '???';
      const msg = j.msg || '';
      console.log(`${t} [${lvl}] ${msg}`);
    } catch {
      console.log(line);
    }
  }
}

// ─── Interactive menu ────────────────────────────────────────
function showMenu() {
  return new Promise((resolve) => {
    const items = [
      { label: 'Open Web UI in browser', action: 'open' },
      { label: 'Show server logs (last 30 lines)', action: 'logs' },
      { label: 'Print API keys', action: 'keys' },
      { label: 'Stop server and exit', action: 'exit' },
    ];

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

    function ask() {
      console.log('');
      items.forEach((it, i) => console.log(`  ${i + 1}. ${it.label}`));
      console.log('');
      rl.question('Choose [1-4]: ', (answer) => {
        const idx = Number(answer.trim()) - 1;
        const item = items[idx];
        if (!item) {
          console.log('Invalid choice.');
          return ask();
        }
        if (item.action === 'open') {
          openInBrowser(url);
          console.log(`Opening ${url} in your default browser...`);
          ask();
        } else if (item.action === 'logs') {
          tailLog(30);
          ask();
        } else if (item.action === 'keys') {
          console.log(`\n  INTERNAL_API_KEYS = ${internalKeys}`);
          console.log(`  ADMIN_API_KEYS    = ${adminKeys}`);
          console.log(`\n  (saved at ${CONFIG_PATH})`);
          ask();
        } else if (item.action === 'exit') {
          rl.close();
          resolve();
        }
      });
    }
    ask();
  });
}

// ─── Main ────────────────────────────────────────────────────
banner();
console.log('Starting server...');
await startGateway();

console.log(`\n✓ Server ready at ${url}`);
console.log(`  Admin login key: ${adminKeys.slice(0, 12)}...  (full: x-router --print-keys)`);
console.log(`  Logs: ${LOG_PATH}`);

if (noMenu) {
  console.log('\nRunning in background mode (--no-menu). Press Ctrl+C to stop.');
  // Park forever
  process.on('SIGINT', () => process.exit(0));
  process.on('SIGTERM', () => process.exit(0));
  // Keep event loop alive
  setInterval(() => {}, 1 << 30);
} else {
  await showMenu();
  console.log('\nGoodbye 👋');
  process.exit(0);
}

function readVersion() {
  try {
    const pkgPath = path.join(__dirname, '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    return pkg.version;
  } catch {
    return '0.0.0';
  }
}
