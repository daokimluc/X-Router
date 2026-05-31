## 1. HTTP-correctness fixes (do first, independent of the move)

- [x] 1.1 Add `instanceof ZodError → 400` to `middleware/errorHandler.ts`, emitting the field path in the message + the `{error:{type,message,code}}` envelope. (`formatZodError` helper.) Also fixed a LATENT bug: the custom error handler was registered AFTER routes + the dashboard's `app.register()`, which closed the root context for error-handler inheritance — so the envelope was effectively dead for ALL thrown errors. Moved `registerErrorHandler(app)` to BEFORE route registration in app.ts.
- [x] 1.2 Replace the `throw new Error("… not found")` handlers with a typed `NotFoundError` (new `errors/NotFoundError.ts`) mapped to 404 by the handler. Converted all 16 not-found throws in admin.ts.
- [x] 1.3 Vitest: a malformed admin body → 400 with field detail; a missing-resource admin call → 404 (3 new tests in adminRoutes.test.ts).

## 2. Shared helpers

- [x] 2.1 `parseIdParam(request)` — replaced the 26 verbatim `z.object({id:…}).parse(request.params)`. (`routes/admin/helpers.ts`.)
- [x] 2.2 `recordAudit(app, request, action, targetType, targetId)` — replaced the 59 inline audit calls. (`routes/admin/helpers.ts`.) Also added shared `findAccountPoolForAccount` here (used by accounts + testing).
- [x] 2.3 (Optional) `registerCrud` factory — SKIPPED. Per-domain modules keep their CRUD inline; the shared helpers (parseIdParam/recordAudit) already removed the bulk of the boilerplate, and a CRUD factory would obscure the per-domain validation differences.

## 3. Decompose into routes/admin/*

- [x] 3.1 Created per-domain modules (`registerAdminXRoutes(app, config)`): `catalog.ts` (model-mappings/aliases/routing-profiles/pricing), `observability.ts` (usage/aggregate/latency/spend/cache/request-logs/audit/config), `settings.ts` (token-saver/runtime/webhooks/password/export-import-reset), `keys.ts` (api-keys+teams), `instances.ts` (provider-instances CRUD/batch/by-tag/disabled/balance/sync-models-bulk/channels-quick-create), `accounts.ts` (account CRUD/credential/disable/quota/refresh), `testing.ts` (account-test/test-model/test-all/instance-test/sync-models). OAuth + provider-import stayed in `admin.ts` (`registerAdminOAuthImportRoutes`).
- [x] 3.2 `routes/admin/index.ts` registrar calls each sub-registrar; app.ts makes a single `registerAdminRoutes` call. Domain-local zod schemas + helpers moved with their domain; shared schemas/helpers in helpers.ts.
- [x] 3.3 Moved one domain at a time, verifying the admin route tests after each; no logic change in the moves (verbatim).
- [x] 3.4 Coordinated with `persistence-durability`: `saveAdminRuntimeState` was already deleted there (→ `app.persistState()`), removed once.

## 4. Verification

- [x] 4.1 Gateway `tsc` clean.
- [x] 4.2 Existing admin route tests green unchanged after the move.
- [x] 4.3 Full suite green; +3 tests for the 400/404 corrections (667 pass / 7 skip, was 664).
- [x] 4.4 `openspec validate admin-routes-decompose --strict` passes.
