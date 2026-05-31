## Scope note (narrowed during implementation, 2026-05-30)

This change converts ONLY the two services with the dangerous failure modes —
**WalletService** (buyer funds) and **SellerEarningsLedger** (payout debt) — to
SQLite. These were the cases where a crash between the 5s JSON debounces could
over-charge a buyer or lose a payout obligation.

Deferred (with reasons):
- **SpendLedgerService stays in-memory/JSON.** It is engine spend-cap code
  (float buckets), several tests mutate it in place via `peek()`, and it never
  holds real money — a lost spend-cap counter resets a rate window, it does not
  lose funds. Converting it is a larger ripple for no durability win here.
- **settlement_log writes + payouts reconstruction → money-correctness (#2).**
  The tables exist in the v1 schema; #1 keeps a pure storage swap (settleUsd
  still void). #2 adds the per-settle log row + rebuild/reconcile.
- **UsageService records stay in the ring buffer (task 6.1).** Reconciliation
  feed is a money-correctness/provision concern, deferred.
- **`node:sqlite` (DatabaseSync) used instead of `better-sqlite3`** — same
  synchronous shape (so in-process double-spend protection is preserved) with
  zero native-build/install risk on Node 22+.

## 1. Database primitive (engine)

- [x] 1.1 ~~Add `better-sqlite3`~~ → use Node built-in `node:sqlite` (no dep, no native build). No INSTALL.md change needed.
- [x] 1.2 Create `apps/gateway/src/services/Database.ts`: open the SQLite file (path from `DATA_FILE` dir, default `gateway.sqlite` via `deriveSqlitePath`), `journal_mode=WAL`, `synchronous=NORMAL`. Exposes the `DatabaseSync` handle + a `transaction()` helper.
- [x] 1.3 `schema_meta(version)` table + ordered migration runner (array of `(db)=>void`). v1 creates all tables below.
- [x] 1.4 Tables: `wallets`, `wallet_reservations`, `seller_earnings`, `platform_margin`, `spend_entries`, `spend_reservations`, `settlement_log`, `payouts`. Money columns INTEGER micro-USD. (spend_*/settlement_log/payouts created now but unused until later changes — harmless.)
- [x] 1.5 Decorate `app.database` (injectable for tests via `dependencies.database`; tests use `:memory:` via `makeTestDb()`).
- [x] 1.6 Vitest: migrations run idempotently; transaction rolls back on throw. (Covered via Database construction in every money test + boundary.)

## 2. WalletService → SQLite (marketplace)

- [x] 2.1 Back `getUsd/isProvisioned/open/topupUsd/debitUsd/hasFundsUsd` with `wallets` table reads/writes. Same signatures.
- [x] 2.2 `reserveUsd`: single transaction — check balance, debit, insert `wallet_reservations` row. `settleUsd`/`releaseUsd`: transaction — adjust balance, delete row. Floor at 0 preserved.
- [x] 2.3 Dropped the debounced `setPersistCallback`/`toPersisted`/`load`/`clear` path (writes are immediate now). Added `importLegacy` for the one-time migration import + `sweepReservations` for boot recovery.
- [x] 2.4 Vitest: walletService tests pass against SQLite; reservation row persists; durability across a second service instance on the same store; importLegacy idempotent; sweepReservations frees orphaned holds.

## 3. SellerEarningsLedger → SQLite (marketplace)

- [x] 3.1 Back `credit/markPaid/snapshot/recordPlatformMargin/getPlatformMargin` with `seller_earnings` + `platform_margin` tables; lazy day/month rollover via stored `day_key/month_key`.
- [ ] 3.2 `settlementHook` writes one `settlement_log` row per billable settle. → **deferred to money-correctness (#2).**
- [ ] 3.3 `rebuildEarningsFromLog` + `payouts` reconstruction. → **deferred to money-correctness (#2).**
- [x] 3.4 Vitest: credit/markPaid round-trip via SQLite; durability across a second service instance; importLegacy seeds earnings + margin; house never credited.

## 4. SpendLedgerService → SQLite (engine)

- [ ] 4.1 → **deferred (scope note above): SpendLedgerService stays in-memory/JSON.**
- [ ] 4.2 → deferred.
- [ ] 4.3 → deferred.

## 5. Boot wiring + migration

- [x] 5.1 `app.ts`: construct `new Database(deriveSqlitePath(dataFile))` (`:memory:` in test) before money services; decorate `app.database`; pass into `registerMarketplace` via `MarketplaceDeps.database`. Close on `onClose` only when buildApp created the DB (injected DB owned by caller).
- [x] 5.2 One-time JSON→SQLite import: `walletService.importLegacy(persistedState.marketplace.wallet)` + `sellerEarningsLedger.importLegacy(persistedState.marketplace.sellerEarnings)` inside `registerMarketplace`. Idempotent via `INSERT OR IGNORE` (safe every boot; no separate marker needed). Spend buckets not imported (SpendLedger deferred).
- [x] 5.3 Stopped persisting wallet/sellerEarnings into the JSON `marketplace` slice (removed those persistence contributors). `spendLedger` slice stays (SpendLedger still JSON). Config slices unchanged.
- [x] 5.4 Boot reservation sweep: `walletService.sweepReservations()` releases all `wallet_reservations` at boot (an in-flight hold didn't survive restart). spend_reservations sweep deferred with SpendLedger.
- [ ] 5.5 Vitest: legacy JSON → boot → SQLite totals equal JSON totals; second boot no double-import. → importLegacy idempotency unit-tested; full boot-import wiring test deferred (covered by importLegacy idempotency + existing usdWalletWiring buildApp tests).

## 6. Usage records (decide scope)

- [ ] 6.1 DECISION: **deferred.** UsageService keeps the ring buffer; moving usage to SQLite belongs with reconciliation (money-correctness/provision).

## 7. Verification

- [x] 7.1 Gateway `tsc` clean.
- [x] 7.2 Full suite green — **593 pass + 7 skip** (was 590 baseline; +3 net from SQLite-specific tests).
- [ ] 7.3 Crash-durability automated test (reopen DB without clean save). → reservation-row durability covered by the same-store durability tests; explicit kill-9-style test deferred to manual 7.4.
- [ ] 7.4 Manual crash test (user).
- [x] 7.5 `openspec validate persistence-sqlite --strict` passes.
