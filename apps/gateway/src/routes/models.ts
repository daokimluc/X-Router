import type { FastifyInstance } from "fastify";
import type { AppConfig } from "../config.js";
import { createAuthMiddleware } from "../middleware/auth.js";
import { createKeyPolicyEnforcer } from "../middleware/enforceKeyPolicy.js";

export async function registerModelsRoute(
  app: FastifyInstance,
  config: AppConfig
): Promise<void> {
  app.get(
    "/v1/models",
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
          teamService: app.teamService
          // No getModel — list endpoint, model whitelist not applicable
        })
      ]
    },
    async () => {
      const fixedModels = app.modelRegistry.listPublicModels().map((mapping) => ({
        id: mapping.publicModel,
        object: "model",
        owned_by: "internal-ai-gateway"
      }));
      const routingProfiles = app.routingProfileRegistry
        .listPublicProfiles()
        .map((profile) => ({
          id: profile.id,
          object: "model",
          owned_by: "internal-ai-gateway"
        }));

      return {
        object: "list",
        data: [...fixedModels, ...routingProfiles]
      };
    }
  );
}
