# Phase 20b — Channel Override + Priority

**Date:** 2026-05-27
**Branch target:** `main`
**Predecessor:** `340b5c1` (Phase 20a)

## Goal

Match new-api Channel Manage capabilities for per-channel customization: param override, header override, status-code mapping (persist + UI only), and priority-based candidate ordering for routing profiles.

## Out of scope

- Status-code-driven retry/auto-disable behavior (persist + UI only this phase; consume in 20c or 21)
- Group routing (Phase 20c)
- Multi-key per channel (different model — Phase 20a-style account pooling already covers it)
- Param/header override for OAuth/sign-based adapters (Vertex AI, Kiro, Windsurf, GitHub Copilot, Codex, etc.) — wire only `GenericOpenAIAdapter`, `AnthropicMessagesAdapter`, `AzureOpenAIAdapter` this phase. Other adapters remain untouched. Note this in code as a TODO comment for follow-up.

## Architecture

Three small surfaces:

1. **`ProviderInstance` extension** — persist new optional fields. `priority` already on the type; consume it in `ModelResolver`.
2. **Override application** — single helper `applyChannelOverrides(body, headers, instance)` invoked by each whitelisted adapter just before `fetchImpl`. Reserved-header guard centralized.
3. **Admin/UI** — extend instance PATCH schema; new dashboard component `ChannelOverridesEditor` shown inside `ProviderDetail`.

## Backend changes

### `ProviderInstance` (apps/gateway/src/providers/base/ProviderInstance.ts)

```ts
export type StatusCodeAction = "retry" | "disable" | "passthrough";

export type ProviderInstance = {
  // ...existing
  priority?: number; // already exists; default 0 when consumed
  paramOverride?: Record<string, unknown>;
  headerOverride?: Record<string, string>;
  statusCodeMapping?: Record<string, StatusCodeAction>;
};
```

All optional. Persistence schema in `PersistenceService.ts` already uses `z.array(z.any())` for `providerInstances` — no migration needed.

### Helper: `apps/gateway/src/utils/channelOverride.ts`

```ts
export const RESERVED_HEADER_KEYS = new Set([
  "authorization",
  "content-type",
  "content-length",
  "host",
  "connection",
]);

export function applyChannelOverrides(
  body: Record<string, unknown>,
  headers: Record<string, string>,
  instance: ProviderInstance
): { body: Record<string, unknown>; headers: Record<string, string> }
```

Behavior:
- Body: `{ ...body, ...(instance.paramOverride ?? {}) }` — shallow merge, override wins
- Headers: copy input, then for each entry in `headerOverride`, lowercase the key and skip if in `RESERVED_HEADER_KEYS`; otherwise set
- Pure function; deterministic; no I/O

### Validators

In `apps/gateway/src/utils/channelOverride.ts`:

- `isValidStatusCodeMappingKey(key: string): boolean` — accept `"NNN"` (100–599) or `"Nxx"` where N ∈ {1..5}
- `validateHeaderOverride(headers: Record<string, string>): { valid: boolean; reservedConflicts: string[] }`

### Adapter wiring

Modify three adapters; each follows the same pattern. Example for `GenericOpenAIAdapter.chatCompletions`:

Before:
```ts
const requestBody = context.reasoningEffort
  ? { ...request, reasoning_effort: context.reasoningEffort }
  : request;

const response = await this.fetchImpl(url, {
  method: "POST",
  headers: {
    "Authorization": `Bearer ${credential.apiKey}`,
    "Content-Type": "application/json"
  },
  body: JSON.stringify(requestBody),
  signal: abortController.signal
});
```

After:
```ts
const requestBody = context.reasoningEffort
  ? { ...request, reasoning_effort: context.reasoningEffort }
  : request;
const baseHeaders = {
  "Authorization": `Bearer ${credential.apiKey}`,
  "Content-Type": "application/json"
};
const { body: finalBody, headers: finalHeaders } = applyChannelOverrides(
  requestBody as Record<string, unknown>,
  baseHeaders,
  context.providerInstance
);

const response = await this.fetchImpl(url, {
  method: "POST",
  headers: finalHeaders,
  body: JSON.stringify(finalBody),
  signal: abortController.signal
});
```

Apply identically in:
- `GenericOpenAIAdapter.chatCompletions` and the parallel responses path
- `AnthropicMessagesAdapter.messages`
- `AzureOpenAIAdapter.chatCompletions`

Other adapters get no changes; they may have signed requests, OAuth bearer rotation, or non-JSON bodies that this phase explicitly defers.

### ModelResolver priority sort

In `apps/gateway/src/router/ModelResolver.ts`, `resolve()` for `routeType === "routing_profile"` already produces a candidates array. Sort it stably by descending `priority` of the candidate's `providerInstance` (default 0 if undefined). Equal priorities preserve registration order from the routing profile.

Implementation detail: `ModelResolver` doesn't currently know about `ProviderRuntimeRegistry`. Inject a lookup function via constructor (`(id) => priority`) or pull from a small registry surface. Pick whichever creates the smallest blast radius — see file structure.

For `routeType === "fixed_model"` candidates is length 1: no sort needed.

### Admin endpoint extension

`apps/gateway/src/routes/admin.ts` — `PATCH /admin/v1/provider-instances/:id`. Find `providerInstancePatchSchema` (top of file). Extend:

