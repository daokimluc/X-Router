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
  // Read the keys array live on each request rather than snapshotting into a
  // Set at startup. config.adminApiKeys is mutated in place by AdminKeyService
  // when the password is changed/reset, so this picks up runtime changes
  // without a process restart.
  return async function adminAuthMiddleware(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    const token = parseBearerToken(request.headers.authorization);

    if (!token || !config.adminApiKeys.includes(token)) {
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

