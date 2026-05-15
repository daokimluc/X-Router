import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AppConfig } from "../config.js";

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
      preHandler: createInternalOrAdminAuth(app, config)
    },
    async (_request, reply) => {
      reply.header("content-type", "text/plain; version=0.0.4; charset=utf-8");
      return app.metricsService.toPrometheus();
    }
  );
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
