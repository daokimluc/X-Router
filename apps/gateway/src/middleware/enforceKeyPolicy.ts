/**
 * enforceKeyPolicy — runs after `auth`. Centralizes per-key policy gates:
 *   1. Token expiry (401 token_expired)
 *   2. IP allowlist (403 ip_not_allowed)
 *   3. Key-level model whitelist (403 model_not_allowed_for_key)
 *   4. Team-level model whitelist (403 team_model_not_allowed)
 *   5. Spend cap (Phase 32) — daily/monthly USD cap, per-key with team fallback (429 spend_limit_exceeded)
 *   6. Marketplace policy checks (open-core seam) — wallet funds, plan buckets,
 *      PAYG decision. Registered by the marketplace layer; empty when disabled.
 *
 * Routes that pass `getModel` get model checks; routes without a body model
 * skip step 3 and 4 entirely. Routes that pass `getBody` and `modelPricingService`
 * get step 5. The legacy token-balance gate was removed in usd-wallet (#1); the
 * USD wallet gate is now a marketplace policy check (step 6).
 */

import type { FastifyReply, FastifyRequest } from "fastify";
import type { ApiKeyService } from "../services/ApiKeyService.js";
import type { TeamService } from "../services/TeamService.js";
import type { ModelPricingService } from "../services/ModelPricingService.js";
import type { SpendLedgerService } from "../services/SpendLedgerService.js";
import { ipMatches } from "../utils/ipMatch.js";

export type KeyPolicyDeps = {
  apiKeyService: ApiKeyService;
  teamService: TeamService;
  getModel?: (req: FastifyRequest) => string | undefined;
  /** Phase 32 — provide these to enable spend-cap pre-flight check. */
  modelPricingService?: ModelPricingService;
  spendLedgerService?: SpendLedgerService;
  getBody?: (req: FastifyRequest) => { messages?: Array<{ content?: unknown }>; max_tokens?: number } | undefined;
};

declare module "fastify" {
  interface FastifyRequest {
    spendReservation?: { id: string; scopes: string[] };
  }
}

function estimateUpperBoundCost(
  model: string,
  body: { messages?: Array<{ content?: unknown }>; max_tokens?: number } | undefined,
  pricing: ModelPricingService
): number {
  const messages = body?.messages ?? [];
  const inputChars = JSON.stringify(messages).length;
  const inputTokens = Math.ceil(inputChars / 4);
  const outputTokens = body?.max_tokens && body.max_tokens > 0 ? body.max_tokens : 1024;
  return pricing.calculateCost(model, inputTokens, outputTokens).totalCost;
}

export function secondsUntilNextHourUTC(): number {
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours() + 1));
  return Math.ceil((next.getTime() - now.getTime()) / 1000);
}

export function secondsUntilNextDayUTC(): number {
  const now = new Date();
  const tomorrow = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  return Math.ceil((tomorrow.getTime() - now.getTime()) / 1000);
}

export function secondsUntilNextMonthUTC(): number {
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return Math.ceil((next.getTime() - now.getTime()) / 1000);
}

/** Map a spend-cap rejection reason to the seconds-until-reset Retry-After value. */
function retryAfterForReason(reason: "hour_cap_exceeded" | "day_cap_exceeded" | "month_cap_exceeded"): number {
  if (reason === "hour_cap_exceeded") return secondsUntilNextHourUTC();
  if (reason === "day_cap_exceeded") return secondsUntilNextDayUTC();
  return secondsUntilNextMonthUTC();
}

export function createKeyPolicyEnforcer(deps: KeyPolicyDeps) {
  return async function enforceKeyPolicy(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    const apiKeyHash = request.auth?.apiKeyHash;
    if (!apiKeyHash) return;

    const record = deps.apiKeyService.findByHash(apiKeyHash);
    if (!record) return;

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

    // 3 & 4. Model whitelist
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

    // 5. Spend caps (Phase 32)
    if (
      model &&
      deps.modelPricingService &&
      deps.spendLedgerService &&
      deps.getBody
    ) {
      const team = record.teamId ? deps.teamService.get(record.teamId) : undefined;
      const dayCap = record.dailySpendLimitUsd ?? team?.dailySpendLimitUsd ?? null;
      const monthCap = record.monthlySpendLimitUsd ?? team?.monthlySpendLimitUsd ?? null;

      if (dayCap !== null || monthCap !== null) {
        const body = deps.getBody(request);
        const estimateUsd = estimateUpperBoundCost(model, body, deps.modelPricingService);

        // Reserve against the key first
        const keyScope = `key:${record.id}`;
        const keyResult = deps.spendLedgerService.reserve({
          scope: keyScope,
          estimateUsd,
          dayCap,
          monthCap
        });

        if (!keyResult.ok) {
          const retryAfter = retryAfterForReason(keyResult.reason);
          reply.header("Retry-After", String(retryAfter));
          await reply.code(429).send({
            error: {
              type: "rate_limit_exceeded",
              message: `Spend cap exceeded for this API key (${keyResult.reason}). Limit: $${keyResult.cap.toFixed(2)}, current spend: $${keyResult.spent.toFixed(4)}.`,
              code: "spend_limit_exceeded"
            }
          });
          return;
        }

        const scopes = [keyScope];

        // If team has its own caps and they're tighter, also reserve against team
        if (team && (team.dailySpendLimitUsd || team.monthlySpendLimitUsd) && record.teamId) {
          const teamScope = `team:${record.teamId}`;
          const teamResult = deps.spendLedgerService.reserve({
            scope: teamScope,
            estimateUsd,
            dayCap: team.dailySpendLimitUsd ?? null,
            monthCap: team.monthlySpendLimitUsd ?? null
          });
          if (!teamResult.ok) {
            // Roll back key reservation
            deps.spendLedgerService.release(keyResult.reservationId);
            const retryAfter = retryAfterForReason(teamResult.reason);
            reply.header("Retry-After", String(retryAfter));
            await reply.code(429).send({
              error: {
                type: "rate_limit_exceeded",
                message: `Team "${team.name}" spend cap exceeded (${teamResult.reason}).`,
                code: "spend_limit_exceeded"
              }
            });
            return;
          }
          scopes.push(teamScope);
          // Stash both reservation IDs separately so settle/release can target both
          request.spendReservation = { id: `${keyResult.reservationId}|${teamResult.reservationId}`, scopes };
        } else {
          request.spendReservation = { id: keyResult.reservationId, scopes };
        }
      }
    }

    // 6. Marketplace policy checks (open-core seam). Empty when the marketplace
    // layer is disabled. Each check may reject (wallet funds, plan buckets,
    // PAYG); the first rejection wins. Checks run last so they can build on the
    // engine gates above. On rejection, roll back any spend reservation made in
    // step 5 (the request will not proceed to settle it).
    const seam = request.server?.marketplaceSeam;
    if (seam && seam.keyPolicyChecks.length > 0) {
      for (const check of seam.keyPolicyChecks) {
        const rejection = await check({ request, reply, apiKeyHash, keyId: record.id, model, record });
        if (rejection) {
          if (request.spendReservation && deps.spendLedgerService) {
            for (const id of request.spendReservation.id.split("|")) {
              deps.spendLedgerService.release(id);
            }
            request.spendReservation = undefined;
          }
          if (rejection.headers) {
            for (const [k, v] of Object.entries(rejection.headers)) reply.header(k, v);
          }
          await reply.code(rejection.httpStatus).send(rejection.body);
          return;
        }
      }
    }
  };
}
