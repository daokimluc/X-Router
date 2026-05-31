## Why

Every piece of x-router state — provider accounts, model mappings, API keys,
usage, spend ledger, **and the marketplace's money (wallets, seller earnings)** —
lives in RAM and is flushed to a single JSON file on a **5-second debounce**
(`WalletService`, `SellerEarningsLedger`, `SpendLedgerService` each call a
debounced `persistState`). For configuration data that changes rarely, this is
fine. For **money** it is not:

- **Reservations are never persisted.** `WalletService.toPersisted()` serializes
  only `balances`, not the in-flight `reservations` map; `reserveUsd` debits the
  balance immediately. A crash between reserve and settle permanently over-charges
  the buyer (the full upper-bound estimate, never refunded) or, if the debit
  hadn't flushed, resurrects spent funds. Timing-dependent, always wrong.
- **Streaming requests bypass the save.** The `onSend` persist hook only fires for
  buffered replies; streaming `/v1` responses write to the raw socket and never
  trigger it, so the highest-volume path persists money only via the 5s debounce.
- **No flush on shutdown** — a clean stop can still drop the last <5s of settled
  charges and seller credits.
- **Seller payout debt is unreconstructable.** Per-request `sellerCredit` is never
  written anywhere durable; it exists only as a running aggregate in memory.

This is acceptable today (development, no real buyer funds in the system) but must
be fixed before go-live. The cheapest time to change the storage substrate is
**now**, while there is no real money to migrate.

## What Changes

Introduce **SQLite** (via `better-sqlite3`, synchronous) as the durable store for
**transactional** marketplace + ledger state, while configuration state keeps
using the existing JSON `PersistenceService`. Data is split by nature, not by
layer:

- **SQLite (write-heavy, needs ACID):** wallet balances + active reservations,
  seller earnings, spend-ledger buckets + reservations, usage records, and a new
  per-request settlement log.
- **JSON (write-rarely, loss-tolerant):** provider accounts, model mappings, plans,
  seller records, listings, markup, business webhook config, routing profiles.

Synchronous `better-sqlite3` preserves the engine's existing **synchronous
reserve/settle** semantics — which is exactly what makes today's double-spend
protection work — and keeps x-router a self-contained, embedded, single-process
npm tool (no external DB server; one `.sqlite` file beside the JSON state file).

- **BREAKING (internal):** the money services move from in-memory Maps +
  `toPersisted/load` to SQLite-backed reads/writes. Their public method signatures
  (reserve/settle/credit/topup/snapshot) stay the same. One-time migration reads
  the existing JSON `marketplace` slice + `spendLedger` into SQLite on first boot.

## Capabilities

### New Capabilities
- `persistence-sqlite`: A synchronous SQLite-backed durable store for
  transactional money/ledger/usage state — atomic writes (survive crash and power
  loss), persisted reservations, and a one-time migration from the legacy JSON
  slice. Configuration state remains in the JSON `PersistenceService`.

### Modified Capabilities
- (none published — the money services keep their interfaces; only their storage
  substrate changes. The `usd-wallet`, `hourly-spend-buckets`, and
  `two-sided-settlement` behaviors are preserved, just made durable.)

## Impact

- New dependency: `better-sqlite3` (synchronous, embedded). Native module —
  document build prerequisites for the npm package.
- New: `apps/gateway/src/services/Database.ts` (engine) — opens/migrates the
  SQLite file (path derived from `DATA_FILE`, e.g. `<dir>/gateway.sqlite`), owns
  schema + a tiny migration runner.
- Modified (engine): `SpendLedgerService` — read/write buckets + reservations via
  SQLite instead of Maps.
- Modified (marketplace): `WalletService`, `SellerEarningsLedger` — SQLite-backed;
  reservations persisted.
- Modified: `app.ts` boot — open the DB, run migrations, do the one-time JSON→SQLite
  import; keep JSON `PersistenceService` for config slices.
- SQLite is an **engine-level primitive**; the marketplace money services depend on
  it (dependency direction `marketplace → engine` preserved — boundary test still
  holds).
- Removes the need for the deferred "persist reservations / flush-on-shutdown"
  patches — SQLite writes are immediate and atomic.
- Depends on: `usd-wallet` (#1), `hourly-spend-buckets` (#2), `two-sided-settlement`
  (#6) — it makes their state durable.
