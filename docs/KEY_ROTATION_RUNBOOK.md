# X-Router key rotation runbook (Foza operator)

Both X-Router keys Foza holds are server-side only (`.env.local`, never shipped to
the browser). A leak compromises the money plane, so rotate on suspicion. X-Router
accepts a comma-separated list of keys, so rotation has **no downtime**.

## Provision key (`XROUTER_PROVISION_KEY`)

1. On the X-Router host, add the new key alongside the old:
   `PROVISION_API_KEYS=oldkey,newkey` and restart X-Router.
2. Switch Foza to the new key: set `XROUTER_PROVISION_KEY=newkey` in `.env.local`
   and restart Foza (dev: stop → verify port free → `rm -rf .next` → start).
3. Remove the old key on X-Router: `PROVISION_API_KEYS=newkey` and restart.

The compromised key stops working the moment it leaves the list. Keep the two-key
window short.

## Admin key (`XROUTER_ADMIN_KEY`)

Same procedure with `ADMIN_API_KEYS=oldkey,newkey` on X-Router and
`XROUTER_ADMIN_KEY` in Foza.

## Client (buyer) key rotation

A buyer who suspects their key is leaked rotates it in-place from the console keys
page (the **Rotate** action → `POST /provision/key/:id/rotate`). The id/plan/wallet
are kept; the new plaintext is shown once; the old secret dies immediately.

## Rate limits (production)

`PROVISION_RATE_LIMIT_PER_MINUTE` on X-Router defaults to 120/min/key on the
privileged routes (create-key, wallet/topup, grant, mark-paid). Recommended:

- Normal production: 300–600 (Foza is the only trusted holder of the key).
- Bulk provisioning / migration window: raise temporarily (e.g. 2000), then lower.
- Foza's client retries 429 with backoff (`src/lib/xrouter/client.ts`,
  `XRouterRateLimitError` after the cap) as a safety layer regardless.

## Health

Foza can poll `GET /healthz` (no auth) for liveness via
`src/lib/xrouter/health.ts` `isXRouterUp()`. `/readyz` (needs a key) reports whether
a provider instance is available.
