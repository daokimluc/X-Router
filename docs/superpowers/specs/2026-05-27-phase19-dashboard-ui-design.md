# Phase 19 — Dashboard UI for new-api features

**Date:** 2026-05-27
**Branch target:** `main`
**Predecessor:** commit `be4b82e` (Phase 17–18 + new-api integration backend)

## Goal

Wire the Dashboard UI to the backend features added in the new-api integration:

1. **Model Pricing UI** — CRUD table for per-model token pricing
2. **Balance & Topup UI** — show balance per API key, manual topup
3. **Test All wire-up** — replace fake `setTimeout` with real `POST /admin/v1/test-all`
4. **Sync Models button** — preview-then-confirm sync per provider instance
5. **Fix `root.test.ts`** — dashboard-dist now exists, expect 200 not 404
6. **Usage cost cleanup** — use backend `estimatedCost` instead of hardcoded `MODEL_COSTS`

All work lands in a single Phase 19 commit on `main`.

## Architecture & file layout

**New components:**
- `apps/dashboard/src/components/ModelPricingSection.tsx` — pricing CRUD table
- `apps/dashboard/src/components/TopupModal.tsx` — topup modal for one API key
- `apps/dashboard/src/components/SyncModelsModal.tsx` — sync preview + confirm
- `apps/dashboard/src/components/TestAllResultsModal.tsx` — batch connection test results

**Modified files:**
- `apps/dashboard/src/App.tsx`
  - `ApiKey` type → add `balance?: number` (undefined = unlimited)
  - `ApiKeysSection` → balance badge + topup button per row
  - `ModelRegistry` → render `<ModelPricingSection>` after `<ModelAliasesSection>`
  - `ProviderDetail` → "Sync Models" button in Models section header, wires `SyncModelsModal`
- `apps/dashboard/src/ProvidersPage.tsx`
  - Remove per-group `testingMode` state and per-group "Test All" buttons
  - Add single header-level "Test All Connections" button
  - Inline `TestAllResultsModal` (or extracted) showing summary + filterable results
- `apps/dashboard/src/UsagePage.tsx`
  - `UsageRecord` type → add `cachedTokens?: number`, `estimatedCost?: number`
  - `estimateCost()` → prefer `record.estimatedCost` if present, fallback to local table
- `apps/dashboard/src/i18n.ts` — EN/VI keys for new UI
- `apps/gateway/src/test/root.test.ts` — flip expectation from 404 to 200

**Untouched (already adequate):**
- Backend endpoints (already implemented in commit `be4b82e`)
- `GET /admin/v1/api-keys` (spreads `apiKey` so `balance` is already returned)

## Section 1 — Model Pricing UI

**Component:** `ModelPricingSection.tsx`

Table layout (new-api style):

| Model | Input/1M | Output/1M | Cached/1M | Updated | Actions |
|-------|---------:|----------:|----------:|---------|---------|
| gpt-4o | $2.50 | $10.00 | $1.25 | 2 days ago | ✏️ 🗑️ |

**Behavior:**
- On mount: `GET /admin/v1/model-pricing` → `ModelPricing[]`
- Client-side search by `model` substring
- Sort default: alphabetical by `model`
- "+ Add Pricing" → opens shared form modal (also used for edit, prefilled)
  - Fields: `model` (text, disabled when editing), `inputRate`, `outputRate`, `cachedInputRate?`, `label?`
  - Submit → `PUT /admin/v1/model-pricing/:model` (PUT is upsert)
  - Validate: rates are numbers ≥ 0
