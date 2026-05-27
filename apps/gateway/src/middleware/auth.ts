import type { FastifyReply, FastifyRequest } from "fastify";
import type { AppConfig } from "../config.js";
import type { ApiKeyService } from "../services/ApiKeyService.js";
import type { RateLimitService, PerKeyLimits } from "../services/RateLimitService.js";
import type { TeamService } from "../services/TeamService.js";
import { hashApiKey } from "../utils/hash.js";

export type AuthContext = {
  apiKeyHash: string;
  teamId?: string;
};

declare module "fastify" {
  interface FastifyRequest {
    auth?: AuthContext;
  }
}

export function createAuthMiddleware(
  config: AppConfig,
  apiKeyService?: ApiKeyService,
  rateLimitService?: RateLimitService,
  teamService?: TeamService
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

    const keyRecord = apiKeyService?.findByHash(apiKeyHash);
    const team = keyRecord?.teamId
      ? teamService?.get(keyRecord.teamId)
      : undefined;

    if (team && team.enabled === false) {
      await reply.code(403).send({
        error: {
          type: "forbidden",
          message: `Team ${team.id} is disabled`,
          code: "team_disabled"
        }
      });
      return;
    }

    // Effective limits = strictest of (per-key, team).
    const perKeyLimits = mergeLimits(
      {
        requestsPerMinute: keyRecord?.rpmLimit,
        dailyRequestQuota: keyRecord?.dailyLimit,
        dailyTokenQuota: keyRecord?.dailyTokenLimit
      },
      {
        requestsPerMinute: team?.rpmLimit,
        dailyRequestQuota: team?.dailyLimit
      }
    );

    const rateLimitDecision = rateLimitService?.checkAndConsume(
      apiKeyHash,
      perKeyLimits
    );

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
      apiKeyHash,
      teamId: keyRecord?.teamId
    };
  };
}

function mergeLimits(
  a: PerKeyLimits,
  b: PerKeyLimits
): PerKeyLimits | undefined {
  const out: PerKeyLimits = {};
  for (const k of [
    "requestsPerMinute",
    "dailyRequestQuota",
    "dailyTokenQuota"
  ] as const) {
    const av = a[k];
    const bv = b[k];
    if (av && bv) out[k] = Math.min(av, bv);
    else if (av) out[k] = av;
    else if (bv) out[k] = bv;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function parseBearerToken(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  const match = value.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}
