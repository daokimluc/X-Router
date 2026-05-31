## Why

Buyers don't buy "a seller's model" — they buy a **plan** the platform sells: `free`, `claude` ($10, Claude models only), `codex` ($10, Codex models only), `pro` ($20, all models). A plan is a preset bundle of {model scope, hour/day/month spend buckets, overage on/off}. The advertised "$10 → $20 of usage" is the month bucket measured at **platform price** (always below vendor price); the hour/day buckets are speed limits that pace usage so the month budget can't be drained in a day. When a buyer hits an hour/day speed limit they **wait** by default (HTTP 429 + Retry-After); they only pay extra by explicitly opting into PAYG/boost (handled in `two-sided-settlement`). When the month budget is exhausted, requests stop unless overage is on.

This change defines the plan entity, default plans, and the binding of a plan to an API key, then wires the plan's caps + scope into `enforceKeyPolicy` using the hour/day/month ledger from `hourly-spend-buckets`. It does **not** implement PAYG charging (that's `two-sided-settlement`); here, exhausting a bucket without overage simply blocks.

## What Changes

- Introduce `PlanService` (`apps/gateway/src/services/PlanService.ts`): CRUD over `Plan` presets, seeded with `free`/`claude`/`codex`/`pro`, admin-extensible.
- Define `Plan = { id, name, priceUsd, modelGroups: string[], buckets: { hourUsd, dayUsd, monthUsd }, overageEnabled, paygDailyLimitUsd? }`.
- Define **model groups**: a `modelGroupOf(model)` function mapping a public/base model to a group label (`claude`, `codex`, `gpt`, `gemini`, …). Plans grant one or more groups; `pro` grants all (`["*"]`).
- Add `planId?: string` to `ApiKey`. A key bound to a plan inherits that plan's scope + buckets. `walletMicroUsd` (from `usd-wallet`) funds overage/PAYG.
- Wire `enforceKeyPolicy`: resolve the key's plan → check the request's model is in scope → compose the per-group ledger scope (`key:<id>:grp:<group>`) → reserve against the plan's hour/day/month caps. On hour/day breach → 429 wait. On month breach → if `overageEnabled` defer to PAYG (stub hook for `two-sided-settlement`), else 429/done.
- Admin endpoints: list/create/update plans; assign a plan to a key.
- **BREAKING** none — `planId` optional; keys without a plan behave exactly as today (admin-set caps still apply).

## Capabilities

### New Capabilities
- `marketplace-plans`: Platform-sold plan presets (scope + hour/day/month buckets + overage flag), bound to API keys and enforced per model group at request entry.
- `model-grouping`: A deterministic mapping from a model name to a billing/scope group, used by plans and per-group spend buckets.

### Modified Capabilities
- (none published yet — extends `enforceKeyPolicy` behavior described under `spending-caps`/`hourly-spend-buckets`, both still in `changes/`.)

## Impact

- New service: `apps/gateway/src/services/PlanService.ts` + default plan seed.
- New util: `apps/gateway/src/utils/modelGroup.ts` (`modelGroupOf`).
- Modified: `ApiKeyService` — add `planId?`. `app.ts` — decorate `app.planService`.
- Modified: `enforceKeyPolicy.ts` — plan resolution, scope gate, per-group cap reservation, overage branch (PAYG hook left as a no-op stub returning "would_payg" until `two-sided-settlement`).
- Persistence: plans persisted via `PersistenceService`; `planId` on keys persisted.
- Admin routes + dashboard: plan management UI and a plan selector on the key editor (or driven entirely from the website via `provision-webhook` later — admin UI is the fallback).
- Depends on: `usd-wallet` (#1), `hourly-spend-buckets` (#2).
