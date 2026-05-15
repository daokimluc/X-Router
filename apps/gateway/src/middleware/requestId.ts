import type { FastifyInstance } from "fastify";

export async function registerRequestId(app: FastifyInstance): Promise<void> {
  app.addHook("onRequest", async (request, reply) => {
    reply.header("x-request-id", request.id);
  });
}

