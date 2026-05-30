## Why

The security audit found the marketplace's trust model is sound in shape but
under-protected and under-documented — fine for development, not for going public:

- **The provision key is god-mode with no tenant scoping and no rate limit.** One
  key, held by the website, can mint unlimited wallet balance on any key, read
  every buyer's wallet/usage and every seller's earnings, forge payout settlement,
  hijack supply/markup, and reconfigure the outbound webhook. A leak is total, and
  there is no throughput ceiling to slow abuse.
- **x-router enforces zero buyer/seller isolation** — it trusts the website to
  scope every `keyId`/`sellerId` to the logged-in user. This is a real, load-bearing
  security requirement, and it is **not stated anywhere**.
- **The business-webhook HMAC secret is persisted in plaintext** in the gateway
  state file (it bypasses `SecretService`, unlike provider credentials). Anyone who
  reads the file can forge validly-signed business events.
- **`payoutRef` on mark-paid is silently dropped**, and provision/admin surfaces
  have drifted (`usd` vs `amountUsd`, divergent audit actions) — small contract
  hazards.

These must be closed before the marketplace is exposed to anything but trusted
development.

## What Changes

- **Encrypt the business-webhook secret at rest** via the existing `SecretService`,
  the same path provider credentials use — never store it plaintext in the state
  file. Reads stay masked.
- **Document the trust model** in `docs/MARKETPLACE_INTEGRATION.md` as an explicit
  security requirement: x-router performs NO tenant isolation; the website MUST
  scope every `keyId`/`sellerId` to the authenticated end-user, hold the provision
  key server-side only, and verify webhook HMAC. Make the assumption a stated
  contract, not folklore.
- **Basic abuse protection on `/provision/*`** — a rate limit on the
  highest-privilege mutating routes (create-key, wallet/topup, grant, mark-paid),
  reusing the engine `RateLimitService`. Tunable, off-by-config for trusted single-
  tenant if desired.
- **Optional: support multiple provision keys with a label** (already an array) and
  document key rotation, so a compromised key can be revoked without downtime.
- **Fix the dropped `payoutRef`** on mark-paid (persist it on the payout record) and
  align the provision/admin field names + audit actions to remove drift.
- **BREAKING** none — secret encryption is transparent (migrate plaintext→encrypted
  on first load); rate limit defaults permissive; field-name alignment keeps the
  current names working (accept both during a deprecation window).

## Capabilities

### New Capabilities
- `provision-hardening`: Security hardening of the provision/webhook surface —
  encrypted webhook secret at rest, an explicit documented tenant-isolation trust
  model, basic rate limiting on privileged provision routes, and removal of the
  contract drift (`payoutRef` persistence, field-name alignment).

### Modified Capabilities
- `marketplace-webhooks`: the business-webhook secret is stored encrypted at rest
  (was plaintext).
- `provision-api`: privileged mutating routes are rate-limited; `payoutRef` is
  persisted on mark-paid.

## Impact

- Modified: `WebhookService` business config persistence — store the secret via
  `SecretService` (encrypt on save, decrypt on use); persisted slice holds
  ciphertext. One-time migration of an existing plaintext secret.
- Modified: `docs/MARKETPLACE_INTEGRATION.md` — a "Security model & trust
  assumptions" section (tenant isolation is the website's responsibility; provision
  key handling; webhook verification; threat model summary).
- Modified: `middleware/provisionAuth.ts` or the provision route group — attach a
  rate limiter to privileged routes (reuse `RateLimitService`).
- Modified: `marketplace/services/SellerEarningsLedger.ts` + provision mark-paid —
  persist `payoutRef`; align `usd`/`amountUsd` naming across provision/admin.
- Lowest priority of the five changes (development is fine today) but REQUIRED
  before any public/untrusted exposure.
- Depends on: `provision-webhook` (#7), `persistence-sqlite` (payout record store).
