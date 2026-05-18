/**
 * Web Route Handler
 *
 * POST /v1/search    — Route web search requests
 * POST /v1/web/fetch — Route web fetch (content extraction) requests
 *
 * Requirements: 11.1, 11.3, 11.5, 11.6, 12.1, 12.2, 12.4, 12.6
 * @module routes/web
 */

import type { FastifyInstance } from "fastify";
import type { AppConfig } from "../config.js";
import { createAuthMiddleware } from "../middleware/auth.js";

export async function registerWebRoutes(
  app: FastifyInstance,
  config: AppConfig
): Promise<void> {
  const authMiddleware = createAuthMiddleware(
    config,
    app.apiKeyService,
    app.rateLimitService
  );

  // ==========================================================================
  // POST /v1/search — Web Search
  // Requirements: 11.1, 11.3, 11.5, 11.6
  // ==========================================================================
  app.post(
    "/v1/search",
    { preHandler: authMiddleware },
    async (request, reply) => {
      const body = request.body as Record<string, unknown> | null;

      // Validate required field: query
      if (!body || !("query" in body) || typeof body.query !== "string" || body.query.trim() === "") {
        reply.code(400);
        return {
          error: {
            type: "validation_error",
            message: "Field 'query' is required",
            code: "missing_query",
          },
        };
      }

      const model = typeof body.model === "string" ? body.model : undefined;

      const result = await app.mediaRouter.route("webSearch", model, body);

      reply.code(result.statusCode);

      if (result.headers) {
        for (const [key, value] of Object.entries(result.headers)) {
          reply.header(key, value);
        }
      }

      return result.body;
    }
  );

  // ==========================================================================
  // POST /v1/web/fetch — Web Fetch (content extraction)
  // Requirements: 12.1, 12.2, 12.4, 12.6
  // ==========================================================================
  app.post(
    "/v1/web/fetch",
    { preHandler: authMiddleware },
    async (request, reply) => {
      const body = request.body as Record<string, unknown> | null;

      // Validate required field: url
      if (!body || !("url" in body) || typeof body.url !== "string" || body.url.trim() === "") {
        reply.code(400);
        return {
          error: {
            type: "validation_error",
            message: "Field 'url' is required",
            code: "missing_url",
          },
        };
      }

      const model = typeof body.model === "string" ? body.model : undefined;

      const result = await app.mediaRouter.route("webFetch", model, body);

      reply.code(result.statusCode);

      if (result.headers) {
        for (const [key, value] of Object.entries(result.headers)) {
          reply.header(key, value);
        }
      }

      return result.body;
    }
  );
}
