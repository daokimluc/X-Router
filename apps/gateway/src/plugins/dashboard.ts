import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Stats } from "node:fs";
import fastifyStatic from "@fastify/static";
import type { FastifyInstance } from "fastify";

/**
 * Resolves the dashboard build output directory.
 *
 * Resolution order:
 * 1. DASHBOARD_DIST env var (explicit override)
 * 2. apps/dashboard/dist (monorepo: from root dist/plugins/ up to root, then into apps/)
 * 3. ../dashboard/dist (monorepo: from apps/gateway/dist/plugins/ up to apps/)
 * 4. dashboard-dist/ (legacy: sibling of dist/ at whatever level)
 */
import { existsSync } from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function resolveDashboardRoot(): string {
  // 1. Explicit env override
  if (process.env.DASHBOARD_DIST) {
    return path.resolve(process.env.DASHBOARD_DIST);
  }

  // 2. From root dist/plugins/ → root/apps/dashboard/dist/
  const rootMonorepoPath = path.resolve(__dirname, "..", "..", "apps", "dashboard", "dist");
  if (existsSync(rootMonorepoPath)) {
    return rootMonorepoPath;
  }

  // 3. From apps/gateway/dist/plugins/ → apps/dashboard/dist/
  const gatewayMonorepoPath = path.resolve(__dirname, "..", "..", "..", "dashboard", "dist");
  if (existsSync(gatewayMonorepoPath)) {
    return gatewayMonorepoPath;
  }

  // 4. Legacy: dashboard-dist/ sibling of dist/
  const legacyPath = path.resolve(__dirname, "..", "..", "dashboard-dist");
  return legacyPath;
}

const dashboardRoot = resolveDashboardRoot();

/** Matches filenames containing a content hash (8+ hex chars), e.g. main.a1b2c3d4.js */
const HASH_PATTERN = /\.[a-f0-9]{8,}\./;

/**
 * Sets appropriate Cache-Control headers based on the file being served.
 * - Hashed assets: immutable, cached for 1 year
 * - index.html: never cached (must always be fresh)
 * - Other files: short cache (1 hour)
 */
function setCacheHeaders(
  res: { setHeader(key: string, value: string): void },
  pathName: string,
  _stat: Stats
): void {
  const basename = path.basename(pathName);

  if (HASH_PATTERN.test(basename)) {
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  } else if (basename === "index.html") {
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  } else {
    res.setHeader("Cache-Control", "public, max-age=3600");
  }
}

/**
 * Static file extensions that should return 404 when the file doesn't exist,
 * rather than falling through to the SPA fallback.
 */
const STATIC_FILE_EXTENSIONS = [
  ".js",
  ".css",
  ".png",
  ".svg",
  ".ico",
  ".woff",
  ".woff2",
  ".ttf",
  ".map",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
];

export async function registerDashboardPlugin(
  app: FastifyInstance
): Promise<void> {
  await app.register(fastifyStatic, {
    root: dashboardRoot,
    prefix: "/",
    wildcard: false,
    decorateReply: true,
    setHeaders: setCacheHeaders,
  });

  // SPA fallback: serve index.html for non-static-extension paths,
  // return 404 for missing static assets.
  app.setNotFoundHandler((request, reply) => {
    const urlPath = request.url.split("?")[0]; // strip query string
    const hasStaticExtension = STATIC_FILE_EXTENSIONS.some((ext) =>
      urlPath.endsWith(ext)
    );

    if (hasStaticExtension) {
      return reply.code(404).send({ error: "Not Found" });
    }

    // SPA fallback: serve index.html with 200 for client-side routing
    return reply.code(200).sendFile("index.html");
  });
}
