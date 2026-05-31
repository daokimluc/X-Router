## 1. modelGroup util (single source — inverse direction)

- [x] 1.1 Export `ALL_GROUPS`, `freeModels()`, `expandModelGroups(models)` → `Record<group, string[]>` (classify each via `modelGroupOf`; always seed `free` from the curated set), `modelsForPlanGroups(planGroups, members)` (`["*"]` → `["*"]`, else union). Keep `modelGroupOf`/`matchesGroups` unchanged (enforcement still uses them).
- [x] 1.2 Vitest: expand classifies claude/codex/gemini; `free` always present even when `models` has none; `*` → `["*"]`; union across multiple groups; unknown → `other`.

## 2. Endpoints

- [x] 2.1 `GET /provision/plans` embeds `models` per plan via `modelsForPlanGroups(p.modelGroups, canonicalGroupMembers(app,false))`.
- [x] 2.2 `GET /provision/model-groups?activeOnly=` (provision `opts`, NOT admin) → `{ groups }` from canonical base models; `activeOnly` filters via `listingCostFor` (enabled listing + approved seller).
- [x] 2.3 `canonicalGroupMembers(app, activeOnly)` helper in provision.ts sources from `listCanonicalBaseModels()` + curated free set.

## 3. Verification

- [x] 3.1 Gateway `tsc` clean.
- [x] 3.2 Vitest (marketplace-enabled): provision key → plans carry `models`; Pro plan (`*`) → `["*"]`; Free plan → curated free models (non-empty); model-groups map classifies canonical; admin/client key → 401; activeOnly excludes unlisted canonical.
- [x] 3.3 Full suite green; engine→marketplace boundary green (only reads engine/marketplace services).
- [x] 3.4 `openspec validate marketplace-plan-groups --strict` passes.
- [x] 3.5 Update `docs/PROVISION_API_REFERENCE.md` + the website answer doc.

## 4. Out of scope (confirm)

- [x] 4.1 Changing classification rules / adding groups — not here.
- [x] 4.2 Context window / per-model metadata — separate (website static table).