- Delete → `ConfirmDialog` (variant=danger) → `DELETE /admin/v1/model-pricing/:model`
- Display: `$X.XX` formatted, "—" when `cachedInputRate` is unset (do not leak the backend's `inputRate * 0.5` fallback formula to the UI)

**Empty state:** `DEFAULT_PRICING` preloads ~16 models, so the list is rarely empty. Empty fallback text: "No pricing configured. Click + Add Pricing to set rates."

## Section 2 — Balance & Topup UI

**Type update:**

```ts
type ApiKey = {
  // ...existing fields
  balance?: number; // undefined = unlimited
};
```

**Display in `ApiKeysSection`:**
- Badge between team and limits columns:
  - `$12.45` for numeric balance
  - `∞` when `balance === undefined`
  - `$0.00` (dim/red) when `balance === 0`
- Topup button: small icon (Plus or DollarSign), opens `TopupModal`

**Component:** `TopupModal.tsx`

- Fields: `amount` (number, step=0.01, min=0.01)
- Quick amount buttons: $5, $10, $50, $100
- Submit → `POST /admin/v1/api-keys/:id/topup` body `{ amount }`
- Response → close modal, refresh list, show transient toast `Added $X. New balance: $Y`
- Validation: amount > 0 and a valid number; submit disabled while pending

**Edge case:** When the key is currently unlimited (no `balance`), topup converts it to balance-tracked mode. Modal shows: `⚠ This key is currently unlimited. Topping up will switch it to balance-tracked mode.`

## Section 3 — Test All wire-up

**Decision:** A single header-level "Test All Connections" button that calls `POST /admin/v1/test-all` (no group filter).

Backend tests **all** enabled instances and returns `{ summary, results[] }`. Per-group buttons would either need backend filtering or client-side filtering, neither of which is worth the extra surface area. One unambiguous button is simpler and matches what the endpoint actually does.

**Changes in `ProvidersPage.tsx`:**
- Remove per-group `testingMode` state
- Remove per-group "Test All" buttons (lines 388–397)
- Add header button (next to search bar): `[▶ Test All Connections]`
- New state: `testing: boolean`, `testResult: { summary, results } | null`

**Component:** `TestAllResultsModal.tsx`

Layout:

```
┌─ Connection Test Results ─────────────────────┐
│  ✅ 12 OK   ⚠ 2 Degraded   ❌ 3 Down           │
│  ▼ All  [OK]  [Degraded]  [Down]               │
│  ✅ kiro-main          ok        45ms          │
│  ⚠ openai-fallback     degraded  450ms         │
│     ↳ "rate limit warnings"                    │
│  ❌ groq-prod          down      timeout       │
│     ↳ "401 Unauthorized"                       │
│                              [ Close ]         │
└────────────────────────────────────────────────┘
```

**i18n keys:** `prov.testAll`, `prov.testing`, `prov.testResults`, `prov.testOk`, `prov.testDegraded`, `prov.testDown`.

## Section 4 — Sync Models button

**Wire location:** `ProviderDetail` (App.tsx:2261), Models section header (~line 2835), button in `connectionControls` next to "Add Model" and "Disable All".

**Disabled when:**
- `props.instances.length === 0`, OR
- No active accounts (`props.accounts.filter(a => a.status === "active").length === 0`)

**Multi-instance handling:** Sync the **first instance only** (`props.instances[0].id`). `ProviderDetail` already defaults to `instances[0]` for every other action; this keeps consistency and matches the 95% case (one instance per provider type).

**Component:** `SyncModelsModal.tsx`

Two-step flow:
1. **Preview** — `POST /admin/v1/provider-instances/:id/sync-models` with empty body (no autoCreate). Backend returns `{ discovered, new[], removed[] }`.
2. **Confirm** — same endpoint with body `{ autoCreate: true }`. Backend creates all new models. Show toast `Added X models`, refresh, close modal.

**Decision:** No per-model checkbox selection in this phase. Backend's `autoCreate` flag is all-or-nothing; granular selection would require either changing the backend contract or looping through `POST /admin/v1/model-mappings` from the client. 95% of users want all of them; partial selection is feature creep here.

Layout:

```
┌─ Sync models from upstream ─────────────────────────┐
│  Provider: openrouter (instance: openrouter-main)   │
│  Discovered 142 models. 12 new, 2 removed.          │
│                                                     │
│  ─── New (will be added) ──────────────────────────│
│  + google/gemini-2.5-pro                            │
│  + anthropic/claude-opus-4-5                        │
│  + ... 9 more                                       │
│                                                     │
│  ─── Removed from upstream ────────────────────────│
│  ⚠ Existing mappings won't be auto-deleted:         │
│  • old-model-v1                                     │
│  • deprecated-thing-v2                              │
│                                                     │
│  [ Cancel ]                    [ Add 12 models ]    │
└─────────────────────────────────────────────────────┘
```

Empty new list → "Add" button disabled, message "All upstream models already mapped".

## Section 5 — Usage cost cleanup

Frontend `UsageRecord` currently lacks `cachedTokens` and `estimatedCost` (backend already returns them). The hardcoded `MODEL_COSTS` table in `UsagePage.tsx` duplicates `ModelPricingService` and will drift.

**Changes:**
1. Add `cachedTokens?: number` and `estimatedCost?: number` to frontend `UsageRecord` type
2. `estimateCost(record)` → prefer `record.estimatedCost` when present; fall back to local table for old records
3. No new column needed — cost columns already exist (lines 680–694)

This is a small refactor inside the same commit; no new UX surface.

## Section 6 — `root.test.ts` fix

`apps/gateway/src/test/root.test.ts` currently expects status 404 because `dashboard-dist/` was assumed missing. The dist now exists at `apps/gateway/dashboard-dist/index.html`. Update the test:

- Test description → reflects that the dashboard is served
- Assertion → `expect(response.statusCode).toBe(200)` (or `expect([200, 404]).toContain(...)` if we want the test resilient to either env)

Decision: assert `200` since the build artifact is committed. If CI starts running before build, we'll revisit.

## i18n strings (EN/VI)

Required keys (non-exhaustive — final list emerges during implementation):

- `pricing.title`, `pricing.add`, `pricing.edit`, `pricing.delete`, `pricing.confirmDelete`, `pricing.empty`
- `pricing.field.model`, `pricing.field.inputRate`, `pricing.field.outputRate`, `pricing.field.cachedRate`, `pricing.field.label`
- `apikey.balance`, `apikey.unlimited`, `apikey.topup`, `apikey.topupTitle`, `apikey.topupAmount`, `apikey.topupSwitchWarning`
- `prov.testAll`, `prov.testing`, `prov.testResults`, `prov.testSummary`, `prov.testOk`, `prov.testDegraded`, `prov.testDown`
- `prov.syncModels`, `prov.syncDiscovering`, `prov.syncNewModels`, `prov.syncRemovedModels`, `prov.syncAdd`, `prov.syncDone`

## Verification

In order:

1. `pnpm -C apps/gateway tsc --noEmit` — type check
2. `pnpm -C apps/dashboard tsc --noEmit` — type check
3. `pnpm -C apps/dashboard build` — production build
4. `pnpm -C apps/gateway test` — all 266 tests pass; `root.test.ts` now expects 200
5. Manual smoke test in a browser:
   - Models page → ModelPricingSection: list, add, edit, delete a pricing entry
   - API Keys section → balance badge visible; topup modal works (real key)
   - Providers page header → "Test All" → modal renders with results
   - Provider detail → "Sync Models" → preview modal → confirm → models created
   - Usage page → cost figures still display, prefer backend `estimatedCost` when present

If a UI step can't be exercised (e.g., no real provider account configured), state that explicitly rather than claiming success.

## Out of scope

- Granular per-model selection in Sync flow (deferred — would require backend contract change)
- Multi-instance Sync UI (current single-instance default is sufficient)
- Audit log viewer for `api_key.topup` actions (separate phase)
- Per-key transaction history detail panel (option 3 from the brainstorm; not needed yet)
- Usage page cost-per-cached-token column (visible already as part of `estimatedCost`)
