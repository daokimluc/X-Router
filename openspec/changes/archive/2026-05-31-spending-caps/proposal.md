## Why

API keys carry no hard ceiling on cost. Today, an API key can spend without bound until an admin notices in `UsagePage`. A leaked key, a runaway script, or a slow integration with `max_tokens=64000` could rack up real money in hours. We have model pricing data already (`ModelPricingService`), so the data to compute spend exists; we lack the policy layer to act on it.

## What Changes

- Add `dailySpendLimitUsd` and `monthlySpendLimitUsd` fields on `ApiKey`. Optional; missing/0 = unlimited.
- Add `dailySpendLimitUsd` and `monthlySpendLimitUsd` on `Team`. Inherited by team-bound keys when key field is unset.
- Track per-key and per-team rolling spend in a new `SpendLedgerService` keyed by day and calendar month.
- In the request flow, **before** calling adapter, check if a conservative pre-estimate exceeds the cap → reject with `429 spend_limit_exceeded`.
- **After** every completed request (success or failed billing), increment the ledger by the actual cost from `usage`.
- Expose `GET /admin/v1/spend/<scope>/<id>` returning current period spend and remaining budget for a key or team.
- Surface "Spend caps" controls in `ApiKeyEditModal` and team admin UI.
- **BREAKING** none — both new fields default to `null` (unlimited).

## Capabilities

### New Capabilities
- `spending-caps`: Per-key and per-team daily/monthly USD spend limit enforcement at request entry, with a ledger that survives gateway restart via persistence.
- `spending-snapshot-api`: Admin endpoint to read current period spend and remaining budget per key or team.

### Modified Capabilities
- (none — we add fields to ApiKey/Team but the spec for `enforceKeyPolicy` middleware does not change in spirit; we extend it. If a spec already exists for that middleware in `openspec/specs/`, list it here as MODIFIED. Currently `openspec/specs/` is empty, so this is purely additive.)

## Impact

- New service: `apps/gateway/src/services/SpendLedgerService.ts`.
- Updated middleware: `apps/gateway/src/middleware/enforceKeyPolicy.ts` — add pre-check.
- Updated routes: `routes/openai.ts` and `routes/anthropic.ts` — increment ledger after each request completes.
- New endpoint: `GET /admin/v1/spend/key/:id`, `GET /admin/v1/spend/team/:id`.
- Persistence: ledger persists to JSON via existing `PersistenceService` so a restart doesn't reset spend state.
- Frontend: 2 new fields in ApiKeyEditModal, 2 in team modal, plus a "current spend / cap" badge in the keys list.
