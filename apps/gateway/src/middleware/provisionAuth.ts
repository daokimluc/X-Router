import type { FastifyReply, FastifyRequest } from "fastify";
import type { AppConfig } from "../config.js";
import { hashApiKey } from "../utils/hash.js";

export type ProvisionAuthContext = {
  apiKeyHash: string;
};

declare module "fastify" {
  interface FastifyRequest {
    provisionAuth?: ProvisionAuthContext;
  }
}

/**
 * provision-webhook (#7) — authenticate /provision/* requests against the
 * dedicated provision API keys. Distinct from admin + client keys: a provision
 * key is never accepted elsewhere, and admin/client keys are never accepted
 * here. Snapshot is fine — provision keys are not changed at runtime.
 */
export function createProvisionAuthMiddleware(config: AppConfig) {
  const keys = new Set(config.provisionApiKeys);
  return async function provisionAuthMiddleware(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    const token = parseBearerToken(request.headers.authorization);
    if (!token || !keys.has(token)) {
      await reply.code(401).send({
        error: {
          type: "authentication_error",
          message: "Missing or invalid provision API key",
          code: "invalid_provision_api_key"
        }
      });
      return;
    }
    request.provisionAuth = { apiKeyHash: hashApiKey(token) };
  };
}

function parseBearerToken(value: string | undefined): string | null {
  if (!value) return null;
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}
