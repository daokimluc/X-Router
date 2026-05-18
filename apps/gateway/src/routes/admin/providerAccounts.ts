/**
 * Provider Account Management API routes (multi-provider integration)
 *
 * POST   /admin/provider-accounts         — Create account, run health check, return 201
 * GET    /admin/provider-accounts         — List all accounts (no credentials in response)
 * PATCH  /admin/provider-accounts/:accountId — Update account, re-run health check if credentials changed
 * DELETE /admin/provider-accounts/:accountId — Delete account, return 204
 *
 * Validates:
 * - Provider type exists in registry (400 if not)
 * - Required fields per credentialSchema (400 with field-level errors)
 *
 * Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6
 * @module routes/admin/providerAccounts
 */

import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppConfig } from "../../config.js";
import { createAdminAuthMiddleware } from "../../middleware/adminAuth.js";
import type { ProviderAccount } from "../../providers/base/ProviderAccount.js";
import type { ProviderTypeDefinition } from "../../providers/registry/ProviderTypeDefinition.js";
import type { ProviderHealth } from "../../providers/base/types.js";

// ============================================================================
// Request Schemas
// ============================================================================

const createAccountSchema = z.object({
  providerType: z.string().min(1),
  displayName: z.string().min(1),
  credentials: z.record(z.unknown()).default({}),
  config: z.record(z.unknown()).default({}),
  enabled: z.boolean().default(true),
  weight: z.number().int().positive().default(1),
  maxConcurrency: z.number().int().positive().default(3),
  allowedModels: z.array(z.string().min(1)).optional(),
  tags: z.array(z.string().min(1)).optional(),
  owner: z.string().min(1).optional(),
});

const patchAccountSchema = z.object({
  displayName: z.string().min(1).optional(),
  credentials: z.record(z.unknown()).optional(),
  config: z.record(z.unknown()).optional(),
  enabled: z.boolean().optional(),
  weight: z.number().int().positive().optional(),
  maxConcurrency: z.number().int().positive().optional(),
  allowedModels: z.array(z.string().min(1)).optional(),
  tags: z.array(z.string().min(1)).optional(),
  owner: z.string().min(1).optional(),
});

// ============================================================================
// Types
// ============================================================================

type FieldError = {
  field: string;
  message: string;
};

type ProviderAccountResponse = {
  accountId: string;
  providerType: string;
  displayName: string;
  status: string;
  enabled: boolean;
  weight: number;
  healthCheck?: {
    status: ProviderHealth["status"];
    message?: string;
  };
  config: Record<string, unknown>;
  allowedModels?: string[];
  tags?: string[];
  owner?: string;
  createdAt: string;
  updatedAt: string;
};

// ============================================================================
// Helpers
// ============================================================================

/**
 * Validate that a provider type exists in the registry.
 * Returns the definition or throws with available types.
 */
function getProviderDefinitionOrThrow(
  app: FastifyInstance,
  providerType: string
): ProviderTypeDefinition {
  const definitions = app.providerRegistry.listProviderTypes();
  const definition = definitions.find((d) => d.type === providerType);
  if (!definition) {
    const validTypes = definitions.map((d) => d.type);
    const error = new Error(
      `Provider type "${providerType}" not found in registry. Valid types: ${validTypes.join(", ")}`
    );
    (error as Error & { statusCode: number }).statusCode = 400;
    (error as Error & { code: string }).code = "invalid_provider_type";
    (error as Error & { validTypes: string[] }).validTypes = validTypes;
    throw error;
  }
  return definition;
}

/**
 * Validate credentials against the provider's credentialSchema.
 * Returns array of field-level errors (empty if valid).
 */
function validateCredentialSchema(
  definition: ProviderTypeDefinition,
  credentials: Record<string, unknown>
): FieldError[] {
  const schema = definition.credentialSchema;
  if (!schema || Object.keys(schema).length === 0) {
    return [];
  }

  const errors: FieldError[] = [];

  // JSON Schema-style validation for required fields and types
  const properties = (schema as { properties?: Record<string, unknown> }).properties;
  const required = (schema as { required?: string[] }).required ?? [];

  if (properties) {
    for (const field of required) {
      const value = credentials[field];
      if (value === undefined || value === null || value === "") {
        const prop = properties[field] as { description?: string } | undefined;
        errors.push({
          field,
          message: prop?.description
            ? `${field} is required: ${prop.description}`
            : `${field} is required`,
        });
      }
    }

    // Type validation for provided fields
    for (const [field, propSchema] of Object.entries(properties)) {
      const value = credentials[field];
      if (value === undefined || value === null) continue;

      const prop = propSchema as { type?: string; minLength?: number; maxLength?: number };
      if (prop.type === "string" && typeof value !== "string") {
        errors.push({ field, message: `${field} must be a string` });
      } else if (prop.type === "number" && typeof value !== "number") {
        errors.push({ field, message: `${field} must be a number` });
      } else if (prop.type === "string" && typeof value === "string") {
        if (prop.minLength && value.length < prop.minLength) {
          errors.push({ field, message: `${field} must be at least ${prop.minLength} characters` });
        }
        if (prop.maxLength && value.length > prop.maxLength) {
          errors.push({ field, message: `${field} must be at most ${prop.maxLength} characters` });
        }
      }
    }
  }

  return errors;
}

