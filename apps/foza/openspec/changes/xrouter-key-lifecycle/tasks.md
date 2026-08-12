# Tasks — xrouter-key-lifecycle

## 1. Adapter + types
- [x] 1.1 `adapter.ts` — `disableKey`/`enableKey` (POST :id/disable|enable)
- [x] 1.2 `patchKey(id,{enabled?,expiresAt?})` (PATCH :id)
- [x] 1.3 `revokeKey(id)` (DELETE :id, soft)
- [x] 1.4 `rotateKey(id)` (POST :id/rotate → new plaintext once)
- [x] 1.5 `listKeys(owner)` → `GET /provision/keys?owner=` (now incl. walletUsd +
      provisioned; drop per-key N+1 wallet calls)
- [x] 1.6 `types.ts` — result shapes for the above

## 2. Persisted key state
- [x] 2.1 `buyers` repo — add `enabled` + `expiresAt` columns, reconciled from the
      provision list

## 3. Keys page UI + actions
- [x] 3.1 Per-key actions: disable / enable / revoke / rotate (owner-scoped via
      ownership guard)
- [x] 3.2 Rotate shows new plaintext once (mirror create-key UX)
- [x] 3.3 Display enabled + expiresAt; client-side filter to hide revoked
      (`enabled:false`) keys
- [x] 3.4 All actions through `assertOwnsKey` (xrouter-tenant-scoping)

## 4. Auto wind-down
- [x] 4.1 On plan cancel/loss, call `disableKey` (or `revokeKey`) for the user's key

## 5. Verify
- [x] 5.1 `npx tsc --noEmit` + `npm run build` pass
- [x] 5.2 disable → key rejected on /v1/*; enable → works again
- [x] 5.3 rotate → old secret dead immediately, new secret works, id/plan/wallet kept
- [x] 5.4 revoke → key shows enabled:false, hidden in UI, still in provision list
- [x] 5.5 owner-scope: user cannot disable/rotate another user's keyId
