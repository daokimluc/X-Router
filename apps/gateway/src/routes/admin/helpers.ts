import { z } from "zod";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { NotFoundError } from "../../errors/NotFoundError.js";
import type { AccountPool } from "../../account-pool/AccountPool.js";

const idParamSchema = z.object({ id: z.string().min(1) });

/**
 * Parse the `:id` route param (the verbatim `z.object({id:…}).parse(params)`
 * repeated across ~26 admin handlers). A malformed/missing id surfaces as a
 * ZodError → 400 via the shared error handler.
 */
export function parseIdParam(request: FastifyRequest): string {
  return idParamSchema.parse(request.params).id;
}

/**
 * Record an admin audit entry, deriving the actor from the request's admin auth.
 * Collapses the inline `app.adminAuditService.record({ …, actorKeyHash:
 * request.adminAuth?.apiKeyHash })` boilerplate (×59).
 */
export function recordAudit(
  app: FastifyInstance,
  request: FastifyRequest,
  action: string,
  targetType?: string,
  targetId?: string
): void {
  app.adminAuditService.record({
    action,
    actorKeyHash: request.adminAuth?.apiKeyHash,
    targetType,
    targetId
  });
}

/**
 * Locate the account pool that owns `accountId` across all provider instances.
 * Throws NotFoundError (→404) when no pool holds the account. Shared by the
 * accounts + testing admin domains.
 */
export function findAccountPoolForAccount(app: FastifyInstance, accountId: string): AccountPool {
  for (const providerInstance of app.providerRuntimeRegistry.listProviderInstances()) {
    const pool = app.providerRuntimeRegistry.getAccountPool(providerInstance.id);
    if (pool?.getAccount(accountId)) {
      return pool;
    }
  }
  throw new NotFoundError(`Account ${accountId} not found`);
}
