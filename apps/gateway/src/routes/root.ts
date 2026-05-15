import type { FastifyInstance } from "fastify";

export async function registerRootRoute(app: FastifyInstance): Promise<void> {
  app.get("/", async () => {
    return {
      name: "internal-ai-gateway",
      status: "ok",
      endpoints: {
        health: "/healthz",
        models: "/v1/models"
      }
    };
  });
}

