#!/usr/bin/env node
/**
 * x-router â€” interactive CLI launcher.
 *
 * Spawns the gateway as a child process so the launcher console stays clean
 * for the menu while pino JSON logs go to ~/.x-router/server.log.
 *
 * No flags â†’ banner + start + interactive menu.
 *
 * Flags:
 *   --port <n>       gateway port (default 3100)
 *   --host <h>       bind host (default 0.0.0.0)
 *   --no-menu        run server in foreground, log to stdout (CI / docker)
 *   --print-keys     print saved keys and exit
 *   --help, -h
 */

import { mkdirSync, existsSync, readFileSync, writeFileSync, openSync, closeSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import readline from 'node:readline';
import { spawn, exec } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
let port = '3100';
let host = '0.0.0.0';
let noMenu = false;
let printKeysOnly = false;
let resetAdminKey = false;
let setProvisionKey = null;

for (let i = 0; i < args.length; i++) {
  switch (args[i]) {
    case '--port': port = args[++i]; break;
    case '--host': host = args[++i]; break;
    case '--no-menu': noMenu = true; break;
    case '--print-keys': printKeysOnly = true; break;
    case '--reset-admin-key': resetAdminKey = true; break;
    case '--set-provision-key': setProvisionKey = args[++i]; break;
    case '--help':
    case '-h':
      printHelp(); process.exit(0);
  }
}

function printHelp() {
  console.log(`
Usage: x-router [options]

Options:
  --port <number>     Port to listen on (default: 3100)
  --host <string>     Host to bind to (default: 0.0.0.0)
  --no-menu           Run in foreground (no menu, logs to stdout)
  --print-keys        Print saved API keys and exit
  --reset-admin-key   Reset the admin login password to "admin" and exit
  --set-provision-key <key>  Set the marketplace provision API key and exit
  --help, -h          Show this help

Configuration:
  ~/.x-router/config.json          Saved API keys (auto-generated on first run)
  ~/.x-router/gateway-state.json   Gateway data (accounts, usage, logs, ...)
  ~/.x-router/server.log           Server log (rotated each launch)

Docs: https://github.com/daokimluc/X-Router
`.trim());
}

const portNum = Number(port);
if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
  process.stderr.write(`Invalid port: ${port}\n`);
  process.exit(1);
}

// â”€â”€â”€ Config â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const CONFIG_DIR = path.join(homedir(), '.x-router');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');
const LOG_PATH = path.join(CONFIG_DIR, 'server.log');
// Persist gateway state under the user's home dir (like config.json), NOT in
// the directory the command happens to be run from. DATA_FILE defaults to a
// relative path, so without this the data "follows" the cwd and a user
// launching x-router from a different folder would see an empty dashboard.
// An explicit DATA_FILE env var still wins (advanced/override use).
const DATA_PATH = process.env.DATA_FILE || path.join(CONFIG_DIR, 'gateway-state.json');

function ensureConfig() {
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
  let cfg = {};
  if (existsSync(CONFIG_PATH)) {
    try { cfg = JSON.parse(readFileSync(CONFIG_PATH, 'utf8')); } catch {}
  }
  // Default admin key is literally "admin" â€” simple to remember on first run.
  // Admins can rotate it via the dashboard; the new value is read from
  // ADMIN_API_KEYS env on each launch (or kept here if persisted).
  if (!cfg.adminApiKeys) {
    cfg.adminApiKeys = "admin";
    writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
  }
  return cfg;
}

const cfg = ensureConfig();
const adminKeys = process.env.ADMIN_API_KEYS || cfg.adminApiKeys;
const provisionKeys = process.env.PROVISION_API_KEYS || cfg.provisionApiKeys || '';

if (setProvisionKey !== null) {
  if (!setProvisionKey || setProvisionKey.startsWith('-')) {
    console.error('Usage: x-router --set-provision-key <key>');
    process.exit(1);
  }
  cfg.provisionApiKeys = setProvisionKey;
  writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
  console.log('Provision API key set.');
  console.log(`(saved to ${CONFIG_PATH}) — restart x-router for it to take effect.`);
  process.exit(0);
}

if (resetAdminKey) {
  cfg.adminApiKeys = "admin";
  writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
  console.log('Admin login password reset to: admin');
  console.log(`(saved to ${CONFIG_PATH}) — restart x-router for it to take effect.`);
  process.exit(0);
}

if (printKeysOnly) {
  console.log(`ADMIN_API_KEYS=${adminKeys}`);
  process.exit(0);
}

const VERSION = readVersion();
const url = `http://localhost:${portNum}`;

