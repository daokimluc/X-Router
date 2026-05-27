/**
 * enforceKeyPolicy — runs after `auth`. Centralizes per-key policy gates:
 *   1. Token expiry (401 token_expired)
 *   2. IP allowlist (403 ip_not_allowed)
 *   3. Key-level model whitelist (403 model_not_allowed_for_key)
 *   4. Team-level model whitelist (403 team_model_not_allowed)
 *   5. Balance exhaustion (402 balance_exhausted)
 *
 * Routes that pass `getModel` get model checks; routes without a body model
 * skip step 3 and 4 entirely.
 */

import type { FastifyReply, FastifyRequest } from "fastify";
import type { ApiKeyService } from "../services/ApiKeyService.js";
import type { TeamService } from "../services/TeamService.js";
import { ipMatches } from "../utils/ipMatch.js";

export type KeyPolicyDeps = {
  apiKeyService: ApiKeyService;
  teamService: TeamService;
  getModel?: (req: FastifyRequest) => string | undefined;
};

export function createKeyPolicyEnforcer(deps: KeyPolicyDeps) {
  return async function enforceKeyPolicy(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    const apiKeyHash = request.auth?.apiKeyHash;
    if (!apiKeyHash) return; // auth middleware did not run or used a static key

    const record = deps.apiKeyService.findByHash(apiKeyHash);
    if (!record) return; // static config-key path: no per-key policy applies

    // 1. Expiry
    if (deps.apiKeyService.isExpired(record)) {
      await reply.code(401).send({
        error: {
          type: "authentication_error",
          message: "API key has expired",
          code: "token_expired"
        }
      });
      return;
    }

    // 2. IP allowlist
    if (record.allowedIps && record.allowedIps.length > 0) {
      if (!ipMatches(request.ip, record.allowedIps)) {
        await reply.code(403).send({
          error: {
            type: "forbidden",
            message: `Client IP ${request.ip} is not in this key's allowlist`,
            code: "ip_not_allowed"
          }
        });
        return;
      }
    }

    // 3 & 4. Model whitelist (key-level + team-level)
    const model = deps.getModel?.(request);
    if (model) {
      if (record.allowedModels && record.allowedModels.length > 0) {
        if (!record.allowedModels.includes(model)) {
          await reply.code(403).send({
            error: {
              type: "forbidden",
              message: `Model "${model}" is not allowed for this API key. Allowed: ${record.allowedModels.join(", ")}`,
              code: "model_not_allowed_for_key"
            }
          });
          return;
        }
      }

      if (record.teamId) {
        const team = deps.teamService.get(record.teamId);
        if (team && team.enabled && team.allowedModels && team.allowedModels.length > 0) {
          if (!team.allowedModels.includes(model)) {
            await reply.code(403).send({
              error: {
                type: "forbidden",
                message: `Team "${team.name}" does not allow model "${model}". Allowed: ${team.allowedModels.join(", ")}`,
                code: "team_model_not_allowed"
              }
            });
            return;
          }
        }
      }
    }

    // 5. Balance
    if (!deps.apiKeyService.hasBalance(apiKeyHash)) {
      await reply.code(402).send({
        error: {
          type: "insufficient_balance",
          message: "API key token balance exhausted. Contact admin for top-up.",
          code: "balance_exhausted"
        }
      });
      return;
    }
  };
}
