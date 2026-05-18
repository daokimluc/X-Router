/**
 * Proxy Pool Management Admin API routes
 *
 * POST   /admin/v1/proxy-pools           — Create a new proxy pool
 * GET    /admin/v1/proxy-pools           — List all proxy pools (with optional filters)
 * GET    /admin/v1/proxy-pools/:id       — Get a single proxy pool by ID
 * PATCH  /admin/v1/proxy-pools/:id       — Update a proxy pool (partial)
 * DELETE /admin/v1/proxy-pools/:id       — Delete a proxy pool (with conflict check)
 * POST   /admin/v1/proxy-pools/:id/test  — Test proxy pool connectivity
 *
 * Requirements: 1.1–1.9, 4.1, 4.2
 * @module routes/admin/proxyPools
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppConfig } from "../../config.js";
import { createAdminAuthMiddleware } from "../../middleware/adminAuth.js";
import type { ProxyPoolService } from "../../proxy/ProxyPoolService.js";

// ============================================================================
// Request Schemas
// ============================================================================

const createProxyPoolSchema = z.object({
  name: z.string().min(1, "Name is required"),
  proxyUrl: z.string().min(1, "Proxy URL is required"),
  noProxy: z.string().optional(),
  isActive: z.boolean().optional(),
  strictProxy: z.boolean().optional(),
  type: z.enum(["http", "vercel"]).optional(),
});

const updateProxyPoolSchema = z.object({
  name: z.string().min(1).optional(),
  proxyUrl: z.string().min(1).optional(),
  noProxy: z.string().optional(),
  isActive: z.boolean().optional(),
  strictProxy: z.boolean().optional(),
  type: z.enum(["http", "vercel"]).optional(),
});

const testProxyPoolSchema = z.object({
  testUrl: z.string().url().optional(),
  timeoutMs: z.number().int().positive().max(30000).optional(),
});

// ============================================================================
// Route Registration
// ============================================================================

export async function registerProxyPoolRoutes(
  app: FastifyInstance,
  config: AppConfig,
  proxyPoolService: ProxyPoolService
): Promise<void> {
  const adminAuth = createAdminAuthMiddleware(config);

  // ==========================================================================
  // POST /admin/v1/proxy-pools — Create a new proxy pool
  // Requirements: 1.1, 1.2
  // ==========================================================================
  app.post(
    "/admin/v1/proxy-pools",
    { preHandler: adminAuth },
    async (request, reply) => {
      try {
        const body = createProxyPoolSchema.parse(request.body);
        const pool = proxyPoolService.create(body);

        app.adminAuditService.record({
          action: "proxy_pool.create",
          actorKeyHash: request.adminAuth?.apiKeyHash,
          targetType: "proxy_pool",
          targetId: pool.id,
        });

        reply.code(201);
        return { data: serializePool(pool) };
      } catch (error) {
        if (error instanceof z.ZodError) {
          reply.code(400);
          return {
            error: {
              type: "validation_error",
              message: error.errors[0]?.message ?? "Invalid request",
              code: "invalid_input",
            },
          };
        }

        if (error instanceof Error && error.message.includes("required")) {
          reply.code(400);
          return {
            error: {
              type: "validation_error",
              message: error.message,
              code: error.message.toLowerCase().includes("name")
                ? "missing_name"
                : "missing_proxy_url",
            },
          };
        }

        reply.code(500);
        return {
          error: {
            type: "internal_error",
            message: error instanceof Error ? error.message : "An unexpected error occurred",
          },
        };
      }
    }
  );

  // ==========================================================================
  // GET /admin/v1/proxy-pools — List all proxy pools
  // Requirements: 1.3, 1.4
  // ==========================================================================
  app.get(
    "/admin/v1/proxy-pools",
    { preHandler: adminAuth },
    async (request, _reply) => {
      const query = request.query as {
        isActive?: string;
        includeUsage?: string;
      };

      const filters: { isActive?: boolean } = {};
      if (query.isActive === "true") filters.isActive = true;
      else if (query.isActive === "false") filters.isActive = false;

      if (query.includeUsage === "true") {
        // Get all accounts to compute usage
        const accounts = app.providerRuntimeRegistry.listAccounts();
        const accountsWithProxy = accounts.map((a) => ({
          providerSpecificData: (a.metadata as Record<string, unknown> | undefined)
            ?.providerSpecificData as { proxyPoolId?: string } | undefined,
        }));
        const pools = proxyPoolService.listWithUsage(accountsWithProxy, filters);
        return { data: pools.map(serializePoolWithUsage) };
      }

      const pools = proxyPoolService.list(filters);
      return { data: pools.map(serializePool) };
    }
  );

  // ==========================================================================
  // GET /admin/v1/proxy-pools/:id — Get a single proxy pool by ID
  // Requirements: 1.5, 1.6
  // ==========================================================================
  app.get<{ Params: { id: string } }>(
    "/admin/v1/proxy-pools/:id",
    { preHandler: adminAuth },
    async (request, reply) => {
      const { id } = request.params;
      const pool = proxyPoolService.getById(id);

      if (!pool) {
        reply.code(404);
        return {
          error: {
            type: "not_found",
            message: "Proxy pool not found",
            code: "proxy_pool_not_found",
          },
        };
      }

      return { data: serializePool(pool) };
    }
  );

  // ==========================================================================
  // PATCH /admin/v1/proxy-pools/:id — Update a proxy pool
  // Requirements: 1.7
  // ==========================================================================
  app.patch<{ Params: { id: string } }>(
    "/admin/v1/proxy-pools/:id",
    { preHandler: adminAuth },
    async (request, reply) => {
      try {
        const { id } = request.params;
        const body = updateProxyPoolSchema.parse(request.body);

        const updated = proxyPoolService.update(id, body);

        app.adminAuditService.record({
          action: "proxy_pool.update",
          actorKeyHash: request.adminAuth?.apiKeyHash,
          targetType: "proxy_pool",
          targetId: id,
        });

        return { data: serializePool(updated) };
      } catch (error) {
        if (error instanceof z.ZodError) {
          reply.code(400);
          return {
            error: {
              type: "validation_error",
              message: error.errors[0]?.message ?? "Invalid request",
              code: "invalid_input",
            },
          };
        }

        if (error instanceof Error && error.message === "Proxy pool not found") {
          reply.code(404);
          return {
            error: {
              type: "not_found",
              message: "Proxy pool not found",
              code: "proxy_pool_not_found",
            },
          };
        }

        reply.code(500);
        return {
          error: {
            type: "internal_error",
            message: error instanceof Error ? error.message : "An unexpected error occurred",
          },
        };
      }
    }
  );

  // ==========================================================================
  // DELETE /admin/v1/proxy-pools/:id — Delete a proxy pool
  // Requirements: 1.8, 1.9
  // ==========================================================================
  app.delete<{ Params: { id: string } }>(
    "/admin/v1/proxy-pools/:id",
    { preHandler: adminAuth },
    async (request, reply) => {
      try {
        const { id } = request.params;

        const pool = proxyPoolService.getById(id);
        if (!pool) {
          reply.code(404);
          return {
            error: {
              type: "not_found",
              message: "Proxy pool not found",
              code: "proxy_pool_not_found",
            },
          };
        }

        // Count bound connections
        const accounts = app.providerRuntimeRegistry.listAccounts();
        const boundConnectionCount = accounts.filter(
          (a) =>
            (a.metadata as Record<string, unknown> | undefined)?.proxyPoolId === id ||
            ((a.metadata as Record<string, unknown> | undefined)?.providerSpecificData as
              | { proxyPoolId?: string }
              | undefined)?.proxyPoolId === id
        ).length;

        proxyPoolService.delete(id, boundConnectionCount);

        app.adminAuditService.record({
          action: "proxy_pool.delete",
          actorKeyHash: request.adminAuth?.apiKeyHash,
          targetType: "proxy_pool",
          targetId: id,
        });

        return { data: { success: true } };
      } catch (error) {
        if (error instanceof Error && error.message.includes("bound to")) {
          // Extract the count from the error message
          const match = error.message.match(/(\d+) connection/);
          const count = match ? parseInt(match[1], 10) : 0;
          reply.code(409);
          return {
            error: {
              type: "conflict",
              message: "Proxy pool is currently in use",
              boundConnectionCount: count,
            },
          };
        }

        if (error instanceof Error && error.message === "Proxy pool not found") {
          reply.code(404);
          return {
            error: {
              type: "not_found",
              message: "Proxy pool not found",
              code: "proxy_pool_not_found",
            },
          };
        }

        reply.code(500);
        return {
          error: {
            type: "internal_error",
            message: error instanceof Error ? error.message : "An unexpected error occurred",
          },
        };
      }
    }
  );

  // ==========================================================================
  // POST /admin/v1/proxy-pools/:id/test — Test proxy pool connectivity
  // Requirements: 4.1, 4.2
  // ==========================================================================
  app.post<{ Params: { id: string } }>(
    "/admin/v1/proxy-pools/:id/test",
    { preHandler: adminAuth },
    async (request, reply) => {
      try {
        const { id } = request.params;

        const pool = proxyPoolService.getById(id);
        if (!pool) {
          reply.code(404);
          return {
            error: {
              type: "not_found",
              message: "Proxy pool not found",
              code: "proxy_pool_not_found",
            },
          };
        }

        // Parse optional test configuration from body
        let testOptions: { testUrl?: string; timeoutMs?: number } | undefined;
        if (request.body && typeof request.body === "object") {
          const parsed = testProxyPoolSchema.safeParse(request.body);
          if (parsed.success) {
            testOptions = parsed.data;
          }
        }

        const result = await proxyPoolService.testProxy(id, testOptions);

        app.adminAuditService.record({
          action: "proxy_pool.test",
          actorKeyHash: request.adminAuth?.apiKeyHash,
          targetType: "proxy_pool",
          targetId: id,
        });

        return { data: result };
      } catch (error) {
        if (error instanceof Error && error.message === "Proxy pool not found") {
          reply.code(404);
          return {
            error: {
              type: "not_found",
              message: "Proxy pool not found",
              code: "proxy_pool_not_found",
            },
          };
        }

        reply.code(500);
        return {
          error: {
            type: "internal_error",
            message: error instanceof Error ? error.message : "An unexpected error occurred",
          },
        };
      }
    }
  );
}

// ============================================================================
// Serialization Helpers
// ============================================================================

function serializePool(pool: {
  id: string;
  name: string;
  proxyUrl: string;
  noProxy: string;
  isActive: boolean;
  strictProxy: boolean;
  type: string;
  testStatus: string;
  lastTestedAt: Date | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: pool.id,
    name: pool.name,
    proxyUrl: pool.proxyUrl,
    noProxy: pool.noProxy,
    isActive: pool.isActive,
    strictProxy: pool.strictProxy,
    type: pool.type,
    testStatus: pool.testStatus,
    lastTestedAt: pool.lastTestedAt?.toISOString() ?? null,
    lastError: pool.lastError,
    createdAt: pool.createdAt.toISOString(),
    updatedAt: pool.updatedAt.toISOString(),
  };
}

function serializePoolWithUsage(pool: {
  id: string;
  name: string;
  proxyUrl: string;
  noProxy: string;
  isActive: boolean;
  strictProxy: boolean;
  type: string;
  testStatus: string;
  lastTestedAt: Date | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
  boundConnectionCount: number;
}) {
  return {
    ...serializePool(pool),
    boundConnectionCount: pool.boundConnectionCount,
  };
}
