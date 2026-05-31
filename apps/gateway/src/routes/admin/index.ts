/**
 * Admin routes registrar. Wires every per-domain admin module under one entry
 * so app.ts makes a single call. The decomposition (admin-routes-decompose)
 * split the former 4000-line routes/admin.ts into cohesive domain modules:
 *
 *  - oauth + provider import  → routes/admin.ts (registerAdminOAuthImportRoutes)
 *  - provider instances       → instances.ts
 *  - accounts                 → accounts.ts
 *  - testing                  → testing.ts
 *  - catalog (mappings/...)   → catalog.ts
 *  - api-keys + teams         → keys.ts
 *  - settings                 → settings.ts
 *  - observability + config   → observability.ts
 *
 * Each module is behavior-preserving and registers its routes directly on `app`
 * with the same paths, admin-key auth, and response contracts as before.
 *
 * @module routes/admin
 */
import type { FastifyInstance } from "fastify";
import type { AppConfig } from "../../config.js";
import { registerAdminOAuthImportRoutes } from "../admin.js";
import { registerAdminInstanceRoutes } from "./instances.js";
import { registerAdminAccountRoutes } from "./accounts.js";
import { registerAdminTestingRoutes } from "./testing.js";
import { registerAdminCatalogRoutes } from "./catalog.js";
import { registerAdminKeysRoutes } from "./keys.js";
import { registerAdminSettingsRoutes } from "./settings.js";
import { registerAdminObservabilityRoutes } from "./observability.js";

export async function registerAdminRoutes(
  app: FastifyInstance,
  config: AppConfig
): Promise<void> {
  await registerAdminOAuthImportRoutes(app, config);
  await registerAdminInstanceRoutes(app, config);
  await registerAdminAccountRoutes(app, config);
  await registerAdminTestingRoutes(app, config);
  await registerAdminCatalogRoutes(app, config);
  await registerAdminKeysRoutes(app, config);
  await registerAdminSettingsRoutes(app, config);
  await registerAdminObservabilityRoutes(app, config);
}
