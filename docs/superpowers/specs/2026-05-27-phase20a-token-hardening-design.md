# Phase 20a — Token Hardening + Batch UX

**Date:** 2026-05-27
**Branch target:** `main`
**Predecessor:** commit `c8156bc` (Phase 19 dashboard UI)

## Goal

Match new-api Token Manage capabilities by adding per-key restrictions (expiry, model whitelist, IP allowlist), centralizing policy enforcement in a dedicated middleware, and shipping batch operations for the API Keys UI.

## Out of scope (deferred to later phases)

- Group routing logic (Phase 20c) — `groupName` field is captured but not yet consumed by router
- Channel param/header overrides (Phase 20b)
- Redemption codes, EPay/Stripe top-up
- 2FA / WebAuthn user auth
- Cross-group retry, channel affinity

## Architecture

Two clean separations:

1. **`auth` middleware** stays focused on identity: validate Bearer token, set `request.auth`, basic enabled/team-disabled gates, rate limiting.
2. **`enforceKeyPolicy` middleware** (new) runs after `auth` and handles all policy gates: expiry, IP allowlist, model whitelist (key-level + team-level), balance.

Policy logic that currently lives inline in `routes/openai.ts` and `routes/anthropic.ts` (team `allowedModels` check, `hasBalance` check) moves into the new middleware. Routes register both middlewares in `preHandler`. This eliminates duplication across protocols.

## Backend changes

### `InternalApiKeyRecord` extension

`apps/gateway/src/services/ApiKeyService.ts`:

```ts
type InternalApiKeyRecord = {
  // ...existing fields (id, keyHash, enabled, owner, teamId, rpmLimit,
  //                    dailyLimit, dailyTokenLimit, balance, createdAt)
  expiresAt?: Date;            // undefined = never expires
  allowedModels?: string[];    // undefined or empty = all models allowed
  allowedIps?: string[];       // undefined or empty = all IPs allowed
                               //   entries: single IP or CIDR (IPv4/IPv6)
  groupName?: string;          // optional label, reserved for Phase 20c routing
};
```

All four fields are optional and default to permissive (no restriction). Existing keys load with `undefined` for these fields.

### `ApiKeyService` API

- `create(input)` extended: accept the 4 new fields
- `update(id, patch)` extended: accept the 4 new fields
- `bulkDelete(ids: string[]): { deleted: number; notFound: string[] }` — new
- `isExpired(record): boolean` — new helper (`record.expiresAt !== undefined && record.expiresAt < new Date()`)

`PersistenceService` (or whatever JSON snapshot the service uses) extends to include the new fields. Reading old snapshots without the fields produces `undefined` — no migration needed.

### Validation (admin route schemas)

Existing Zod schemas in `apps/gateway/src/routes/admin.ts` for create/patch extend:

- `expiresAt`: `z.string().datetime().optional()` (ISO timestamp; service converts to Date)
- `allowedModels`: `z.array(z.string()).max(200).optional()`
- `allowedIps`: `z.array(z.string()).max(50).optional()` — each entry validated by `ipaddr.js` (single or CIDR, IPv4 or IPv6); reject invalid entries with 400
- `groupName`: `z.string().min(1).max(64).optional()`

### New middleware: `enforceKeyPolicy.ts`

Path: `apps/gateway/src/middleware/enforceKeyPolicy.ts`.

Factory:

```ts
createKeyPolicyEnforcer(deps: {
  apiKeyService: ApiKeyService;
  teamService: TeamService;
  getModel?: (req: FastifyRequest) => string | undefined;
})
```

The handler runs after `auth` (so `request.auth.apiKeyHash` is set):

