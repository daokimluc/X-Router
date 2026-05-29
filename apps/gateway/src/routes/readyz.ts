import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AppConfig } from "../config.js";

export async function registerReadyzRoute(
  app: FastifyInstance,
  config: AppConfig
): Promise<void> {
  app.get(
    "/readyz",
    {
      preHandler: createInternalOrAdminAuth(app, config)
    },
    async () => {
      const providerInstances = app.providerRuntimeRegistry.listProviderInstances();
      const enabledProviderInstances = providerInstances.filter(
        (providerInstance) => providerInstance.enabled
      );

      return {
        status: enabledProviderInstances.length > 0 ? "ready" : "degraded",
        checks: {
          providerRegistry: app.providerRegistry.listProviderTypes().length > 0,
          providerRuntime: enabledProviderInstances.length > 0,
          modelRegistry: app.modelRegistry.listModelMappings().length > 0
        }
      };
    }
  );
}

function createInternalOrAdminAuth(app: FastifyInstance, config: AppConfig) {
  const internalKeys = new Set(config.internalApiKeys);

  return async function internalOrAdminAuth(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    const token = parseBearerToken(request.headers.authorization);

    if (
      !token ||
      (!internalKeys.has(token) &&
        !config.adminApiKeys.includes(token) &&
        !app.apiKeyService.isValid(token))
    ) {
      await reply.code(401).send({
        error: {
          type: "authentication_error",
          message: "Missing or invalid API key",
          code: "invalid_api_key"
        }
      });
    }
  };
}

function parseBearerToken(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  const match = value.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}
