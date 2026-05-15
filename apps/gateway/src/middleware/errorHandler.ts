import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { NoAvailableAccountError } from "../account-pool/AccountPool.js";
import { ProviderError } from "../providers/base/ProviderErrors.js";
import { UnknownModelError } from "../router/ModelResolver.js";
import { CircuitBreakerOpenError } from "../services/CircuitBreaker.js";
import { ConcurrencyLimitError } from "../services/ConcurrencyLimiter.js";
import { ConfigRevisionNotFoundError } from "../services/ConfigRevisionService.js";

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
