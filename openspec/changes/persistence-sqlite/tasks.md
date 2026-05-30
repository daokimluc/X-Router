## 1. Database primitive (engine)

- [ ] 1.1 Add `better-sqlite3` dependency (+ types). Document the native-build prerequisite in INSTALL.md.
- [ ] 1.2 Create `apps/gateway/src/services/Database.ts`: open the SQLite file (path from `DATA_FILE` dir, default `gateway.sqlite`), set `journal_mode=WAL`, `synchronous=NORMAL`. Expose the `better-sqlite3` handle + a `transaction()` helper.
- [ ] 1.3 `schema_meta(version)` table + an ordered migration runner (array of `(db)=>void` steps). v1 creates all tables below.
- [ ] 1.4 Tables: `wallets(key_id PK, balance_micro)`, `wallet_reservations(id PK, key_id, estimate_micro, created_at)`, `seller_earnings(seller_id PK, day_key, month_key, day_micro, month_micro, lifetime_micro, unpaid_micro)`, `platform_margin(id PK CHECK(id=1), margin_micro)`, `spend_entries(scope PK, hour_key, day_key, month_key, hour, day, month, last_blocked)`, `spend_reservations(id PK, scope, estimate_usd, created_at)`, `settlement_log(id PK, ts, buyer_key_id, base_model, seller_id, prompt_tokens, completion_tokens, actual_sell_cost_micro, seller_credit_micro, platform_margin_micro, bill_track)`. Money columns INTEGER micro-USD.
- [ ] 1.5 Decorate `app.db` (injectable for tests; tests use an in-memory `:memory:` DB).
- [ ] 1.6 Vitest: migrations run idempotently; transaction rolls back on throw; WAL files created.

## 2. WalletService → SQLite (marketplace)

- [ ] 2.1 Back `getUsd/isProvisioned/open/topupUsd/debitUsd/hasFundsUsd` with `wallets` table reads/writes. Same signatures.
- [ ] 2.2 `reserveUsd`: single transaction — check balance, debit, insert `wallet_reservations` row. `settleUsd`/`releaseUsd`: transaction — adjust balance, delete row. Floor at 0 preserved.
- [ ] 2.3 Drop the debounced `setPersistCallback` path for wallet (writes are immediate now). Keep `toPersisted/load` only for the migration import (or remove after migration).
- [ ] 2.4 Vitest: existing walletService tests pass against SQLite; reservation row persists; reserve→(simulated restart: reopen DB)→settle still refunds correctly.

## 3. SellerEarningsLedger + settlement log → SQLite (marketplace)

- [ ] 3.1 Back `credit/markPaid/snapshot/recordPlatformMargin/getPlatformMargin` with `seller_earnings` + `platform_margin` tables; lazy day/month rollover via stored `day_key/month_key`.
- [ ] 3.2 `settlementHook` writes one `settlement_log` row per billable settle (inside the same path that credits the seller).
- [ ] 3.3 `rebuildEarningsFromLog(sellerId?)` helper: recompute unpaid/lifetime from `settlement_log` minus `markPaid` records — used for reconciliation/recovery. (markPaid also logged so the recompute is exact; add `payouts(id, seller_id, usd_micro, ts, payout_ref)`.)
- [ ] 3.4 Vitest: credit/markPaid round-trip via SQLite; settlement_log row written on settle; rebuild matches live aggregate; house never credited.

## 4. SpendLedgerService → SQLite (engine)

- [ ] 4.1 Back `reserve/settle/release/snapshot` with `spend_entries` + `spend_reservations`; hour→day→month check + lazy rollover preserved.
- [ ] 4.2 reserve/settle/release each in a transaction. Synchronous semantics unchanged (double-spend protection preserved).
- [ ] 4.3 Vitest: existing spendLedger + hourlySpendBuckets tests pass against SQLite; reservation row persists across reopen.

## 5. Boot wiring + migration

- [ ] 5.1 `app.ts`: open DB + run migrations before constructing money services; inject `app.db`.
- [ ] 5.2 One-time JSON→SQLite import: if SQLite has no `migrated_from_json` marker and a legacy `marketplace`/`spendLedger` slice exists, import wallet balances, seller earnings, spend buckets; set the marker. Idempotent. Log imported totals.
- [ ] 5.3 Stop persisting wallet/earnings/spend into the JSON `marketplace`/`spendLedger` slices (config slices stay). Confirm `createPersistedState` no longer writes money.
- [ ] 5.4 Boot reservation sweep: release `wallet_reservations`/`spend_reservations` older than the threshold (default: all, since an in-flight request didn't survive restart). Log swept count.
- [ ] 5.5 Vitest: load a representative legacy JSON state → boot → SQLite totals equal the JSON totals; second boot does not double-import.

## 6. Usage records (decide scope)

- [ ] 6.1 DECISION: move `UsageService` records to SQLite (removes the 1000-cap, feeds reconciliation) in THIS change, or defer. If included: `usage` table + query by since/keyId; `/provision/usage` reads it. If deferred: note it and keep the ring buffer.

## 7. Verification

- [ ] 7.1 Gateway `tsc` clean.
- [ ] 7.2 Full suite green — the existing 590 must pass unchanged (money behavior identical, just durable). Expect +~15 SQLite-specific tests.
- [ ] 7.3 Crash-durability test: reserve, reopen DB without a clean save, assert the reservation + balance are intact and settle/release works.
- [ ] 7.4 Manual: run with marketplace on, top up, make a billable request, `kill -9` the process mid-stream, restart → wallet + seller earnings reflect the settled request (or the reservation was swept), nothing lost beyond an unsettled in-flight hold.
- [ ] 7.5 `openspec validate persistence-sqlite --strict` passes.
