## Why

Foza's server-side state today lives entirely in `globalThis` in-memory maps:
`account-store.ts` (user→keyId/sellerId mapping), `ledger.ts` (usage/spend), the
webhook dedupe `Set`, and the file-backed `users.ts` (`.data/users.json`). All of
it is lost on restart.

This blocks the phase-2 integration in two concrete ways:

1. **Tenant-scoping needs durable mapping.** The agreed security model (X-Router
   does no tenant isolation; Foza must verify every `keyId`/`sellerId` belongs to
   the logged-in user before calling `/provision/*`) only works if the
   `user→{keyId,sellerId}` mapping survives restarts. An in-memory map that resets
   means the ownership guard loses the data it checks against.
2. **A money ledger needs atomic writes.** The agreed model has Foza keep its own
   buyer-billing + seller-payable ledgers fed by `usage.recorded` webhooks. Those
   arrive concurrently; a read-modify-write JSON file races and corrupts. A real
   transactional store is required for money correctness.

This change introduces a minimal SQLite persistence layer for the state Foza
*must* own. It is the foundation the tenant-scoping and money-ledger changes build
on. It deliberately does **not** duplicate X-Router's catalog (plans/sellers/
listings/markup) — that stays a live read per the integration contract.

## What Changes

- **Add a SQLite store** behind a single module seam, replacing the in-memory
  `globalThis` stores and the `.data/users.json` file.
- **Tables (Foza-owned state only):**
  - `users` — identity (migrated from the current file-backed user store: email,
    name, passwordHash, verified, verifyToken…).
  - `buyers` — `userId/email → keyId`, plus Foza-side `display_name` per key
    (X-Router has no display-label field; `owner` on the key is set to the email).
  - `sellers` — `userId/email → sellerId`, status mirror, `externalRef = userId`.
  - `wallet_topups` — VND→USD top-up history (gatewayTxId, vndAmount, fxRate,
    usdAmount, status) for payment reconciliation.
  - `billing_ledger` — buyer charges, one row per `usage.recorded`, keyed by
    `settlementId` for idempotency.
  - `payable_ledger` — seller credit accrual, one row per `usage.recorded`
    (excluding `house`), keyed by `settlementId`.
  - `webhook_events` — raw event log (settlementId/dedupe key, event, rawBody,
    signatureVerified, processedAt) for idempotency + replay.
- **Migrate** the existing `.data/users.json` into the `users` table on first run.
- **Keep the module API stable** so callers (`session.ts`, auth actions, webhook
  route) change as little as possible — the store is swapped behind the same
  function signatures `users.ts`/`account-store.ts` already expose.

This change is storage only. It does **not** add the ownership guard (→
`xrouter-tenant-scoping`) or the reconciliation job (→ `xrouter-money-ledger`); it
provides the durable tables those depend on.

## Capabilities

### New Capabilities
- `foza-persistence`: A SQLite-backed persistence layer for the state Foza owns —
  identity, user↔resource mappings, top-up history, money ledgers, and webhook
  event log — replacing the in-memory `globalThis` stores so tenant-scoping and
  money correctness survive restarts and concurrent writes.

## Impact

- **Affected code:** `src/lib/users.ts` (file→SQLite), `src/lib/xrouter/account-store.ts`
  (globalThis→SQLite), `src/lib/xrouter/ledger.ts` (globalThis→SQLite, reshaped in
  the money-ledger change), `src/app/api/webhooks/xrouter/route.ts` (dedupe Set→
  table), plus a new `src/lib/db/` module.
- **New dependency:** a SQLite driver. Candidate: Node's built-in `node:sqlite`
  (same as X-Router uses) to avoid native-module friction; fallback
  `better-sqlite3` if `node:sqlite` is unavailable in the Node version Foza runs.
  Driver choice is settled in `design.md` after reading the Next.js 16 docs in
  `node_modules/next/dist/docs/` (AGENTS.md requirement) — SQLite must run in the
  Node server runtime, never Edge.
- **Migration:** existing `.data/users.json` users are imported once; the JSON
  file is left in place (not deleted) as a backup.
- **Risk:** medium — touches the auth store that the just-shipped login/verify flow
  depends on. Mitigated by keeping the module API identical and migrating existing
  users. Verified by re-running the auth E2E (register→verify→login) against SQLite.
- **No X-Router contact** in this change; it is purely Foza-internal storage.
