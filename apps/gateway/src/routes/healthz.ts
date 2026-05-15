import type { FastifyInstance } from "fastify";

export async function registerHealthzRoute(app: FastifyInstance): Promise<void> {
  app.get("/healthz", async () => {
    return {
      status: "ok"
    };
  });
}