// â”€â”€â”€ --no-menu: run server inline (foreground) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
if (noMenu) {
  process.env.PORT = String(portNum);
  process.env.HOST = host;
  process.env.ADMIN_API_KEYS = adminKeys;
  if (provisionKeys) process.env.PROVISION_API_KEYS = provisionKeys;
  process.env.DATA_FILE = DATA_PATH;
  console.log(`X-Router v${VERSION} starting on ${url}`);
  await import('../dist/server.js');
} else {
  // â”€â”€â”€ Interactive mode: spawn server as child â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  banner();
  console.log('Starting server...\n');

  const serverEntry = path.resolve(__dirname, '..', 'dist', 'server.js');
  const logFd = openSync(LOG_PATH, 'w'); // truncate

  const child = spawn(process.execPath, [serverEntry], {
    env: {
      ...process.env,
      PORT: String(portNum),
      HOST: host,
      ADMIN_API_KEYS: adminKeys,
      ...(provisionKeys ? { PROVISION_API_KEYS: provisionKeys } : {}),
      DATA_FILE: DATA_PATH,
    },
    stdio: ['ignore', logFd, logFd],
    windowsHide: true,
  });

  child.on('exit', (code, signal) => {
    closeSync(logFd);
    if (code !== 0 && code !== null) {
      console.error(`\nServer exited with code ${code}. Last log lines:`);
      tailLog(15);
    }
    process.exit(code ?? 0);
  });

  child.on('error', (err) => {
    console.error('Failed to spawn server:', err.message);
    process.exit(1);
  });

  // Wait for /healthz to respond
  const ready = await waitForServer(`${url}/healthz`, 15000);
  if (!ready) {
    console.error('\nServer did not become ready within 15s. Recent log lines:');
    tailLog(15);
    child.kill();
    process.exit(1);
  }

  console.log(`âœ“ Server ready at ${url}`);
  console.log(`  Admin login key: ${adminKeys}  (rotate via dashboard â†’ Settings)`);
  console.log(`  Logs: ${LOG_PATH}`);

  // Auto-open browser on first launch
  openInBrowser(url);

  // Cleanup on Ctrl+C
  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log('\nStopping server...');
    child.kill();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  const result = await showMenu(child);
  if (result === 'exit') {
    shutdown();
  } else if (result === 'hide') {
    // Detach: don't kill child. Exit launcher; child node keeps running.
    process.exit(0);
  }
}

// â”€â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function banner() {
  const line = '='.repeat(40);
  console.log('');
  console.log(line);
  console.log(`  X-Router v${VERSION}`);
  console.log(`  ðŸš€ Server: ${url}`);
  console.log(line);
}

async function waitForServer(checkUrl, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(checkUrl);
      if (res.ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

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
  for (const line of last) {
    if (!line.trim()) continue;
    try {
      const j = JSON.parse(line);
      const t = j.time ? new Date(j.time).toISOString().slice(11, 19) : '';
      const lvl = j.level === 50 ? 'ERR' : j.level === 40 ? 'WRN' : j.level === 30 ? 'INF' : j.level === 20 ? 'DBG' : '???';
      const msg = j.msg || '';
      console.log(`  ${t} [${lvl}] ${msg}`);
    } catch {
      console.log('  ' + line);
    }
  }
}

function showMenu(child) {
  return new Promise((resolve) => {
    const items = [
      { label: 'Open Web UI in browser', action: 'open' },
      { label: 'Show server logs (last 30 lines)', action: 'logs' },
      { label: 'Print admin key', action: 'keys' },
      { label: 'Hide to background (server keeps running)', action: 'hide' },
      { label: 'Stop server and exit', action: 'exit' },
    ];

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

    function ask() {
      console.log('');
      items.forEach((it, i) => console.log(`  ${i + 1}. ${it.label}`));
      console.log('');
      rl.question(`Choose [1-${items.length}]: `, (answer) => {
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
          console.log(`\n  Admin login key: ${adminKeys}`);
          console.log(`\n  Rotate via dashboard â†’ Settings, or edit ${CONFIG_PATH}`);
          console.log(`  then restart x-router.`);
          ask();
        } else if (item.action === 'hide') {
          if (child.unref) child.unref();
          console.log('');
          console.log(`âœ“ Server keeps running in background at ${url}`);
          console.log(`  Logs: ${LOG_PATH}`);
          console.log(`  To stop: kill the node process on port ${portNum},`);
          console.log(`  or run \`x-router\` again â€” it will detect & manage the existing instance.`);
          rl.close();
          resolve('hide');
        } else if (item.action === 'exit') {
          rl.close();
          resolve('exit');
        }
      });
    }
    ask();
  });
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
