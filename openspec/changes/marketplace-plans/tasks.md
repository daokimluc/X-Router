## 1. Model grouping

- [x] 1.1 Create `apps/gateway/src/utils/modelGroup.ts` with `modelGroupOf(model: string): string` (table-driven: claude / codex / gemini / free / other) and `matchesGroups(group, planGroups): boolean` (handles `"*"`).
- [x] 1.2 Vitest `modelGroup.test.ts`: claude-sonnet-4-6→claude, gpt-5.5→codex (or gpt), gemini-2.5-pro→gemini, `"*"` matches all, unknown→other.

## 2. PlanService

- [x] 2.1 Create `apps/gateway/src/services/PlanService.ts`: `Plan` type, in-memory map, CRUD (`list`/`get`/`create`/`update`/`delete`), seeded with `free`/`claude`/`codex`/`pro` defaults.
- [x] 2.2 Persistence: `toPersisted`/`load` via `PersistenceService`; seed defaults only when no persisted plans exist (don't clobber admin edits).
- [x] 2.3 Decorate `app.planService` in `app.ts`.
- [x] 2.4 Vitest `planService.test.ts`: defaults seeded, CRUD, persistence round-trip, re-load doesn't duplicate seeds.

## 3. ApiKey plan binding

- [x] 3.1 Add `planId?: string` and per-key overrides `overageEnabled?: boolean`, `paygDailyLimitUsd?: number` to `InternalApiKeyRecord` + `create`/`update`/persistence.
- [x] 3.2 Helper `resolveKeyPlan(record, planService)` returning effective `{ plan, overageEnabled, paygDailyLimitUsd }` with key-override-wins resolution.
- [x] 3.3 Vitest: key override beats plan default for overage + paygDailyLimit.

## 4. Enforce plan in middleware

- [x] 4.1 `enforceKeyPolicy.ts`: if `key.planId` resolves to a plan, compute `group = modelGroupOf(model)`; if not in `plan.modelGroups` (and not `"*"`) → 403 `model_not_in_plan`.
- [x] 4.2 Compose scope `key:<id>:grp:<group>`; reserve against `plan.buckets` (hour/day/month) using the ledger.
- [x] 4.3 Map breach reasons: hour/day → 429 + matching Retry-After; month → branch on `overageEnabled`.
- [x] 4.4 Introduce `PaygDecision` interface + default no-op impl (`{ charge:false, reason:"payg_not_implemented" }`) → 402 with message. Inject via deps so `two-sided-settlement` can swap it.
- [x] 4.5 Keys with no `planId` keep the existing admin-cap path unchanged.
- [x] 4.6 Vitest: in-scope under caps → proceed; out-of-scope model → 403; hour breach → 429 hourly Retry-After; month breach + overage off → 429/done; month breach + overage on → 402 payg_not_implemented (until #6).

## 5. Admin endpoints + UI

- [x] 5.1 `GET/POST/PATCH/DELETE /admin/v1/plans` (zod-validated) and `PATCH /admin/v1/keys/:id` accepting `planId`/`overageEnabled`/`paygDailyLimitUsd`.
- [x] 5.2 Dashboard: plan list/editor panel + a plan selector + overage toggle + PAYG daily limit input on `ApiKeyEditModal`. (Website may drive this via provision later; admin UI is the fallback.)
- [x] 5.3 EN/VI i18n keys for plan management.
- [x] 5.4 Endpoint tests for plan CRUD + key assignment.

## 6. Verification

- [x] 6.1 Gateway `tsc` clean; dashboard tsc + build clean.
- [x] 6.2 Test suite green; expect +~16 tests.
- [x] 6.3 Manual: assign `plan_claude` to a key, call a Claude model (proceeds), call a Codex model (403 model_not_in_plan), hammer to hit hour cap (429 + Retry-After).
- [x] 6.4 `openspec validate marketplace-plans --strict` passes.
