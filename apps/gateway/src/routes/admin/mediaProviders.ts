/**
 * Media Provider Management Admin API routes
 *
 * GET   /admin/v1/media-providers                  — List provider instances with media capabilities
 * PATCH /admin/v1/provider-instances/:id/media     — Update media configuration for a provider instance
 *
 * Requirements: 5.2, 5.4, 13.1–13.7
 * @module routes/admin/mediaProviders
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppConfig } from "../../config.js";
import { createAdminAuthMiddleware } from "../../middleware/adminAuth.js";
import type { MediaKind, MediaServiceConfig } from "../../media/types.js";

// ============================================================================
// Request Schemas
// ============================================================================

const mediaModelConfigSchema = z.object({
  id: z.string().min(1),
  displayName: z.string().optional(),
  isDefault: z.boolean().optional(),
});

const mediaServiceConfigSchema = z.object({
  baseUrl: z.string().min(1),
  authType: z.enum(["apikey", "bearer", "none", "custom"]),
  authHeader: z.string().optional(),
  format: z.string().optional(),
  models: z.array(mediaModelConfigSchema),
});

const mediaKindEnum = z.enum([
  "embedding",
  "image",
  "imageToText",
  "tts",
  "stt",
  "webSearch",
  "webFetch",
]);

const updateMediaConfigSchema = z.object({
  serviceKinds: z.array(mediaKindEnum).optional(),
  mediaConfig: z
    .record(mediaKindEnum, mediaServiceConfigSchema)
    .optional(),
});

// ============================================================================
// Route Registration
// ============================================================================

export async function registerMediaProviderRoutes(
  app: FastifyInstance,
  config: AppConfig
): Promise<void> {
  const adminAuth = createAdminAuthMiddleware(config);

  // ==========================================================================
  // GET /admin/v1/media-providers — List provider instances with media capabilities
  // Requirements: 5.2, 5.4
  // ==========================================================================
  app.get(
    "/admin/v1/media-providers",
    { preHandler: adminAuth },
    async (request, _reply) => {
      const query = request.query as { kind?: string };

      const instances = app.providerRuntimeRegistry.listProviderInstances();

      // Filter to only instances that have serviceKinds defined
      let mediaProviders = instances.filter(
        (instance) =>
          instance.serviceKinds && instance.serviceKinds.length > 0
      );

      // If kind filter is provided, filter by that specific kind
      if (query.kind) {
        const kindFilter = query.kind as MediaKind;
        mediaProviders = mediaProviders.filter(
          (instance) =>
            instance.serviceKinds?.includes(kindFilter)
        );
      }

      const data = mediaProviders.map((instance) => ({
        id: instance.id,
        name: instance.name,
        type: instance.type,
        enabled: instance.enabled,
        serviceKinds: instance.serviceKinds ?? [],
        mediaConfig: instance.mediaConfig ?? {},
        createdAt: instance.createdAt.toISOString(),
        updatedAt: instance.updatedAt.toISOString(),
      }));

      return { data };
    }
  );

  // ==========================================================================
  // PATCH /admin/v1/provider-instances/:id/media — Update media configuration
  // Requirements: 13.1–13.7
  // ==========================================================================
  app.patch<{ Params: { id: string } }>(
    "/admin/v1/provider-instances/:id/media",
    { preHandler: adminAuth },
    async (request, reply) => {
      try {
        const { id } = request.params;

        const instance = app.providerRuntimeRegistry.getProviderInstance(id);
        if (!instance) {
          reply.code(404);
          return {
            error: {
              type: "not_found",
              message: "Provider instance not found",
              code: "provider_instance_not_found",
            },
          };
        }

        const body = updateMediaConfigSchema.parse(request.body);

        // Build the update patch
        const patch: Record<string, unknown> = {
          updatedAt: new Date(),
        };

        if (body.serviceKinds !== undefined) {
          // Merge with existing serviceKinds — the dashboard may PATCH only
          // the kinds it knows about, but the instance might already have
          // additional kinds set up by a different code path or by the
          // user. Union the two sets to avoid clobbering them.
          const existingKinds = instance.serviceKinds ?? [];
          const merged = Array.from(
            new Set<MediaKind>([...existingKinds, ...body.serviceKinds])
          );
          patch.serviceKinds = merged;
        }

        if (body.mediaConfig !== undefined) {
          // Merge with existing mediaConfig
          const existingMediaConfig = instance.mediaConfig ?? {};
          patch.mediaConfig = {
            ...existingMediaConfig,
            ...body.mediaConfig,
          } as Partial<Record<MediaKind, MediaServiceConfig>>;
        }

        const updated = app.providerRuntimeRegistry.updateProviderInstance(id, patch);

        app.adminAuditService.record({
          action: "provider_instance.update_media",
          actorKeyHash: request.adminAuth?.apiKeyHash,
          targetType: "provider_instance",
          targetId: id,
        });

        return {
          data: {
            id: updated.id,
            name: updated.name,
            type: updated.type,
            enabled: updated.enabled,
            serviceKinds: updated.serviceKinds ?? [],
            mediaConfig: updated.mediaConfig ?? {},
            createdAt: updated.createdAt.toISOString(),
            updatedAt: updated.updatedAt.toISOString(),
          },
        };
      } catch (error) {
        if (error instanceof z.ZodError) {
          reply.code(400);
          return {
            error: {
              type: "validation_error",
              message: error.errors[0]?.message ?? "Invalid request",
              code: "invalid_input",
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
            type: "internal_error",
            message: error instanceof Error ? error.message : "An unexpected error occurred",
          },
        };
      }
    }
  );
}
