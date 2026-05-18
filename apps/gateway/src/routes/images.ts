/**
 * Images Route Handler
 *
 * POST /v1/images/generations   — Route image generation requests
 * POST /v1/images/understanding — Route image-to-text requests
 *
 * Requirements: 7.1, 7.2, 7.4, 7.5, 8.1, 8.2, 8.4, 8.5
 * @module routes/images
 */

import type { FastifyInstance } from "fastify";
import type { AppConfig } from "../config.js";
import { createAuthMiddleware } from "../middleware/auth.js";

export async function registerImagesRoutes(
  app: FastifyInstance,
  config: AppConfig
): Promise<void> {
  const authMiddleware = createAuthMiddleware(
    config,
    app.apiKeyService,
    app.rateLimitService
  );

  // ==========================================================================
  // POST /v1/images/generations — Image generation
  // Requirements: 7.1, 7.2, 7.4, 7.5
  // ==========================================================================
  app.post(
    "/v1/images/generations",
    { preHandler: authMiddleware },
    async (request, reply) => {
      const body = request.body as Record<string, unknown> | null;

      // Validate required field: prompt
      if (!body || !("prompt" in body) || typeof body.prompt !== "string" || body.prompt.trim() === "") {
        reply.code(400);
        return {
          error: {
            type: "validation_error",
            message: "Field 'prompt' is required",
            code: "missing_prompt",
          },
        };
      }

      const model = typeof body.model === "string" ? body.model : undefined;

      const result = await app.mediaRouter.route("image", model, body);

      reply.code(result.statusCode);

      if (result.headers) {
        for (const [key, value] of Object.entries(result.headers)) {
          reply.header(key, value);
        }
      }

      if (result.isBinary && Buffer.isBuffer(result.body)) {
        reply.header("content-type", "application/octet-stream");
        return reply.send(result.body);
      }

      return result.body;
    }
  );

  // ==========================================================================
  // POST /v1/images/understanding — Image-to-text
  // Requirements: 8.1, 8.2, 8.4, 8.5
  // ==========================================================================
  app.post(
    "/v1/images/understanding",
    { preHandler: authMiddleware },
    async (request, reply) => {
      const body = request.body as Record<string, unknown> | null;

      // Validate required fields: image and prompt
      if (!body || !("image" in body) || !body.image) {
        reply.code(400);
        return {
          error: {
            type: "validation_error",
            message: "Field 'image' is required",
            code: "missing_image",
          },
        };
      }

      if (!("prompt" in body) || typeof body.prompt !== "string" || body.prompt.trim() === "") {
        reply.code(400);
        return {
          error: {
            type: "validation_error",
            message: "Field 'prompt' is required",
            code: "missing_prompt",
          },
        };
      }

      const model = typeof body.model === "string" ? body.model : undefined;

      const result = await app.mediaRouter.route("imageToText", model, body);

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
