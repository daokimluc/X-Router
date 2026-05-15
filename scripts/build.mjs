#!/usr/bin/env node

import { execSync } from "node:child_process";
import { cpSync, existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");

/**
 * Run a shell command, streaming output to stdout/stderr.
 * Exits with non-zero code if the command fails.
 */
function run(command, cwd) {
  try {
    execSync(command, { cwd, stdio: "inherit" });
  } catch (error) {
    process.stderr.write(`\nBuild failed while running: ${command}\n`);
    process.exit(error.status || 1);
  }
}

// --- Step 1: Validate dashboard source exists ---
const dashboardDir = resolve(ROOT, "apps", "dashboard");
if (!existsSync(dashboardDir)) {
  process.stderr.write(
    "Dashboard source directory not found: apps/dashboard/\n"
  );
  process.exit(1);
}

// --- Step 2: Build Dashboard ---
console.log("\n=== Building Dashboard ===\n");
run("npm ci", dashboardDir);
run("npm run build", dashboardDir);

// Copy dashboard dist output to dashboard-dist/ at root
const dashboardDistSrc = resolve(dashboardDir, "dist");
const dashboardDistDest = resolve(ROOT, "dashboard-dist");

if (!existsSync(dashboardDistSrc)) {
  process.stderr.write(
    "Dashboard build did not produce output at apps/dashboard/dist/\n"
  );
  process.exit(1);
}

// Clean and copy
if (existsSync(dashboardDistDest)) {
  rmSync(dashboardDistDest, { recursive: true, force: true });
}
cpSync(dashboardDistSrc, dashboardDistDest, { recursive: true });
console.log("\n✓ Dashboard build output copied to dashboard-dist/\n");

// --- Step 3: Build Gateway ---
console.log("\n=== Building Gateway ===\n");
const gatewayDir = resolve(ROOT, "apps", "gateway");
run("npm ci", gatewayDir);
run("npm run build", gatewayDir);

// Copy gateway dist output to dist/ at root
const gatewayDistSrc = resolve(gatewayDir, "dist");
const gatewayDistDest = resolve(ROOT, "dist");

if (!existsSync(gatewayDistSrc)) {
  process.stderr.write(
    "Gateway build did not produce output at apps/gateway/dist/\n"
  );
  process.exit(1);
}

// Clean and copy
if (existsSync(gatewayDistDest)) {
  rmSync(gatewayDistDest, { recursive: true, force: true });
}
cpSync(gatewayDistSrc, gatewayDistDest, { recursive: true });
console.log("\n✓ Gateway build output copied to dist/\n");

console.log("\n=== Build complete ===\n");
