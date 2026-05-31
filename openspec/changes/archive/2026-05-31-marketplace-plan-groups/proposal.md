## Why

Foza's `/console/plans` card shows each plan with the models it includes, but the
gateway plan only stores `modelGroups` (`["claude"]`, `["codex"]`, `["*"]`). The website
can only render the raw group label ("claude", "codex"), not the concrete member models
(`claude → claude-opus-4-8, claude-sonnet-4-6`), so the card is opaque.

The model→group classification lives in exactly one place —
`marketplace/utils/modelGroup.ts` (`modelGroupOf`, regex rules + a curated `FREE_MODELS`
set) — and it is the same function plan enforcement uses
(`marketplacePolicyCheck.ts:98`). The website must NOT copy the regex: it would drift the
moment a rule/model changes, and the `free` group is a hardcoded set that cannot be
derived from the canonical list at all (so a website-side expand would render the Free
plan with zero models).

X-Router is the source of truth for this mapping; it should expose the inverse
(group → members) and the per-plan expansion, rather than the website re-deriving it.

## What Changes

- **`modelGroup.ts` gains the inverse direction** (kept as the single source): export
  `expandModelGroups(models)` → `group → members` (classifying each model via the same
  `modelGroupOf`, always seeding `free` from the curated set), `modelsForPlanGroups(planGroups,
  members)` (`["*"]` → `["*"]`, else the union of granted groups' members), `freeModels()`,
  and `ALL_GROUPS`.
- **`GET /provision/plans` embeds `models`** per plan — the expanded list from its
  `modelGroups` (canonical base models classified by `modelGroupOf`; `["*"]` stays
  `["*"]`). One call, no website-side join.
- **New `GET /provision/model-groups`** (provision-scope) returns the full
  `group → members` map; `?activeOnly=true` keeps only canonical models that have at least
  one ENABLED listing from an approved seller (what a buyer can actually call).
- Member source = `SellerService.listCanonicalBaseModels()` (+ the curated `free` set);
  `activeOnly` filters via `listingCostFor`. No money/enforcement path touched.

## Capabilities

### New Capabilities
- `provision-plan-groups`: the website can read, with the provision key alone, the
  concrete member models for each plan (and a group→members map) sourced from the
  gateway's single model→group classifier, so plan cards show real models without the
  website copying classification rules and the `free` group is never empty.

## Impact

- New (marketplace): `expandModelGroups`/`modelsForPlanGroups`/`freeModels`/`ALL_GROUPS`
  in `marketplace/utils/modelGroup.ts`; `GET /provision/model-groups` +
  `models` field on `GET /provision/plans` in `marketplace/routes/provision.ts`.
- Out of scope: changing the classification rules themselves; context window / per-model
  metadata (separate concern); enforcement behavior (unchanged — same `modelGroupOf`).
- Freshness: near-static; the website may cache for minutes. Behind `MARKETPLACE_ENABLED`
  like all `/provision/*`.
