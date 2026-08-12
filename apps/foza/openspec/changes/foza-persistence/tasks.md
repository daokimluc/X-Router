# Tasks — foza-persistence

## 1. DB module + connection
- [x] 1.1 `src/lib/db/index.ts` — `import "server-only"`; open `node:sqlite`
      Database at `.data/foza.db`, singleton on globalThis (dev re-eval safe)
- [x] 1.2 `CREATE TABLE IF NOT EXISTS` for all 7 tables on first open; pragma
      `journal_mode=WAL`, `foreign_keys=ON`
- [x] 1.3 `schema_version` row + a place to hang future migrations

## 2. Repositories (stable signatures over SQLite)
- [x] 2.1 `users` repo — match current `users.ts` API (createUser, getUser,
      verifyEmailToken, setVerifyToken, checkCredentials, isGmail)
- [x] 2.2 `buyers` repo — get/set userEmail↔keyId, displayName, planId, status;
      list keys by userEmail
- [x] 2.3 `sellers` repo — get/set userEmail↔sellerId, status, externalRef
- [x] 2.4 `wallet_topups` repo — append + list by userEmail
- [x] 2.5 `webhook_events` repo — insert-if-absent by dedupeKey (returns
      duplicate?), used by webhook route for idempotency
- [x] 2.6 `billing_ledger` + `payable_ledger` repos — create tables + insert/sum
      by settlementId (written later by xrouter-money-ledger)

## 3. Migration
- [x] 3.1 On first run, if `users` empty and `.data/users.json` exists → import
      each record; leave the JSON file as backup
- [x] 3.2 Verify imported users can log in (passwordHash carried over verbatim)

## 4. Rewire callers (keep behaviour identical)
- [x] 4.1 `src/lib/users.ts` → delegate to users repo (or re-export)
- [x] 4.2 `src/lib/xrouter/account-store.ts` → delegate to buyers/sellers repos
- [x] 4.3 `src/app/api/webhooks/xrouter/route.ts` → dedupe via webhook_events
      table keyed by settlementId (not the in-memory Set, not event:ts:json)
- [x] 4.4 `src/lib/xrouter/session.ts ensureUserKey()` → reads/writes via buyers repo

## 5. Verify
- [x] 5.1 `npx tsc --noEmit` + `npm run build` pass (then `rm -rf .next` before dev)
- [x] 5.2 Auth E2E still works on SQLite: register → verify → login; data survives
      a dev-server restart (the whole point)
- [x] 5.3 `node:sqlite` loads in the Node server runtime; confirm no client-component
      import (server-only guard)
- [x] 5.4 Concurrent webhook dedupe: two identical-second events with the SAME
      settlementId → one row; with DIFFERENT settlementId → two rows
