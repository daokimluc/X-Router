# Marketplace Integration Contract (website ↔ x-router)

The website is the control-plane (buyer/seller identity, VND/QR payment, FX,
payouts, plan catalog UI). x-router is the engine: it speaks **USD only**,
receives commands via `/provision/*`, and emits signed business events.

Enable the layer with `MARKETPLACE_ENABLED=true`.

---

## 1. Authentication

Three separate key dimensions — never interchangeable:

| Dimension | Header | Used for | Set via |
|---|---|---|---|
| Provision | `Authorization: Bearer <provisionKey>` | `/provision/*` | `PROVISION_API_KEYS` env or `x-router --set-provision-key <key>` |
| Admin | `Authorization: Bearer <adminKey>` | `/admin/*` dashboard | `ADMIN_API_KEYS` env / dashboard |
| Client | `Authorization: Bearer <clientKey>` | `/v1/*` inference | created via `POST /provision/key` |

A provision key is rejected on `/admin/*` and `/v1/*`, and vice-versa (HTTP 401
`invalid_provision_api_key`).

---

## 2. Commands IN — `/provision/*` (website → x-router)

All bodies are JSON. All amounts are **USD** (number). Errors return
`{ "error": { "message", "code" } }` with HTTP 400/401/404.

### Buyer key
```
POST /provision/key
  body  { "label"?: string, "planId"?: string }
  200   { "id": "internal_key_3", "key": "igw_...", "planId": null }
```
`key` (plaintext) is returned **once** — store it; x-router only keeps the hash.

### Assign / change plan (idempotent)
```
POST /provision/grant
  body  { "keyId": string, "planId": string,
          "overageEnabled"?: boolean, "paygDailyLimitUsd"?: number }
  200   { "id", "planId", "overageEnabled", "paygDailyLimitUsd" }
        // re-granting the same plan with no other change → adds "idempotent": true
```

### Wallet top-up (after the website confirms a VND/QR payment)
```
POST /provision/wallet/topup
  body  { "keyId": string, "usd": number>0 }
  200   { "keyId", "walletUsd": number }
```

### Markup (platform sell = cost × (1 + markup))
```
PUT  /provision/markup
  body  { "defaultMarkup"?: number>=0, "perModel"?: { "<baseModel>": number>=0 } }
  200   { "defaultMarkup", "perModel": { ... } }
```

### Seller lifecycle
```
POST /provision/seller
  body  { "displayName": string, "payoutRef"?: string, "commissionPct"?: 0..1 }
  200   { "seller": { "id", "displayName", "status": "pending", ... } }

POST /provision/seller/:id/approve     200 { "seller": { ...status:"approved" } }
POST /provision/seller/:id/suspend     200 { "seller": { ...status:"suspended" } }
```

### Listings (a seller's supply at a wholesale cost)
```
POST /provision/listing
  body  { "sellerId": string, "baseModel": string,          // baseModel must be canonical
          "costPrice": { "inputPerM": number, "outputPerM": number, "cachedInputPerM"?: number },
          "providerInstanceId": string, "providerAccountId": string }
  200   { "listing": { "id", "namespacedModel": "<seller>/<baseModel>", ... } }
        // registers BOTH "<seller>/<baseModel>" (direct) and "<baseModel>" (pooled)

PATCH  /provision/listing/:id   body { "enabled": boolean }   200 { "listing" }
DELETE /provision/listing/:id                                 200 { "deleted": id }
```

### Seller payout reconciliation (website settled a payout off-platform)
```
POST /provision/earnings/:sellerId/mark-paid
  body  { "usd": number>0, "payoutRef"?: string }
  200   { "sellerId", "day", "month", "lifetime", "unpaid" }   // unpaid reduced
```

---

## 3. Events OUT — business webhooks (x-router → website)

Configure the target (admin):
```
PUT /admin/v1/business-webhook
  body { "enabled": true, "url": "https://your-site/hook",
         "secret": "<shared-secret>", "events": ["usage.recorded", ...] }
```

Each event is an HTTP POST with body:
```json
{ "event": "<name>", "timestamp": "<ISO8601>", "data": { ... } }
```
and header `X-Provision-Signature: sha256=<hex>` = HMAC-SHA256 of the **exact raw
body** under the shared secret. **Verify before trusting** (see §4). Delivery is
best-effort (5s timeout, failures swallowed — never blocks the buyer's request).

| Event | When | `data` |
|---|---|---|
| `usage.recorded` | each billable request settles | `{ buyerKeyId, buyerKeyHash, baseModel, sellerId, promptTokens, completionTokens, actualSellCost, sellerCredit, platformMargin, billTrack }` |
| `quota.blocked` | request rejected (429/402, no boost/overage escape) | `{ keyId, httpStatus, reason, model }` |
| `wallet.low` | post-settle wallet balance below threshold | `{ keyId, balanceUsd, thresholdUsd }` |
| `grant.exhausted` | a settle crosses the plan group's `monthUsd` (once per exhaustion) | `{ keyId, planId, group, monthUsd }` |
| `supply.unhealthy` | a request routed to a non-house seller fails terminally | `{ sellerId, providerAccountId, reason }` |

`usage.recorded` is the high-volume event — it is what the website uses to bill
the buyer and accrue seller payout. `billTrack` is `"plan"` (metered against the
plan bucket) or `"payg"` (charged to the wallet). `sellerId = "house"` means the
platform's own supply (no external seller credit; full `actualSellCost` is
`platformMargin`).

