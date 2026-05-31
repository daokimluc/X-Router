import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";
import { NoAvailableAccountError } from "../account-pool/AccountPool.js";
import { ProviderError } from "../providers/base/ProviderErrors.js";
import { UnknownModelError } from "../router/ModelResolver.js";
import { CircuitBreakerOpenError } from "../services/CircuitBreaker.js";
import { ConcurrencyLimitError } from "../services/ConcurrencyLimiter.js";
import { ConfigRevisionNotFoundError } from "../services/ConfigRevisionService.js";
import { NotFoundError } from "../errors/NotFoundError.js";

export async function registerErrorHandler(app: FastifyInstance): Promise<void> {
  app.setErrorHandler(
    async (error: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
      if (error.statusCode === 413 || error.code === "FST_ERR_CTP_BODY_TOO_LARGE") {
        await reply.code(413).send({
          error: {
            type: "request_error",
            message: "Request body too large",
            code: "payload_too_large"
          }
        });
        return;
      }

      // A1 — Zod validation failures (admin handlers use .parse() ×56) must be a
      // 400 with the offending field path, not a generic 500. Fastify also wraps
      // schema-validation errors with a `validation` array — handle both.
      if (error instanceof ZodError) {
        await reply.code(400).send({
          error: {
            type: "invalid_request_error",
            message: formatZodError(error),
            code: "invalid_request"
          }
        });
        return;
      }

      // A2 — typed not-found → 404 with the standard envelope.
      if (error instanceof NotFoundError) {
        await reply.code(404).send({
          error: {
            type: "invalid_request_error",
            message: error.message,
            code: error.code
          }
        });
        return;
      }

      if (error instanceof UnknownModelError) {
        await reply.code(404).send({
          error: {
            type: "invalid_request_error",
            message: error.message,
            code: error.code
          }
        });
        return;
      }

      if (error instanceof NoAvailableAccountError) {
        await reply.code(503).send({
          error: {
            type: "overloaded",
            message: error.message,
            code: error.code
          }
        });
        return;
      }

      if (error instanceof ConfigRevisionNotFoundError) {
        await reply.code(404).send({
          error: {
            type: "invalid_request_error",
            message: error.message,
            code: error.code
          }
        });
        return;
      }

      if (
        error instanceof CircuitBreakerOpenError ||
        error instanceof ConcurrencyLimitError
      ) {
        await reply.code(503).send({
          error: {
            type: "overloaded",
            message: error.message,
            code: error.code
          }
        });
        return;
      }

      if (error instanceof ProviderError) {
        await reply.code(error.statusCode ?? 502).send({
          error: {
            type: "provider_error",
            message: error.message,
            code: error.code
          }
        });
        return;
      }

      request.log.error(
        {
          requestId: request.id,
          err: {
            name: error.name,
            message: error.message,
            code: error.code
          }
        },
        "request failed"
      );

      await reply.code(error.statusCode ?? 500).send({
        error: {
          type: "internal_error",
          message: "Internal server error",
          code: "internal_error"
        }
      });
    }
  );
}

/** Render a ZodError as a compact, field-pathed message for the 400 envelope. */
function formatZodError(error: ZodError): string {
  const detail = error.issues
    .map((issue) => {
      const path = issue.path.join(".");
      return path ? `${path}: ${issue.message}` : issue.message;
    })
    .join("; ");
  return detail.length > 0 ? `Invalid request: ${detail}` : "Invalid request";
}