1. **Expiry:** if `record.expiresAt && record.expiresAt < now` → `401 token_expired`
2. **IP allowlist:** if `record.allowedIps?.length`, parse `request.ip` and check against the list using `ipaddr.js`. Mismatch → `403 ip_not_allowed`. (Fastify's `request.ip` honors `trustProxy` config; matches new-api semantics.)
3. **Model whitelist (key-level):** if `getModel` returns a non-empty string and `record.allowedModels?.length`, reject with `403 model_not_allowed_for_key` if not in list.
4. **Model whitelist (team-level):** same check against `team.allowedModels`. Reject with `403 team_model_not_allowed`.
5. **Balance:** call `apiKeyService.hasBalance(apiKeyHash)`. False → `402 balance_exhausted`.

Error responses match the existing shape: `{ error: { type, message, code } }`.

The `getModel` callback is provided per-route. For OpenAI/Anthropic/Embeddings/etc. routes, it parses `request.body.model`. For routes without a model (admin, health), the enforcer skips model checks entirely.

### IP matching helper

`apps/gateway/src/utils/ipMatch.ts` — wraps `ipaddr.js`:

```ts
export function ipMatches(clientIp: string, allowlist: string[]): boolean {
  // Returns true if clientIp matches any entry. Entries may be single IP or CIDR.
  // Handles IPv4-mapped IPv6 (::ffff:1.2.3.4 matches 1.2.3.4).
}
```

Adds `ipaddr.js` to `apps/gateway/package.json` (~30KB, MIT, used by Node ecosystem widely).

### Route changes

In `routes/openai.ts`, `routes/anthropic.ts`, `routes/embeddings.ts`, `routes/images.ts`, `routes/audio.ts`, `routes/web.ts`, `routes/models.ts`:

- `preHandler` becomes an array: `[authMw, policyMw]`
- For body-bearing routes, pass `getModel: (req) => (req.body as { model?: string })?.model`
- **Delete** the inline team `allowedModels` check (currently in `openai.ts` lines ~51–68 and `anthropic.ts` equivalent)
- **Delete** the inline `hasBalance` check (currently in `openai.ts` lines ~71–80 and `anthropic.ts` equivalent)

The middleware now owns these checks for every route uniformly.

### New admin endpoints

In `apps/gateway/src/routes/admin.ts`:

- `POST /admin/v1/api-keys/batch-delete` — body `{ ids: string[] }` → `{ deleted: number, notFound: string[] }`. Uses `apiKeyService.bulkDelete`. Records audit `api_key.batch_delete` with `targetId: "*"`.
- `GET /admin/v1/api-keys/export?format=csv` — streams CSV. Columns: `id, owner, teamId, keyHash, enabled, createdAt, expiresAt, balance, rpmLimit, dailyLimit, dailyTokenLimit, allowedModels, allowedIps, groupName`. Omits raw key value (admin must use the per-key reveal endpoint). Records audit `api_key.export`.

Existing `POST /admin/v1/api-keys` and `PATCH /admin/v1/api-keys/:id` accept the new fields via the extended Zod schema. `GET /admin/v1/api-keys` already spreads `apiKey`, so the new fields ride along automatically.

## Dashboard changes

### Type extension (`App.tsx`)

```ts
type ApiKey = {
  // ...existing fields (id, keyHash, enabled, owner, balance, createdAt, limits)
  expiresAt?: string;          // ISO from JSON
  allowedModels?: string[];
  allowedIps?: string[];
  groupName?: string;
};
```

### New components

- `apps/dashboard/src/components/ApiKeyEditModal.tsx` — full edit modal with three tabs:
  - **Basic:** owner, teamId, groupName, enabled toggle
  - **Limits:** rpmLimit, dailyLimit, dailyTokenLimit (numeric inputs with empty = no limit), balance (read-only display + link to existing TopupModal)
  - **Restrictions:** expiresAt (datetime-local input + quick preset buttons: 1h, 24h, 7d, 30d, 90d, Never), allowedModels (autocomplete multi-select), allowedIps (chips input)
- `apps/dashboard/src/components/ApiKeyExportModal.tsx` — opens after admin clicks Export; shows CSV preview with [Copy] and [Download .csv] buttons
- `apps/dashboard/src/components/IpAllowlistInput.tsx` — chips input. On Enter or comma, validate the entry as IP or CIDR (regex + range bounds). Invalid entries shown red with tooltip; valid entries become chips with × to remove.
- `apps/dashboard/src/components/ModelMultiSelect.tsx` — fetches model list from `GET /admin/v1/model-mappings` (already used elsewhere); typeahead select; selected models become chips.

### `ApiKeysSection` updates

- Replace the inline `endpointKeyEditForm` (lines ~5099–5115) with a button that opens `ApiKeyEditModal` for the row.
- Header gets a `Toggle` for "Batch mode". When on:
  - Each row gets a leading checkbox (selectable)
  - A sticky action bar appears: `[Delete N] [Disable N] [Enable N] [Export selected]`
  - Header gains a "Select all" checkbox
- Each row's meta line shows additional badges where applicable:
  - ⏰ relative time + tooltip ISO if `expiresAt` is set; if expired, the row dims and shows a "Expired" tag
  - "N models" pill if `allowedModels.length > 0`, with tooltip listing the names
  - "N IPs" pill if `allowedIps.length > 0`, with tooltip listing entries
- Create form gains optional inputs for the 4 new fields (mirror of edit modal Restrictions tab + groupName).
- "Export all" button (header) → calls `GET /admin/v1/api-keys/export?format=csv` → opens `ApiKeyExportModal`.

### i18n keys (EN/VI)

New keys:

- `apikey.tab.basic`, `apikey.tab.limits`, `apikey.tab.restrictions`
- `apikey.field.expiresAt`, `apikey.field.allowedModels`, `apikey.field.allowedIps`, `apikey.field.groupName`
- `apikey.expiresAt.preset.1h/.24h/.7d/.30d/.90d/.never`
- `apikey.expired`, `apikey.modelsCount` (`{n} models`), `apikey.ipsCount` (`{n} IPs`)
- `apikey.batchMode`, `apikey.batchDelete`, `apikey.batchDisable`, `apikey.batchEnable`, `apikey.batchExport`, `apikey.batchSelectAll`
- `apikey.export.title`, `apikey.export.copy`, `apikey.export.download`
- `apikey.confirmBatchDelete` (`Delete {n} API keys? This cannot be undone.`)
- `apikey.policy.expired`, `apikey.policy.ipNotAllowed`, `apikey.policy.modelNotAllowed`, `apikey.policy.balanceExhausted` (used to surface server errors clearly to UI)

## Testing

### New unit tests

`apps/gateway/src/test/enforceKeyPolicy.test.ts`:

1. Allows request when no restrictions
2. Rejects with 401 when `expiresAt` < now
3. Rejects with 403 when `request.ip` not in `allowedIps` (single IP entry)
4. Rejects with 403 when `request.ip` not in `allowedIps` (CIDR entry)
5. Allows when `request.ip` matches CIDR
6. Allows IPv4-mapped-IPv6 against IPv4 entry
7. Rejects with 403 when `model` not in key's `allowedModels`
8. Rejects with 403 when `model` not in `team.allowedModels`
9. Rejects with 402 when balance exhausted
10. Skips model check when `getModel` not provided

### Updated tests

Existing `routes/openai.ts` and `routes/anthropic.ts` tests that exercise team-model rejection or balance rejection should continue to pass without assertion changes — the enforcement moved into middleware but the public response shape is preserved. Specifically:

- `team_model_not_allowed` (403) and `balance_exhausted` (402) keep their existing codes
- New codes introduced: `token_expired` (401), `ip_not_allowed` (403), `model_not_allowed_for_key` (403)

If a test currently asserts on `request.body` parsing happening before the policy check, it may need to be reordered, but the inputs/outputs should match what tests already expect. Keep behavior backward-compatible.

### Manual smoke test

Same browser walk-through as Phase 19, plus:

1. Create a key with `expiresAt` in the past → API call returns 401 with `token_expired` code
2. Create a key with `allowedModels: ["gpt-4o"]` → request for `claude-3-5-sonnet` returns 403
3. Create a key with `allowedIps: ["10.0.0.0/8"]` from `127.0.0.1` → returns 403
4. Batch select 3 keys, click Disable → all three flip to disabled
5. Export → CSV preview shows correct columns

## Verification gates

In order:

1. `pnpm -C apps/gateway tsc --noEmit`
2. `pnpm -C apps/gateway test` (existing 267 + new 10 = 277 expected)
3. `pnpm -C apps/dashboard tsc --noEmit`
4. `pnpm -C apps/dashboard build`
5. Manual smoke test (or document what couldn't be exercised)

## Commit strategy

Single Phase 20a commit on `main` (matches Phase 19 pattern).
