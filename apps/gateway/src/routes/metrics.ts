import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AppConfig } from "../config.js";
import { HDR_BOUNDS_MS } from "../services/LatencyTrackerService.js";

export async function registerMetricsRoute(
  app: FastifyInstance,
  config: AppConfig
): Promise<void> {
  app.addHook("onResponse", async (request, reply) => {
    if (request.url === "/metrics") {
      return;
    }

    app.metricsService.recordRequest({
      method: request.method,
      route: request.routeOptions.url ?? request.url,
      statusCode: reply.statusCode,
      durationMs: reply.elapsedTime
    });
    app.requestLogService.record({
      requestId: request.id,
      method: request.method,
      route: request.routeOptions.url ?? request.url,
      statusCode: reply.statusCode,
      durationMs: reply.elapsedTime,
      apiKeyHash: request.auth?.apiKeyHash ?? request.adminAuth?.apiKeyHash
    });
  });

  app.get(
    "/metrics",
    {
      preHandler: createMetricsAuth(app, config)
    },
    async (_request, reply) => {
      reply.header("content-type", "text/plain; version=0.0.4; charset=utf-8");
      return `${app.metricsService.toPrometheus()}${renderLatencyHistograms(app)}`;
    }
  );
}

function renderLatencyHistograms(app: FastifyInstance): string {
  const exports = app.latencyTracker.exportHistograms();
  if (exports.length === 0) return "";
  const lines: string[] = [
    "# HELP gateway_request_duration_ms Request latency in milliseconds.",
    "# TYPE gateway_request_duration_ms histogram"
  ];
  for (const e of exports) {
    const labels = `provider="${escapeLabel(e.providerInstanceId)}",model="${escapeLabel(e.publicModel)}",account="${escapeLabel(e.accountId)}",outcome="${e.outcome}"`;
    for (let i = 0; i < HDR_BOUNDS_MS.length; i++) {
      lines.push(
        `gateway_request_duration_ms_bucket{${labels},le="${HDR_BOUNDS_MS[i]}"} ${e.cumulativeBuckets[i]}`
      );
    }
    lines.push(
      `gateway_request_duration_ms_bucket{${labels},le="+Inf"} ${e.cumulativeBuckets[HDR_BOUNDS_MS.length]}`
    );
    lines.push(`gateway_request_duration_ms_count{${labels}} ${e.count}`);
    lines.push(`gateway_request_duration_ms_sum{${labels}} ${e.sumMs}`);
  }
  return `${lines.join("\n")}\n`;
}

function escapeLabel(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function createMetricsAuth(app: FastifyInstance, config: AppConfig) {
  // Phase 32 — METRICS_PUBLIC env flag bypasses auth
  if (process.env.METRICS_PUBLIC === "true") {
    return async function noAuth() {
      // open
    };
  }
  return createInternalOrAdminAuth(app, config);
}

function createInternalOrAdminAuth(app: FastifyInstance, config: AppConfig) {
  const validKeys = new Set([...config.internalApiKeys, ...config.adminApiKeys]);

  return async function internalOrAdminAuth(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    const token = parseBearerToken(request.headers.authorization);

    if (!token || (!validKeys.has(token) && !app.apiKeyService.isValid(token))) {
      await reply.code(401).send({
        error: {
          type: "authentication_error",
          message: "Missing or invalid API key",
          code: "invalid_api_key"
        }
      });
    }
  };
}

function parseBearerToken(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  const match = value.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}