```ts
const providerInstancePatchSchema = z.object({
  // ...existing
  priority: z.number().int().min(-1000).max(1000).optional(),
  paramOverride: z.record(z.unknown()).optional(),
  headerOverride: z.record(z.string()).optional(),
  statusCodeMapping: z.record(z.enum(["retry", "disable", "passthrough"])).optional(),
});
```

In the handler, after parsing the body:
- If `headerOverride` present, reject reserved keys with 400 (`reserved_header_override`)
- If `statusCodeMapping` present, validate each key with `isValidStatusCodeMappingKey`; reject with 400 (`invalid_status_code_key`)

### Tests

`apps/gateway/src/test/channelOverride.test.ts`:
- `applyChannelOverrides` merges `paramOverride` shallow, override wins
- ignores reserved keys in `headerOverride` (case-insensitive)
- empty/undefined override leaves inputs unchanged
- `isValidStatusCodeMappingKey` accepts "401", "404", "500", "5xx", "4xx" and rejects "abc", "099", "600", "10x"
- `validateHeaderOverride` reports reserved conflicts

`apps/gateway/src/test/modelResolverPriority.test.ts`:
- 3 candidates with priorities 5/10/1 sort to 10/5/1
- Equal priorities preserve registration order
- Missing priority treated as 0
- `fixed_model` route returns single candidate unchanged

End-to-end test: extend `apps/gateway/src/test/genericOpenAIAdapter.test.ts` (or add new) — adapter sends `paramOverride` value when configured.

## Dashboard changes

### Type extension (App.tsx)

```ts
type ProviderInstance = {
  // ...existing
  priority?: number;
  paramOverride?: Record<string, unknown>;
  headerOverride?: Record<string, string>;
  statusCodeMapping?: Record<string, "retry" | "disable" | "passthrough">;
};
```

### New component: `ChannelOverridesEditor.tsx`

Path: `apps/dashboard/src/components/ChannelOverridesEditor.tsx`.

Renders inside `ProviderDetail` as a collapsible section under existing Models section:

- `<details>` element with summary "Advanced — overrides" + active badge if any field non-empty
- Inputs:
  - **Priority** — `<input type="number">`, default 0
  - **Param override** — `<textarea>` JSON editor (mono font, validate on blur)
  - **Header override** — `<textarea>` JSON editor; client validates reserved keys before save and shows inline warning
  - **Status code mapping** — `<textarea>` JSON editor; values restricted to `retry|disable|passthrough` (validate on blur)
- Save button → `PATCH /admin/v1/provider-instances/:id`
- Reset button reverts unsaved changes

Validation strategy: parse JSON on blur; if invalid show inline red. Save disabled until all 3 textareas parse and pass reserved-key check.

### Wiring

In `ProviderDetail`, after the Models section, render:
```tsx
{props.instances[0] && (
  <ChannelOverridesEditor
    instance={props.instances[0]}
    api={props.api}
    onSaved={() => void props.refresh()}
  />
)}
```

Multi-instance case: same pattern as Sync Models — first instance only this phase.

### Indicator badge

In `ProvidersPage`, the provider card inherits stats. Add a small "⚙" indicator next to name when `instance.paramOverride` or `instance.headerOverride` has any keys. Implemented inside `getProviderStats` or inline in `ProviderCard`.

### i18n (EN/VI)

```
channel.advanced: "Advanced — overrides" / "Nâng cao — overrides"
channel.overridesActive: "Active" / "Đang áp dụng"
channel.priority: "Priority (higher first)" / "Mức ưu tiên (cao trước)"
channel.paramOverride: "Param override (JSON)" / "Đè request param (JSON)"
channel.paramOverride.hint: "Shallow-merged into request body before sending upstream." / "Hợp nhất nông vào request body trước khi gửi upstream."
channel.headerOverride: "Header override (JSON)" / "Đè request header (JSON)"
channel.headerOverride.hint: "Reserved (Authorization, Content-Type, Host…) cannot be overridden." / "Các header dành riêng (Authorization, Content-Type, Host…) không thể ghi đè."
channel.statusCodeMapping: "Status code mapping (JSON)" / "Map status code (JSON)"
channel.statusCodeMapping.hint: "Persisted only this phase. Routing/auto-disable consume in next phase." / "Phase này chỉ lưu. Routing/auto-disable sẽ dùng ở phase sau."
channel.invalidJson: "Invalid JSON" / "JSON không hợp lệ"
channel.reservedHeaderConflict: "Reserved headers cannot be overridden: {keys}" / "Không được đè header dành riêng: {keys}"
channel.invalidStatusCodeKey: "Invalid status code key: {key}" / "Key status code không hợp lệ: {key}"
```

## Verification

In order:

1. `pnpm -C apps/gateway tsc --noEmit`
2. `pnpm -C apps/gateway test` (existing 279 + new ~12 = ~291)
3. `pnpm -C apps/dashboard tsc --noEmit`
4. `pnpm -C apps/dashboard build`
5. Manual UI smoke test:
   - Open a provider's detail page → see Advanced section
   - Set `priority: 10`, `paramOverride: {"max_tokens": 1024}` → save
   - Verify on next request the upstream gets `max_tokens=1024` overriding client's value
   - Bad JSON → inline error, save disabled
   - Reserved header `Authorization` in headerOverride → inline error, save rejected

Document anything that can't be exercised in this session (e.g., live upstream call to verify the param actually landed).

## Commit strategy

Single Phase 20b commit on `main`.
