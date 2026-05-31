## Why

`routes/admin.ts` is a single 4319-line file registering ~96 admin routes across ~24
domains (provider-instances, accounts, oauth import, api-keys, teams, model-mappings,
aliases, routing-profiles, model-pricing, settings, webhooks, usage, spend, cache,
request-logs, config-revisions, …). An audit found the size is a maintainability
liability but, crucially, the coupling is clean — every handler is effectively
stateless and reaches shared services only through `app.*` decorators, so it splits
safely. Two systemic correctness bugs and pervasive boilerplate also live here:

- **A1 — malformed admin input returns 500, not 400.** Handlers use Zod `.parse()`
  (56 sites) with no surrounding catch, and the shared error handler has no `ZodError`
  branch, so every bad body/param falls through to the catch-all 500 and the
  field-level validation detail is swallowed. The dashboard cannot distinguish bad
  input from a server fault. (Sibling sub-routes `admin/proxyPools.ts`,
  `admin/providerAccounts.ts` already map ZodError→400 locally; admin.ts does not.)
- **A2 — "not found" returns 500, not 404.** Seven handlers `throw new Error("… not
  found")` instead of replying 404, so a missing account/instance surfaces as a
  generic 500.
- **Boilerplate** repeated across the file: `z.object({id:…}).parse(request.params)`
  (×26), the audit record call (×59), and the list→create→patch→delete CRUD shape
  (teams, model-mappings, routing-profiles, model-aliases) — collapsible to helpers.

This change is maintainability + two HTTP-correctness fixes; it does not touch the
request hot path or persistence semantics.

## What Changes

- **Fix ZodError→400 centrally.** Add an `instanceof ZodError → 400` branch to the
  shared error handler with the field path, so all admin validation errors return 400
  with a useful message (and any other `.parse()` site benefits too).
- **Fix "not found"→404.** Replace the seven `throw new Error("not found")` with the
  `reply.code(404).send({error:{…}})` envelope used elsewhere (or a typed
  `NotFoundError` the handler maps to 404).
- **Extract shared helpers** first: `parseIdParam(request)`, `recordAudit(app,
  request, action, targetType, targetId)`, and (optionally) a small `registerCrud`
  factory for the uniform CRUD domains.
- **Decompose `admin.ts` into per-domain modules** under the existing `routes/admin/`
  directory (which already hosts `proxyPools.ts`, `providerAccounts.ts`,
  `mediaProviders.ts` as `registerXRoutes(app, config)` modules): e.g. `oauth.ts`,
  `instances.ts`, `accounts.ts`, `testing.ts`, `catalog.ts`, `keys.ts`, `settings.ts`,
  `observability.ts`, plus an `index.ts` registrar. Each move is behavior-preserving.
- **No route paths, auth, or response contracts change** (other than the 400/404
  corrections above).

## Capabilities

### New Capabilities
- `admin-error-semantics`: admin endpoints return correct HTTP status for malformed
  input (400 with field detail) and missing resources (404), with a consistent error
  envelope, instead of a generic 500.

## Impact

- Modified (engine): `middleware/errorHandler.ts` (+ZodError→400); `routes/admin.ts`
  → split into `routes/admin/*.ts` + `routes/admin/index.ts`; the 7 not-found
  handlers; new shared helpers (`parseIdParam`, `recordAudit`).
- No data migration. No hot-path or persistence-semantics change. (The divergent
  `saveAdminRuntimeState` partial-save is addressed by `persistence-durability`, not
  here — but deleting it fits naturally during the move; coordinate so it's removed
  once.)
- Risk: large mechanical move of 96 routes. Mitigation: do helpers + the two HTTP
  fixes first, then move one domain at a time, each verified against the existing
  admin route tests; no logic change in the move itself.
- Out of scope: changing what admin operations exist or their payloads; the
  decomposition is structural.
