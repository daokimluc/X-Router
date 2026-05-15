import type { FastifyReply, FastifyRequest } from "fastify";
import type { AppConfig } from "../config.js";
import { hashApiKey } from "../utils/hash.js";

export type AdminAuthContext = {
  apiKeyHash: string;
};

declare module "fastify" {
  interface FastifyRequest {
    adminAuth?: AdminAuthContext;
  }
}

export function createAdminAuthMiddleware(config: AppConfig) {
  const validAdminKeys = new Set(config.adminApiKeys);

  return async function adminAuthMiddleware(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    const token = parseBearerToken(request.headers.authorization);

    if (!token || !validAdminKeys.has(token)) {
      await reply.code(401).send({
        error: {
          type: "authentication_error",
          message: "Missing or invalid admin API key",
          code: "invalid_admin_api_key"
        }
      });
      return;
    }

    request.adminAuth = {
      apiKeyHash: hashApiKey(token)
    };
  };
}

function parseBearerToken(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  const match = value.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

