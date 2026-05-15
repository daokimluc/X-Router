import type { FastifyReply, FastifyRequest } from "fastify";
import type { AppConfig } from "../config.js";
import type { ApiKeyService } from "../services/ApiKeyService.js";
import type { RateLimitService } from "../services/RateLimitService.js";
import { hashApiKey } from "../utils/hash.js";

export type AuthContext = {
  apiKeyHash: string;
};

declare module "fastify" {
  interface FastifyRequest {
    auth?: AuthContext;
  }
}

export function createAuthMiddleware(
  config: AppConfig,
  apiKeyService?: ApiKeyService,
  rateLimitService?: RateLimitService
) {
  const validKeys = new Set(config.internalApiKeys);

  return async function authMiddleware(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    const authorization = request.headers.authorization;
    const token = parseBearerToken(authorization);

    if (!token || (!validKeys.has(token) && !apiKeyService?.isValid(token))) {
      await reply.code(401).send({
        error: {
          type: "authentication_error",
          message: "Missing or invalid API key",
          code: "invalid_api_key"
        }
      });
      return;
    }

    const apiKeyHash = hashApiKey(token);
    
    // Get per-key rate limits if available
    const keyRecord = apiKeyService?.findByHash(apiKeyHash);
    const perKeyLimits = keyRecord?.rpmLimit || keyRecord?.dailyLimit
      ? { requestsPerMinute: keyRecord.rpmLimit ?? 0, dailyRequestQuota: keyRecord.dailyLimit ?? 0 }
      : undefined;
    
    const rateLimitDecision = rateLimitService?.checkAndConsume(apiKeyHash, perKeyLimits);

    if (rateLimitDecision && !rateLimitDecision.allowed) {
      await reply.code(429).send({
        error: {
          type: "rate_limit_error",
          message: rateLimitDecision.message,
          code: rateLimitDecision.code
        }
      });
      return;
    }

    request.auth = {
      apiKeyHash
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
