import type { FastifyInstance } from "fastify";
import { redactObject } from "../utils/redaction.js";

export async function registerLogger(app: FastifyInstance): Promise<void> {
  app.addHook("onRequest", async (request) => {
    request.log.info(
      {
        requestId: request.id,
        method: request.method,
        url: request.url,
        headers: redactObject(request.headers)
      },
      "request received"
    );
  });

  app.addHook("onResponse", async (request, reply) => {
    request.log.info(
      {
        requestId: request.id,
        statusCode: reply.statusCode,
        responseTimeMs: reply.elapsedTime
      },
      "request completed"
    );
  });
}

