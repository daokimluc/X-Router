## Why

Foza can create keys and list them, but cannot manage their lifecycle. X-Router
already exposes the full buyer-self-service wind-down surface on the provision key
(verified in `provision.ts:143-214`), and Foza wires **none** of it:

- `POST /provision/key/:id/disable` | `/enable`
- `PATCH /provision/key/:id` `{enabled?, expiresAt?}`
- `DELETE /provision/key/:id` (soft revoke)
- `POST /provision/key/:id/rotate` (new secret, same id/plan/wallet)
- `GET /provision/keys?owner=` (now also returns `walletUsd`+`provisioned`, Phase 34d)

Without these, a user can't pause/revoke/rotate their own key, Foza can't
auto-disable a key when a buyer cancels a plan, and the keys page can't show
enabled/expiry state. This is the `marketplace-lifecycle` (#3) surface the first
integration pass never reached.

## What Changes

- **Extend the adapter** with the five lifecycle operations
  (disable/enable/patch/delete/rotate) and switch the keys listing to
  `GET /provision/keys?owner=<email>` (single call now returns wallet + provisioned,
  no N+1 — Phase 34d).
- **Extend the persisted key record** (`buyers` table from `foza-persistence`) with
  `enabled` + `expiresAt` mirrors so the UI can render state without a round-trip,
  reconciled from the provision list.
- **Keys page UI:** per-key actions — disable / enable / revoke / rotate (rotate
  shows the new plaintext once, like create), plus enabled/expiry display and a
  "revoked keys hidden" filter (revoked keys still appear in the provision list with
  `enabled:false`, per answers §E2; Foza filters client-side).
- **Auto-wind-down hook:** when a buyer cancels/loses a plan, Foza calls
  `disable` (or `DELETE` for revoke) — the self-service automation X-Router expects
  the website to drive (answers §3.6).
- **Tenant-scoped:** every lifecycle call goes through the ownership guard
  (`xrouter-tenant-scoping`) — a user can only disable/revoke/rotate **their own**
  keyId.

## Capabilities

### New Capabilities
- `xrouter-key-lifecycle`: Buyer-self-service key wind-down in Foza — disable,
  enable, set expiry, soft-revoke, and rotate a key, plus enabled/expiry display
  and automated disable on plan cancellation, all scoped to the key's owner.

## Impact

- **Affected code:** `adapter.ts` (+5 methods + reshape `listKeys` to use
  `?owner=`), `types.ts` (+lifecycle result shapes), `buyers` repo (+enabled/
  expiresAt), `console/keys` page + actions (UI + server actions), the plan-cancel
  flow (auto-disable hook).
- **Depends on:** `foza-persistence` (key record fields) and
  `xrouter-tenant-scoping` (every lifecycle write is owner-scoped). X-Router side is
  already shipped — no gateway change needed.
- **Risk:** low — additive, follows the existing adapter/action patterns; the only
  sharp edge is rotate (show new secret once) which mirrors the existing create-key
  flow.
