/**
 * Admin settings routes — token saver, runtime toggles, webhooks, admin
 * password change/reset, and gateway state export/import/reset. Extracted
 * verbatim from routes/admin.ts as part of admin-routes-decompose.
 *
 * @module routes/admin/settings
 */
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { AppConfig } from "../../config.js";
import { createAdminAuthMiddleware } from "../../middleware/adminAuth.js";
import { DEFAULT_ADMIN_KEY } from "../../services/AdminKeyService.js";
import { recordAudit } from "./helpers.js";

export async function registerAdminSettingsRoutes(
  app: FastifyInstance,
  config: AppConfig
): Promise<void> {
  const adminAuth = createAdminAuthMiddleware(config);

  // ─── Token Saver settings ────────────────────────────────
  app.get("/admin/v1/token-saver", { preHandler: adminAuth }, async () => {
    return app.tokenSaverService.getSettings();
  });

  app.put("/admin/v1/token-saver", { preHandler: adminAuth }, async (request) => {
    const body = request.body as Record<string, unknown> ?? {};
    const updated = app.tokenSaverService.updateSettings({
      compressToolOutput: typeof body.compressToolOutput === "boolean" ? body.compressToolOutput : undefined,
      compressLlmOutput: typeof body.compressLlmOutput === "boolean" ? body.compressLlmOutput : undefined,
      llmCompressionMode: typeof body.llmCompressionMode === "string" && ["lite", "full", "ultra"].includes(body.llmCompressionMode)
        ? body.llmCompressionMode as "lite" | "full" | "ultra"
        : undefined,
    });
    recordAudit(app, request, "token_saver.update", "config", "token_saver");
    return updated;
  });

  // ─── Gateway Settings (toggles + actions) ────────────────
  app.get("/admin/v1/settings/runtime", { preHandler: adminAuth }, async () => {
    return {
      requestQueueEnabled: app.requestQueueService.isEnabled(),
      circuitBreakerEnabled: true, // always on per-instance
      autoPeristEnabled: true,
      redactionEnabled: true,
      encryptionEnabled: true,
    };
  });

  app.put("/admin/v1/settings/runtime", { preHandler: adminAuth }, async (request) => {
    const body = request.body as Record<string, unknown> ?? {};
    if (typeof body.requestQueueEnabled === "boolean") {
      app.requestQueueService.updateOptions({ enabled: body.requestQueueEnabled });
    }
    recordAudit(app, request, "settings.runtime_update", "config", "runtime");
    return {
      requestQueueEnabled: app.requestQueueService.isEnabled(),
      circuitBreakerEnabled: true,
      autoPeristEnabled: true,
      redactionEnabled: true,
      encryptionEnabled: true,
    };
  });

  // ─── Webhook Notifications ─────────────────────────────────
  app.get("/admin/v1/webhooks", { preHandler: adminAuth }, async () => {
    return app.webhookService.getConfig();
  });

  app.put("/admin/v1/webhooks", { preHandler: adminAuth }, async (request) => {
    const body = request.body as Record<string, unknown> ?? {};
    const updated = app.webhookService.updateConfig({
      enabled: typeof body.enabled === "boolean" ? body.enabled : undefined,
      url: typeof body.url === "string" ? body.url : undefined,
      events: Array.isArray(body.events) ? body.events : undefined
    });
    recordAudit(app, request, "webhook.update", "config", "webhook");
    return updated;
  });

  app.post("/admin/v1/webhooks/test", { preHandler: adminAuth }, async () => {
    await app.webhookService.notify("circuit_breaker.close", {
      message: "Test notification from AI Gateway",
      source: "admin_dashboard"
    });
    return { sent: true };
  });

  app.post("/admin/v1/settings/change-password", { preHandler: adminAuth }, async (request, reply) => {
    const body = z.object({
      currentPassword: z.string().min(1),
      newPassword: z.string().min(4)
    }).parse(request.body);
    // Verify current password matches a live admin key
    if (!config.adminApiKeys.includes(body.currentPassword)) {
      reply.code(400);
      return { success: false, message: "Current password is incorrect" };
    }
    try {
      // Persists to ~/.x-router/config.json and mutates the live key array
      // in place, so the change takes effect immediately without a restart.
      app.adminKeyService.setKey(body.newPassword);
    } catch (error) {
      reply.code(400);
      return {
        success: false,
        message: error instanceof Error ? error.message : "Failed to change password"
      };
    }
    return { success: true, message: "Password changed. Use the new password on next login." };
  });

  app.post("/admin/v1/settings/reset-password", { preHandler: adminAuth }, async () => {
    // Reset the admin key back to the default ("admin").
    app.adminKeyService.reset();
    return { success: true, message: "Password reset to default.", defaultPassword: DEFAULT_ADMIN_KEY };
  });

  app.get("/admin/v1/settings/export", { preHandler: adminAuth }, async () => {
    // Export full gateway state
    return {
      providerInstances: app.providerRuntimeRegistry.listProviderInstances(),
      accounts: app.providerRuntimeRegistry.listAccounts(),
      modelMappings: app.modelRegistry.listModelMappings(),
      routingProfiles: app.routingProfileRegistry.listRoutingProfiles(),
      apiKeys: app.apiKeyService.list(),
      teams: app.teamService.list(),
      tokenSaver: app.tokenSaverService.getSettings(),
      exportedAt: new Date().toISOString()
    };
  });

  app.post("/admin/v1/settings/import", { preHandler: adminAuth }, async (request) => {
    const body = request.body as Record<string, unknown> ?? {};
    let imported = 0;

    if (Array.isArray(body.modelMappings)) {
      for (const m of body.modelMappings) {
        try {
          app.modelRegistry.register(m as Parameters<typeof app.modelRegistry.register>[0]);
          imported++;
        } catch { /* skip duplicates */ }
      }
    }

    if (Array.isArray(body.routingProfiles)) {
      for (const p of body.routingProfiles) {
        try {
          app.routingProfileRegistry.register(p as Parameters<typeof app.routingProfileRegistry.register>[0]);
          imported++;
        } catch { /* skip duplicates */ }
      }
    }

    if (Array.isArray(body.teams)) {
      for (const t of body.teams) {
        try {
          app.teamService.create(t as Parameters<typeof app.teamService.create>[0]);
          imported++;
        } catch { /* skip duplicates */ }
      }
    }

    recordAudit(app, request, "settings.import", "config", "gateway");
    app.persistState();
    return { success: true, message: `Imported ${imported} items`, imported };
  });

  app.post("/admin/v1/settings/reset", { preHandler: adminAuth }, async (request) => {
    z.object({ confirm: z.literal("RESET") }).parse(request.body);
    // Clear all runtime state
    app.usageService.clear();
    app.requestLogService.clear();
    recordAudit(app, request, "settings.reset", "config", "gateway");
    return { success: true, message: "Usage and request logs cleared. Accounts and providers preserved." };
  });
}
