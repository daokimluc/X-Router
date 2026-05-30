import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Open-core boundary guard.
 *
 * The marketplace layer (apps/gateway/src/marketplace/) is proprietary and must
 * remain extractable: the core engine can NEVER depend on it. This test scans
 * every engine source file and fails if any of them import from `marketplace/`.
 *
 * Allowed: the single dynamic import in app.ts (`import("./marketplace/...")`),
 * which is gated behind the marketplace flag and does not couple the engine's
 * type/module graph to the marketplace.
 *
 * If this test fails, an engine file reached into the marketplace layer — move
 * the shared piece down into the engine, or invert the dependency so the
 * marketplace depends on the engine instead.
 */

const SRC_DIR = fileURLToPath(new URL("..", import.meta.url));
const MARKETPLACE_DIR = join(SRC_DIR, "marketplace");

/** Static import/export-from or top-level require targeting the marketplace folder. */
const STATIC_MARKETPLACE_IMPORT =
  /(?:import|export)\s[^;]*?from\s*["'][^"']*\/marketplace\/[^"']*["']|require\(\s*["'][^"']*\/marketplace\/[^"']*["']\s*\)/;

function collectTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      // Skip the marketplace tree itself (it's allowed to import the engine)
      // and the test tree (tests legitimately reference both sides).
      if (full === MARKETPLACE_DIR) continue;
      if (entry === "test") continue;
      out.push(...collectTsFiles(full));
    } else if (entry.endsWith(".ts") && !entry.endsWith(".d.ts")) {
      out.push(full);
    }
  }
  return out;
}

describe("open-core boundary: engine must not import marketplace", () => {
  const engineFiles = collectTsFiles(SRC_DIR);

  it("finds engine source files to scan", () => {
    expect(engineFiles.length).toBeGreaterThan(50);
  });

  it("no engine file statically imports from marketplace/", () => {
    const offenders: string[] = [];

    for (const file of engineFiles) {
      const source = readFileSync(file, "utf8");
      const rel = relative(SRC_DIR, file).replace(/\\/g, "/");

      // app.ts is the single allowed seam: a dynamic import() gated by the flag.
      const isAppSeam = rel === "app.ts";

      for (const line of source.split("\n")) {
        if (!line.includes("/marketplace/")) continue;
        // Permit the dynamic import seam in app.ts only.
        if (isAppSeam && /import\(\s*["'][^"']*\/marketplace\//.test(line)) {
          continue;
        }
        if (STATIC_MARKETPLACE_IMPORT.test(line)) {
          offenders.push(`${rel}: ${line.trim()}`);
        }
      }
    }

    expect(offenders, `engine files importing marketplace:\n${offenders.join("\n")}`).toEqual([]);
  });
});