---

## 4. Verifying the webhook signature (website side)

```js
import { createHmac, timingSafeEqual } from "node:crypto";

function verify(rawBody, signatureHeader, secret) {
  const expected = "sha256=" + createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(signatureHeader);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
// IMPORTANT: hash the RAW request body bytes, not a re-serialized object.
```

---

## 5. Plans, model groups, billing model

- Seeded plans: `plan_free` (free group), `plan_claude` (claude), `plan_codex`
  (codex), `plan_pro` (all groups `*`). Each = `{ modelGroups, buckets: { hourUsd,
  dayUsd, monthUsd }, overageEnabled, paygDailyLimitUsd? }`.
- A request's model maps to a group (`claude` / `codex` / `gemini` / `free` /
  `other`). Out-of-scope model → 403 `model_not_in_plan`.
- Hour/day cap hit → 429 `spend_limit_exceeded` + `Retry-After` (WAIT by default).
  Boost (opt-in via `x-allow-boost: true` header or key flag) serves via PAYG
  past a speed-limit **without** consuming the month budget.
- Month budget exhausted + overage on → PAYG (wallet) at the sell price, guarded
  by the user-set `paygDailyLimitUsd`. Overage off → blocked.
- Two-tier model names: pooled `gpt-5.5` (platform routes the cheapest seller incl.
  house) vs direct `hoang/gpt-5.5` (pins that seller). A pooled request ranks
  candidates **cheapest-seller-first** and fails over to the next cheapest when one
  is unavailable; house (true wholesale) is the ceiling. The seller actually leased
  is the one credited in settlement (and reported in `usage.recorded`).

---

## 6. Known gaps (not blocking integration)

- `GET /provision/usage` is reconciliation-grade (tokens/model/cost/timestamps),
  not a settlement-payload replay (no per-record sellerCredit/platformMargin).
- `ProviderHealthMonitor` is not yet run in production, so `supply.unhealthy`
  currently fires on a terminal request failure to a non-house seller, not from a
  periodic health probe.
- Admin dashboard UIs for plans/sellers/earnings are website-driven by design;
  the `/admin/*` endpoints exist as a fallback.

---

## 7. Security model & trust assumptions (provision-hardening)

**Read this before exposing the marketplace to anything but trusted development.**

### x-router performs NO tenant isolation — the website is the trust boundary

x-router does **not** know which buyer or seller a request belongs to. It trusts
the website (the holder of the provision key) to scope **every** `keyId` and
`sellerId` to the authenticated end-user. There is no per-tenant authorization
inside the gateway: any `keyId` passed on a provision call is acted on. This is a
load-bearing security requirement, not an implementation detail.

The website **MUST**:
- Authenticate its own end-users and map each to the `keyId`/`sellerId` it
  provisioned for them. Never pass a `keyId` a user doesn't own.
- Hold the provision key **server-side only** — never ship it to a browser, app,
  or any client the end-user controls.
- Verify the `X-Provision-Signature` HMAC on every inbound business webhook before
  acting on it (the gateway signs with the shared secret; an unverified receiver
  can be fed forged events).

### The provision key is god-mode — threat model

A single provision key, with no tenant scoping, can do everything below. Treat a
leak as total compromise of the marketplace's money + data plane.

| A leaked provision key can…                | Mitigation                                  |
|--------------------------------------------|---------------------------------------------|
| Mint unlimited wallet balance on any key   | Rotate keys; rate limit; monitor topups     |
| Read every buyer's wallet + usage          | Server-side-only handling; rotate on suspicion |
| Read every seller's earnings               | Same                                        |
| Mark payouts paid / reverse them (forge)   | Audit log; admin-side reconciliation        |
| Hijack supply / re-price / change markup   | Audit log; alerting on catalog changes      |
| Reconfigure the outbound business webhook  | Audit log; secret is encrypted at rest      |

Mitigations shipped in the gateway:
- **Rate limiting** on the highest-privilege mutating routes (`POST /provision/key`,
  `/provision/wallet/topup`, `/provision/grant`, `/provision/earnings/:id/mark-paid`),
  per provision key. Configure with `PROVISION_RATE_LIMIT_PER_MINUTE` (default 120;
  set 0 to disable for a trusted single-tenant deployment, or raise it for a bulk
  provisioning / migration window). Reads are never throttled.
- **Webhook secret encrypted at rest** — the business-webhook HMAC secret is stored
  as AES-GCM ciphertext in the state file (via the same encryption path provider
  credentials use), never plaintext. A legacy plaintext secret is migrated to
  ciphertext on the next save. `GET` always returns it masked.
- **Every provision + admin mutation is recorded** in the audit log with the actor
  key hash.

### Provision-key rotation (no downtime)

`PROVISION_API_KEYS` is a comma-separated list — **multiple keys are valid at
once**. To rotate without downtime:

1. Add a new key alongside the old: `PROVISION_API_KEYS=oldkey,newkey` and restart.
2. Switch the website to send `newkey`.
3. Remove the old key: `PROVISION_API_KEYS=newkey` and restart.

A compromised key is revoked the moment it leaves the list. Keep the two-key
window short.

### Field-name note (contract)

`usd` is the canonical amount field on `/provision/wallet/topup` and
`/provision/earnings/:id/mark-paid`. `amountUsd` is accepted as a deprecated alias
for backward compatibility; prefer `usd` in new integrations. `payoutRef` on
mark-paid is persisted on the payout record (for reconciliation).
