/**
 * Embeddings Route Handler
 *
 * POST /v1/embeddings — Route embedding requests to available providers
 *
 * Requirements: 6.1, 6.2, 6.4, 6.5
 * @module routes/embeddings
 */

import type { FastifyInstance } from "fastify";
import type { AppConfig } from "../config.js";
import { createAuthMiddleware } from "../middleware/auth.js";
import { createKeyPolicyEnforcer } from "../middleware/enforceKeyPolicy.js";

export async function registerEmbeddingsRoutes(
  app: FastifyInstance,
  config: AppConfig
): Promise<void> {
  app.post(
    "/v1/embeddings",
    {
      preHandler: [
        createAuthMiddleware(
          config,
          app.apiKeyService,
          app.rateLimitService,
          app.teamService
        ),
        createKeyPolicyEnforcer({
          apiKeyService: app.apiKeyService,
          teamService: app.teamService,
          getModel: (req) => {
            const body = req.body as { model?: string } | null;
            return body?.model;
          }
        })
      ],
    },
    async (request, reply) => {
      const body = request.body as Record<string, unknown> | null;

      // Validate required field: input
      if (!body || !("input" in body) || body.input === undefined || body.input === null || body.input === "") {
        reply.code(400);
        return {
          error: {
            type: "validation_error",
            message: "Field 'input' is required",
            code: "missing_input",
          },
        };
      }

      const model = typeof body.model === "string" ? body.model : undefined;

      const result = await app.mediaRouter.route("embedding", model, body);

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
