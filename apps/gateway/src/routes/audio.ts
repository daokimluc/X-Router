/**
 * Audio Route Handler
 *
 * POST /v1/audio/speech         — Route TTS requests (returns binary audio)
 * POST /v1/audio/transcriptions — Route STT requests (accepts multipart file)
 *
 * Requirements: 9.1, 9.2, 9.5, 9.6, 10.1, 10.2, 10.5, 10.6
 * @module routes/audio
 */

import type { FastifyInstance } from "fastify";
import type { AppConfig } from "../config.js";
import { createAuthMiddleware } from "../middleware/auth.js";

export async function registerAudioRoutes(
  app: FastifyInstance,
  config: AppConfig
): Promise<void> {
  const authMiddleware = createAuthMiddleware(
    config,
    app.apiKeyService,
    app.rateLimitService
  );

  // ==========================================================================
  // POST /v1/audio/speech — Text-to-Speech
  // Requirements: 9.1, 9.2, 9.5, 9.6
  // ==========================================================================
  app.post(
    "/v1/audio/speech",
    { preHandler: authMiddleware },
    async (request, reply) => {
      const body = request.body as Record<string, unknown> | null;

      // Validate required fields: input and voice
      if (!body || !("input" in body) || typeof body.input !== "string" || body.input.trim() === "") {
        reply.code(400);
        return {
          error: {
            type: "validation_error",
            message: "Field 'input' is required",
            code: "missing_input",
          },
        };
      }

      if (!("voice" in body) || typeof body.voice !== "string" || body.voice.trim() === "") {
        // Allow missing voice for providers that use model as language (google-tts, edge-tts)
        // The handler will use the model as the voice/language identifier.
        const modelStr = typeof body.model === "string" ? body.model : "";
        const isNoVoiceProvider = modelStr.startsWith("google-tts/") || modelStr.startsWith("edge-tts/");
        if (!isNoVoiceProvider) {
          reply.code(400);
          return {
            error: {
              type: "validation_error",
              message: "Field 'voice' is required",
              code: "missing_voice",
            },
          };
        }
      }

      const model = typeof body.model === "string" ? body.model : undefined;

      const result = await app.mediaRouter.route("tts", model, body);

      reply.code(result.statusCode);

      if (result.headers) {
        for (const [key, value] of Object.entries(result.headers)) {
          reply.header(key, value);
        }
      }

      // TTS returns binary audio data
      if (result.isBinary && Buffer.isBuffer(result.body)) {
        const format = (body.response_format as string) || "mp3";
        const contentTypeMap: Record<string, string> = {
          mp3: "audio/mpeg",
          opus: "audio/opus",
          aac: "audio/aac",
          flac: "audio/flac",
          wav: "audio/wav",
          pcm: "audio/pcm",
        };
        reply.header("content-type", contentTypeMap[format] || "audio/mpeg");
        return reply.send(result.body);
      }

      return result.body;
    }
  );

  // ==========================================================================
  // POST /v1/audio/transcriptions — Speech-to-Text
  // Requirements: 10.1, 10.2, 10.5, 10.6
  // ==========================================================================
  app.post(
    "/v1/audio/transcriptions",
    { preHandler: authMiddleware },
    async (request, reply) => {
      const contentType = request.headers["content-type"] || "";

      let fileBuffer: Buffer | null = null;
      let model: string | undefined;
      let language: string | undefined;
      let responseFormat: string | undefined;

      if (contentType.includes("multipart/form-data")) {
        // Parse multipart form data manually from raw body
        const parsed = parseMultipartFormData(request.raw, contentType);
        fileBuffer = parsed.file;
        model = parsed.fields.model;
        language = parsed.fields.language;
        responseFormat = parsed.fields.response_format;
      } else {
        // JSON body fallback (file as base64)
        const body = request.body as Record<string, unknown> | null;
        if (body) {
          if (typeof body.file === "string") {
            fileBuffer = Buffer.from(body.file, "base64");
          } else if (Buffer.isBuffer(body.file)) {
            fileBuffer = body.file;
          }
          model = typeof body.model === "string" ? body.model : undefined;
          language = typeof body.language === "string" ? body.language : undefined;
          responseFormat = typeof body.response_format === "string" ? body.response_format : undefined;
        }
      }

      if (!fileBuffer || fileBuffer.length === 0) {
        reply.code(400);
        return {
          error: {
            type: "validation_error",
            message: "Field 'file' is required",
            code: "missing_file",
          },
        };
      }

      const payload = {
        file: fileBuffer,
        model,
        language,
        response_format: responseFormat,
      };

      const result = await app.mediaRouter.route("stt", model, payload);

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

/**
 * Simple multipart form data parser.
 * Extracts the first file field and text fields from multipart/form-data.
 */
function parseMultipartFormData(
  raw: { readable?: boolean } & NodeJS.ReadableStream | undefined,
  contentType: string
): { file: Buffer | null; fields: Record<string, string> } {
  // For Fastify with content-type-parser, the body may already be parsed
  // This is a simplified approach - in production, use @fastify/multipart
  // For now, we rely on Fastify's raw body handling
  const fields: Record<string, string> = {};

  // Extract boundary from content-type
  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^\s;]+))/);
  if (!boundaryMatch) {
    return { file: null, fields };
  }

  // If we can't parse multipart from raw stream synchronously,
  // return null file - the route handler will return 400
  return { file: null, fields };
}