/**
 * Run health check for a provider account using the adapter.
 */
async function runHealthCheck(
  app: FastifyInstance,
  providerType: string,
  credentials: Record<string, unknown>,
  config: Record<string, unknown>
): Promise<ProviderHealth> {
  try {
    const adapter = app.providerRegistry.getAdapter(providerType);

    // Find or create a temporary provider instance context for health check
    const instances = app.providerRuntimeRegistry.listProviderInstances();
    const instance = instances.find((i) => i.type === providerType);

    // Build a context for the health check
    const providerInstance = instance ?? {
      id: `temp_${providerType}`,
      type: providerType,
      name: providerType,
      enabled: true,
      config,
      defaultTimeoutMs: 30000,
      maxRetries: 0,
      cooldownMs: 60000,
      accountSelectionStrategy: "round_robin" as const,
      maxConcurrentRequests: 20,
      maxConcurrentRequestsPerAccount: 3,
      circuitBreaker: {
        enabled: false,
        failureThreshold: 5,
        cooldownMs: 60000,
        halfOpenMaxRequests: 1,
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // Merge config into providerInstance config for health check
    const contextInstance = {
      ...providerInstance,
      config: { ...providerInstance.config, ...config },
    };

    const result = await adapter.healthCheck({
      providerInstance: contextInstance,
      credentialPayload: credentials,
    });

    return result;
  } catch (error) {
    return {
      status: "down",
      message: error instanceof Error ? error.message : "Health check failed",
    };
  }
}

/**
 * Build a sanitized account response (no credentials).
 */
function toAccountResponse(
  account: ProviderAccount,
  healthCheck?: ProviderHealth
): ProviderAccountResponse {
  return {
    accountId: account.id,
    providerType: account.providerType,
    displayName: account.displayName,
    status: account.status,
    enabled: account.status === "active",
    weight: account.weight,
    ...(healthCheck && {
      healthCheck: {
        status: healthCheck.status,
        message: healthCheck.message,
      },
    }),
    config: (account.metadata?.config as Record<string, unknown>) ?? {},
    allowedModels: account.allowedModels,
    tags: account.tags,
    owner: account.owner,
    createdAt: account.createdAt.toISOString(),
    updatedAt: account.updatedAt.toISOString(),
  };
}

/**
 * Find the account pool containing a specific account ID.
 */
function findAccountPoolForAccount(app: FastifyInstance, accountId: string) {
  const instances = app.providerRuntimeRegistry.listProviderInstances();
  for (const instance of instances) {
    const pool = app.providerRuntimeRegistry.getAccountPool(instance.id);
    if (pool?.getAccount(accountId)) {
      return { pool, instance };
    }
  }
  return null;
}

// ============================================================================
// Route Registration
// ============================================================================

export async function registerProviderAccountManagementRoutes(
  app: FastifyInstance,
  config: AppConfig
): Promise<void> {
  const adminAuth = createAdminAuthMiddleware(config);

  // ==========================================================================
  // POST /admin/provider-accounts — Create account with health check
  // Requirements: 6.1, 6.5, 6.6
  // ==========================================================================
  app.post(
    "/admin/provider-accounts",
    { preHandler: adminAuth },
    async (request, reply) => {
      try {
        const body = createAccountSchema.parse(request.body);

        // Validate provider type exists in registry (Req 6.5)
        const definition = getProviderDefinitionOrThrow(app, body.providerType);

        // Validate required fields per credentialSchema (Req 6.6)
        const credentialErrors = validateCredentialSchema(definition, body.credentials);
        if (credentialErrors.length > 0) {
          reply.code(400);
          return {
            error: {
              code: "credential_validation_failed",
              message: "Required credential fields are missing or invalid",
              details: credentialErrors,
            },
          };
        }

        // Find provider instance for this type
        const instances = app.providerRuntimeRegistry.listProviderInstances();
        let instance = instances.find((i) => i.type === body.providerType);

        // Auto-create provider instance if none exists
        if (!instance) {
          const { AccountPool } = await import("../../account-pool/AccountPool.js");
          const { createAccountSelectionStrategy } = await import(
            "../../account-pool/strategyFactory.js"
          );

          const now = new Date();
          instance = {
            id: `instance_${body.providerType}`,
            type: body.providerType,
            name: definition.displayName,
            enabled: true,
            baseUrl: definition.defaultBaseUrl,
            config: body.config,
            defaultTimeoutMs: 30000,
            maxRetries: 1,
            cooldownMs: 60000,
            accountSelectionStrategy: "round_robin" as const,
            maxConcurrentRequests: 20,
            maxConcurrentRequestsPerAccount: 3,
            circuitBreaker: {
              enabled: true,
              failureThreshold: 5,
              cooldownMs: 60000,
              halfOpenMaxRequests: 1,
            },
            createdAt: now,
            updatedAt: now,
          };

          app.providerRuntimeRegistry.registerProviderInstance(instance);
          app.providerRuntimeRegistry.registerAccountPool(
            instance.id,
            new AccountPool([], createAccountSelectionStrategy("round_robin"))
          );
        }

        const accountPool = app.providerRuntimeRegistry.getAccountPool(instance.id);
        if (!accountPool) {
          reply.code(500);
          return {
            error: {
              code: "internal_error",
              message: "Account pool not found for provider instance",
            },
          };
        }

        // Run health check (Req 6.1)
        const healthResult = await runHealthCheck(
          app,
          body.providerType,
          body.credentials,
          { ...instance.config, ...body.config }
        );

        // Create account
        const accountId = `account_${randomUUID()}`;
        const credentialRef = `secret_${accountId}`;
        const now = new Date();

        const account: ProviderAccount = {
          id: accountId,
          providerInstanceId: instance.id,
          providerType: body.providerType,
          displayName: body.displayName,
          status: healthResult.status === "down" ? "disabled" : "active",
          weight: body.weight,
          maxConcurrency: body.maxConcurrency,
          credentialRef,
          allowedModels: body.allowedModels,
          tags: body.tags,
          owner: body.owner,
          runtime: {
            activeRequests: 0,
            totalRequests: 0,
            failedRequests: 0,
            consecutiveFailures: 0,
          },
          metadata: {
            config: body.config,
            healthCheckStatus: healthResult.status,
            healthCheckMessage: healthResult.message,
          },
          createdAt: now,
          updatedAt: now,
        };

        // Store credentials
        app.secretService.addCredentialPayload({
          id: credentialRef,
          accountId,
          credentialType: "api_key",
          credentialPayload: body.credentials,
        });

        // Add to pool
        accountPool.addAccount(account);

        // Audit
        app.adminAuditService.record({
          action: "provider_account.create",
          actorKeyHash: request.adminAuth?.apiKeyHash,
          targetType: "account",
          targetId: accountId,
        });

        // Persist
        await app.persistenceService.save(createPersistedState(app));

        reply.code(201);
        return { data: toAccountResponse(account, healthResult) };
      } catch (error) {
        if (error instanceof z.ZodError) {
          reply.code(400);
          return {
            error: {
              code: "invalid_request_payload",
              message: "Invalid request payload",
              details: error.errors.map((e) => ({
                field: e.path.join("."),
                message: e.message,
              })),
            },
          };
        }

        if (
          error instanceof Error &&
          "statusCode" in error &&
          (error as Error & { statusCode: number }).statusCode === 400
        ) {
          reply.code(400);
          return {
            error: {
              code: (error as Error & { code?: string }).code ?? "bad_request",
              message: error.message,
              ...((error as Error & { validTypes?: string[] }).validTypes && {
                validTypes: (error as Error & { validTypes?: string[] }).validTypes,
              }),
            },
          };
        }

        reply.code(500);
        return {
          error: {
            code: "internal_error",
            message: error instanceof Error ? error.message : "An unexpected error occurred",
          },
        };
      }
    }
  );

  // ==========================================================================
  // GET /admin/provider-accounts — List all accounts (no credentials)
  // Requirements: 6.2
  // ==========================================================================
  app.get(
    "/admin/provider-accounts",
    { preHandler: adminAuth },
    async (_request, reply) => {
      try {
        const allAccounts = app.providerRuntimeRegistry.listAccounts();

        const response = allAccounts.map((account) => toAccountResponse(account));

        return { data: response };
      } catch (error) {
        reply.code(500);
        return {
          error: {
            code: "internal_error",
            message: error instanceof Error ? error.message : "An unexpected error occurred",
          },
        };
      }
    }
  );

  // ==========================================================================
  // PATCH /admin/provider-accounts/:accountId — Update account
  // Requirements: 6.3
  // ==========================================================================
  app.patch<{ Params: { accountId: string } }>(
    "/admin/provider-accounts/:accountId",
    { preHandler: adminAuth },
    async (request, reply) => {
      try {
        const { accountId } = z
          .object({ accountId: z.string().min(1) })
          .parse(request.params);

        const body = patchAccountSchema.parse(request.body);

        // Find account
        const found = findAccountPoolForAccount(app, accountId);
        if (!found) {
          reply.code(404);
          return {
            error: {
              code: "account_not_found",
              message: `Account "${accountId}" not found`,
            },
          };
        }

        const { pool, instance } = found;
        const account = pool.getAccount(accountId);
        if (!account) {
          reply.code(404);
          return {
            error: {
              code: "account_not_found",
              message: `Account "${accountId}" not found`,
            },
          };
        }

        // If credentials changed, validate and re-run health check
        let healthResult: ProviderHealth | undefined;
        if (body.credentials) {
          // Validate provider type
          const definition = getProviderDefinitionOrThrow(app, account.providerType);

          // Validate credential schema
          const credentialErrors = validateCredentialSchema(definition, body.credentials);
          if (credentialErrors.length > 0) {
            reply.code(400);
            return {
              error: {
                code: "credential_validation_failed",
                message: "Required credential fields are missing or invalid",
                details: credentialErrors,
              },
            };
          }

          // Update credentials in secret service
          const secret = app.secretService.getSecretForAccount(accountId);
          if (secret) {
            app.secretService.updateSecretPayload(secret.id, body.credentials);
          } else {
            const credentialRef = account.credentialRef || `secret_${accountId}`;
            app.secretService.addCredentialPayload({
              id: credentialRef,
              accountId,
              credentialType: "api_key",
              credentialPayload: body.credentials,
            });
          }

          // Re-run health check
          const accountConfig = (account.metadata?.config as Record<string, unknown>) ?? {};
          healthResult = await runHealthCheck(
            app,
            account.providerType,
            body.credentials,
            { ...instance.config, ...accountConfig, ...(body.config ?? {}) }
          );
        }

        // Build update patch
        const updatePatch: Partial<ProviderAccount> = {
          updatedAt: new Date(),
        };

        if (body.displayName !== undefined) updatePatch.displayName = body.displayName;
        if (body.weight !== undefined) updatePatch.weight = body.weight;
        if (body.maxConcurrency !== undefined) updatePatch.maxConcurrency = body.maxConcurrency;
        if (body.allowedModels !== undefined) updatePatch.allowedModels = body.allowedModels;
        if (body.tags !== undefined) updatePatch.tags = body.tags;
        if (body.owner !== undefined) updatePatch.owner = body.owner;
        if (body.enabled !== undefined) {
          updatePatch.status = body.enabled ? "active" : "disabled";
        }

        // Update metadata with config and health check info
        const existingMetadata = (account.metadata ?? {}) as Record<string, unknown>;
        if (body.config) {
          existingMetadata.config = { ...(existingMetadata.config as Record<string, unknown> ?? {}), ...body.config };
        }
        if (healthResult) {
          existingMetadata.healthCheckStatus = healthResult.status;
          existingMetadata.healthCheckMessage = healthResult.message;
          // If health check failed, mark as disabled
          if (healthResult.status === "down") {
            updatePatch.status = "disabled";
          }
        }
        updatePatch.metadata = existingMetadata;

        // Apply update
        const updated = pool.updateAccount(accountId, updatePatch);

        // Audit
        app.adminAuditService.record({
          action: "provider_account.update",
          actorKeyHash: request.adminAuth?.apiKeyHash,
          targetType: "account",
          targetId: accountId,
        });

        // Persist
        await app.persistenceService.save(createPersistedState(app));

        return { data: toAccountResponse(updated, healthResult) };
      } catch (error) {
        if (error instanceof z.ZodError) {
          reply.code(400);
          return {
            error: {
              code: "invalid_request_payload",
              message: "Invalid request payload",
              details: error.errors.map((e) => ({
                field: e.path.join("."),
                message: e.message,
              })),
            },
          };
        }

        if (
          error instanceof Error &&
          "statusCode" in error &&
          (error as Error & { statusCode: number }).statusCode === 400
        ) {
          reply.code(400);
          return {
            error: {
              code: (error as Error & { code?: string }).code ?? "bad_request",
              message: error.message,
            },
          };
        }

        reply.code(500);
        return {
          error: {
            code: "internal_error",
            message: error instanceof Error ? error.message : "An unexpected error occurred",
          },
        };
      }
    }
  );

  // ==========================================================================
  // DELETE /admin/provider-accounts/:accountId — Delete account
  // Requirements: 6.4
  // ==========================================================================
  app.delete<{ Params: { accountId: string } }>(
    "/admin/provider-accounts/:accountId",
    { preHandler: adminAuth },
    async (request, reply) => {
      try {
        const { accountId } = z
          .object({ accountId: z.string().min(1) })
          .parse(request.params);

        // Find account
        const found = findAccountPoolForAccount(app, accountId);
        if (!found) {
          reply.code(404);
          return {
            error: {
              code: "account_not_found",
              message: `Account "${accountId}" not found`,
            },
          };
        }

        const { pool } = found;

        // Remove account from pool
        pool.removeAccount(accountId);

        // Delete secret
        app.secretService.deleteSecretForAccount(accountId);

        // Audit
        app.adminAuditService.record({
          action: "provider_account.delete",
          actorKeyHash: request.adminAuth?.apiKeyHash,
          targetType: "account",
          targetId: accountId,
        });

        // Persist
        await app.persistenceService.save(createPersistedState(app));

        reply.code(204);
        return;
      } catch (error) {
        if (error instanceof z.ZodError) {
          reply.code(400);
          return {
            error: {
              code: "invalid_request_payload",
              message: "Invalid request payload",
              details: error.errors.map((e) => ({
                field: e.path.join("."),
                message: e.message,
              })),
            },
          };
        }

        reply.code(500);
        return {
          error: {
            code: "internal_error",
            message: error instanceof Error ? error.message : "An unexpected error occurred",
          },
        };
      }
    }
  );

  // ==========================================================================
  // POST /admin/v1/accounts/:accountId/priority — Move account priority up/down
  // ==========================================================================
  app.post<{ Params: { accountId: string } }>(
    "/admin/v1/accounts/:accountId/priority",
    { preHandler: adminAuth },
    async (request, reply) => {
      try {
        const { accountId } = request.params;
        const { direction } = z
          .object({ direction: z.enum(["up", "down"]) })
          .parse(request.body);

        const found = findAccountPoolForAccount(app, accountId);
        if (!found) {
          reply.code(404);
          return { error: { code: "account_not_found", message: `Account "${accountId}" not found` } };
        }

        const { pool } = found;
        const accounts = pool.listAccounts();
        const currentIndex = accounts.findIndex((a) => a.id === accountId);

        if (currentIndex < 0) {
          reply.code(404);
          return { error: { code: "account_not_found", message: `Account "${accountId}" not found in pool` } };
        }

        const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
        if (targetIndex < 0 || targetIndex >= accounts.length) {
          return { data: { moved: false, message: "Already at boundary" } };
        }

        // Swap priorities by swapping weights
        const currentAccount = accounts[currentIndex];
        const targetAccount = accounts[targetIndex];
        const currentWeight = currentAccount.weight;
        const targetWeight = targetAccount.weight;

        pool.updateAccount(currentAccount.id, { weight: targetWeight });
        pool.updateAccount(targetAccount.id, { weight: currentWeight });

        await app.persistenceService.save(createPersistedState(app));

        return { data: { moved: true, newIndex: targetIndex } };
      } catch (error) {
        if (error instanceof z.ZodError) {
          reply.code(400);
          return { error: { code: "invalid_request", message: "direction must be 'up' or 'down'" } };
        }
        reply.code(500);
        return { error: { code: "internal_error", message: error instanceof Error ? error.message : "Unknown error" } };
      }
    }
  );
}

// ============================================================================
// Helper to create persisted state
// ============================================================================

function createPersistedState(app: FastifyInstance) {
  return {
    providerInstances: app.providerRuntimeRegistry.listProviderInstances(),
    accounts: app.providerRuntimeRegistry.listAccounts(),
    modelMappings: app.modelRegistry.listModelMappings(),
    routingProfiles: app.routingProfileRegistry.listRoutingProfiles(),
    apiKeys: app.apiKeyService.list(),
    secrets: app.secretService.listSecrets(),
    config: {
      current: app.configRevisionService.getCurrent(),
      revisions: app.configRevisionService.listRevisions(),
    },
  };
}
