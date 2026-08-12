## Why

X-Router rate-limits the highest-privilege provision routes (create-key,
wallet/topup, grant, mark-paid) at `PROVISION_RATE_LIMIT_PER_MINUTE` per key
(default 120), returning `429 provision_rate_limit_exceeded` with a `retry-after: 60`
header (verified in `provision.ts:25-36`). Foza's gateway client
(`client.ts`) does **not** handle 429 — it throws like any other error. Under bulk
provisioning (many signups at once, a migration window) Foza would fail user
actions instead of backing off.

X-Router's guidance (answers §F2): raise the limit for migration windows, but Foza
should still have retry-with-backoff as a safety layer. Separately, provision-key
rotation is an operational procedure (`PROVISION_API_KEYS=old,new`) that Foza should
support without downtime — currently undocumented on the Foza side.

## What Changes

- **429-aware retry** in `client.ts`: on `429`, read `retry-after`, wait, and retry
  with capped exponential backoff (a small max-attempts bound). Only retry
  idempotent-safe situations; surface a typed error after the cap so the caller can
  show a friendly message.
- **Health-aware reads:** optionally poll `GET /healthz` (no auth, per §F3) for a
  liveness signal the console can surface ("gateway unreachable") instead of bare
  failures; `GET /readyz` (needs a key) is noted for readiness checks.
- **Provision-key rotation runbook:** document the two-key window
  (`PROVISION_API_KEYS=old,new` → switch Foza env to `new` → drop `old`) and make
  Foza's `XROUTER_PROVISION_KEY` swap a clean env change. Same note for client-key
  rotation via `/provision/key/:id/rotate` (covered in key-lifecycle).
- **Backoff applies to the reconcile job too** so a rate-limit during a large
  settlements replay doesn't abort reconciliation.

## Capabilities

### New Capabilities
- `xrouter-resilience`: Rate-limit-aware retry/backoff for Foza's X-Router client,
  liveness-aware reads, and a documented no-downtime provision-key rotation
  procedure, so bulk provisioning and transient gateway pressure degrade gracefully
  instead of failing user actions.

## Impact

- **Affected code:** `src/lib/xrouter/client.ts` (429 handling + backoff),
  `src/lib/xrouter/reconcile.ts` (use the same backoff), a small health helper, and
  docs/env notes for rotation.
- **Depends on:** nothing structural; benefits the money-ledger reconcile job.
  Can land last.
- **Config:** documents the recommended production
  `PROVISION_RATE_LIMIT_PER_MINUTE` (§F2 suggests 300–600 for a single trusted
  tenant) on the X-Router side, and the temporary raise for migrations — these are
  X-Router env settings, noted here for the operator.
- **Risk:** low — defensive layer; the main care is not retrying non-idempotent
  writes blindly (respect retry-after, bound attempts, surface a typed error).
