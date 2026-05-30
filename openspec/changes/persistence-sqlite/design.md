## Context

x-router persists everything through one JSON file: `PersistenceService.save`
writes `createPersistedState(app)` (provider instances, accounts, model mappings,
api keys, usage, spend ledger, and the opaque `marketplace` slice). The money
services schedule a 5s-debounced save and serialize only their settled totals,
not in-flight reservations.

`better-sqlite3` is synchronous (prepared statements execute on the calling
thread). That matters: today's reserve/settle paths are synchronous, and that
synchronicity is what prevents in-process double-spend. An async DB (Postgres,
node:sqlite-async) would force a rewrite and reintroduce interleaving windows.

## Goals / Non-Goals

**Goals:**
- Atomic, immediate durability for money state — survive crash AND power loss,
  no debounce window for transactional writes.
- Persist reservations (held funds), so a restart mid-request settles or releases
  correctly instead of orphaning a debit.
- A durable per-request settlement log so seller payout debt is reconstructable.
- Keep the engine embedded/single-process/self-host (no DB server).
- Preserve every money service's public interface and synchronous semantics.
- One-time, lossless migration from the existing JSON state.

**Non-Goals:**
- Moving configuration state (provider accounts, model mappings, plans, sellers,
  listings, markup, webhook config) to SQLite — stays JSON; it's loss-tolerant and
  the migration risk isn't worth it now.
- Multi-process / horizontal scale — single-process embedded SQLite only. (Noted
  as a future concern; WAL mode helps a future reader replica but multi-writer is
  out of scope.)
- An ORM or query builder — hand-written prepared statements; the schema is tiny.
- Async rewrite of the money path — explicitly avoided.

## Decisions

### Split by data nature, not by layer
```
   SQLite (transactional, ACID)        JSON PersistenceService (config)
   ────────────────────────────        ────────────────────────────────
   wallet balances + reservations      provider instances + accounts
   seller earnings (+ per-req log)     model mappings, routing profiles
   spend-ledger buckets + reservations plans, sellers, listings, markup
   usage records                       business webhook config
```
Rule: "money/metering needs ACID → SQLite; catalog/config tolerates 5s loss → JSON."
This is deliberate partitioning, not split-brain: the two stores never hold the
same fact.

### better-sqlite3, synchronous, one file
DB path derives from `DATA_FILE` (e.g. `~/.x-router/gateway.sqlite` next to
`gateway-state.json`). Opened once at boot with `journal_mode=WAL` (better crash
resilience + concurrent reads) and `synchronous=NORMAL`. All writes are synchronous
prepared statements; multi-step money ops wrap in a `db.transaction(...)` so they
are atomic (reserve = check+debit+insert-reservation in one tx).

### Reservations become rows, not a Map
`wallet_reservations(id, key_id, estimate_micro, created_at)` and
`spend_reservations(id, scope, estimate_usd, created_at)`. `reserveUsd`/`reserve`
insert a row + adjust the balance/bucket in one transaction; `settle`/`release`
delete the row + adjust in one transaction. On restart, rows survive — a request
that never settled can be swept (release) by a startup reconciliation or left for
explicit settle. (Sweep policy: a startup step releases reservations older than a
threshold; details in tasks.)

### Settlement log for payout reconstruction
`settlement_log(id, ts, buyer_key_id, base_model, seller_id, prompt_tokens,
completion_tokens, actual_sell_cost_micro, seller_credit_micro,
platform_margin_micro, bill_track)` — one row per billable settle. Seller earnings
aggregates can be rebuilt by summing this log per seller, so a lost in-memory
aggregate (or a missed webhook) is recoverable. This is the durable source the
best-effort `usage.recorded` webhook lacked.

### Schema versioning + migration
A `schema_meta(version)` table + a tiny ordered migration runner in `Database.ts`.
On first boot with SQLite empty but a legacy JSON `marketplace`/`spendLedger`
present: import balances, earnings, and bucket totals into SQLite (idempotent —
guard by a `migrated_from_json` flag), then stop reading those from JSON.

### Money stored as integer micro-USD
SQLite `INTEGER` (64-bit) holds micro-USD exactly — matches WalletService's
existing micro-USD representation; no floats in money columns.

## Risks / Trade-offs

- **Native module (`better-sqlite3`) build.** Needs a compiler/prebuild on install.
  Mitigation: it ships prebuilt binaries for common platforms; document the
  prerequisite in INSTALL.md. Risk to the npm self-host story — accepted, it's the
  standard embedded-DB choice.
- **Touches engine boot + open-source core.** `SpendLedgerService` is engine code;
  SQLite becomes an engine primitive. Mitigation: keep `Database.ts` small and
  engine-owned; marketplace depends on it (boundary preserved). Extensive tests
  (the existing 590 must stay green; ledger/wallet behavior unchanged).
- **Two stores to reason about.** Mitigation: the split rule is simple and the
  stores are disjoint; document it. A crash could in theory leave JSON config and
  SQLite money slightly out of sync on cross-references (e.g. a key id) — but money
  rows key by id/scope strings, not JSON object identity, so a missing config row
  degrades gracefully (unknown key → no wallet), not corrupts money.
- **Migration correctness.** A bad import double-counts or drops balances.
  Mitigation: idempotent guard, dry-run log of imported totals, and a test that
  loads a representative JSON state and asserts SQLite totals match.

## Open Questions

- Reservation sweep on boot: auto-release ALL reservations older than N minutes, or
  keep them and let the (now absent) request settle? Lean: release on boot — an
  in-flight request did not survive the restart, so its hold should be returned.
  Confirm threshold in tasks.
- Should `usage` records also move to SQLite (write-heavy, currently a capped 1000
  ring buffer)? Lean: yes — it's transactional and the cap loses data; SQLite
  removes the cap and feeds reconciliation. Decide in tasks whether to include in
  this change or a follow-up.
- WAL mode leaves `-wal`/`-shm` sidecar files next to the DB — confirm the bin's
  data-dir handling + any backup docs account for them.
