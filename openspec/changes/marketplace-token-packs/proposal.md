## Why

The marketplace bills two ways today: a **plan** (monthly subscription, per-group
spend buckets) and **PAYG** (per-request wallet debit). Foza needs a third product:
a **prepaid token pack** — a buyer pays Foza once for a fixed number of tokens on a
specific base model, and those tokens are then consumed by requests with no
per-request wallet charge until the pack is exhausted or expires.

There is no way to express this today. A pack is not a plan (no monthly reset, no USD
buckets — it is a finite token balance) and not PAYG (the buyer already paid; the
wallet must not be touched). Without it, Foza cannot sell packs through x-router.

Confirmed with Foza (4 decisions):
1. **Token counting** — a pack's balance is decremented by `promptTokens + completionTokens`
   combined (one pool, not separate input/output sub-balances).
2. **Expiry** — packs expire; Foza sends an explicit `expiresAt` in the grant body
   (x-router does not compute a TTL). Default lifetime is 12 months, but the gateway
   honors whatever `expiresAt` Foza provides.
3. **Oversized request** — if a single request's estimated tokens exceed the pack's
   remaining balance, the request does **not** split across the pack and another
   track; it falls through to the plan/PAYG path and the pack is left intact.
4. **Seller credit** — the serving seller is credited normally for the supply consumed
   (the request still routes freely across sellers); the pack only changes who the
   buyer pays (Foza, up front), not how the seller is paid.

## What Changes

- **New bill track `tokenpack`.** A third settlement track alongside `plan` and `payg`.
- **`token_grants` table (Database v6).** Per-key, per-base-model finite token balances
  with an explicit `expires_at` and an `idempotency_key` so a retried grant is not
  double-credited. Money state → SQLite, like wallet/earnings.
- **`TokenGrantService` (marketplace, SQLite-transactional).** `grant` (idempotent),
  `findUsable(keyId, baseModel)` (un-expired with tokens left), `reserve(estTokens)` /
  `settle(actualTokens)` / `release` (hold-and-settle on the token balance, mirroring the
  wallet/plan reservation pattern), `listForKey`.
- **Enforce: a new step BEFORE plan/PAYG.** When a usable pack covers the request's
  estimated tokens, reserve against the pack and mark `request.tokenPack`; the request
  skips the plan bucket and the wallet entirely. If no usable pack covers it, fall
  through to the existing plan/PAYG logic unchanged (decision #3).
- **Settle on the `tokenpack` track.** Decrement the pack by the **actual** combined
  tokens; touch neither wallet nor plan bucket. The serving seller is still credited for
  the supply consumed (decision #4). The settlement row records the supply value as
  `collected` with the platform keeping **zero margin** on packs (Foza took the spread at
  sale), preserving the existing `collected == sellerCredit + platformMargin` invariant.
- **Endpoints.** `POST /provision/token-pack` (privileged, idempotent — body
  `{ keyId, baseModel, tokens, pricePaidUsd, expiresAt, idempotencyKey }`);
  `GET /provision/token-packs?keyId=`; embed `tokenPacks[]` on `GET /provision/keys`.
- **`settlement_log.bill_track`** gains the value `"tokenpack"` (column already exists).

The money for buying a pack flows through **Foza** (Foza calls
`POST /provision/token-pack` *after* it has collected payment); x-router only issues the
token grant and stores `pricePaidUsd` for audit — it never charges the buyer's wallet for
a pack.

## Capabilities

### New Capabilities
- `marketplace-token-packs`: prepaid per-model token grants consumed ahead of the plan
  and wallet, with idempotent issuance, explicit expiry, no-split oversized handling, and
  normal seller credit — a third bill track (`tokenpack`) that touches neither the wallet
  nor the plan bucket at settle.

## Impact

- New (marketplace): `services/TokenGrantService.ts`, `routes/provision.ts`
  (`POST /provision/token-pack`, `GET /provision/token-packs`, `tokenPacks[]` on
  `GET /provision/keys`), enforce hook step + `policy/settlementHook.ts` `tokenpack` branch,
  `index.ts` wiring.
- Modified (engine): `services/Database.ts` (v6 migration: `token_grants`);
  `services/MarketplaceSeam.ts` settlement `billTrack` type widened to include
  `"tokenpack"`; `request.tokenPack` reservation field (declared in marketplace, like
  `planReservation`/`payg`). No engine logic depends on packs — the marketplace drives it.
- Settle/track ordering: **tokenpack → plan → PAYG wallet**. Behind `MARKETPLACE_ENABLED`.
- Out of scope: splitting one request across pack + wallet (decision #3 = no split);
  refunding an unused/expired pack (Foza handles refunds on its side); a pack dashboard UI.
