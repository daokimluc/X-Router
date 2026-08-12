## Approach

One seam (`adapter.ts`) that every caller goes through. The adapter decides mock vs live per method based on `XROUTER_ENABLED`, and always falls back to mock on failure. The browser never touches X-Router — it calls Foza Route Handlers, which call the adapter server-side with the admin key.

```
Browser ─▶ /api/xrouter/* (Foza Route Handler, server)
                │
                ▼
          adapter.ts ──XROUTER_ENABLED?──┐
            │ true                        │ false / error
            ▼                             ▼
          client.ts ──HTTP+adminKey──▶  mock.ts (typed fixtures)
            X-Router :8080
```

## Files

- `src/lib/xrouter/config.ts` — read+validate env (`XROUTER_URL`, `XROUTER_ADMIN_KEY`, `XROUTER_INTERNAL_KEY`, `XROUTER_ENABLED`, `XROUTER_WEBHOOK_SECRET`). `enabled` = `XROUTER_ENABLED === "true"`.
- `src/lib/xrouter/types.ts` — `XModel`, `XPricing`, `XApiKey`, `XUsage`, `XQuota`, `XUsageEvent`.
- `src/lib/xrouter/client.ts` — `xrouterFetch(path, init)`: prefix URL, add `Authorization: Bearer <adminKey>`, 5s timeout (AbortController), throw typed `XRouterError` on non-2xx. `import "server-only"` at top.
- `src/lib/xrouter/mock.ts` — fixtures matching `src/lib/data.ts` MODELS so console looks identical offline.
- `src/lib/xrouter/adapter.ts` — `listModels()`, `listPricing()`, `getUsage()`, `getWalletQuota(userId)`, `createApiKey(input)`. Each: `if (!cfg.enabled) return mock; try { return await client(...) } catch { return mock }`.
- `src/app/api/xrouter/models/route.ts`, `usage/route.ts` — `GET` → adapter → `NextResponse.json`.
- `src/app/api/webhooks/xrouter/route.ts` — `POST`: check `x-foza-secret` header == `XROUTER_WEBHOOK_SECRET`; dedupe event id in an in-memory `Set` (mock store); return 200.

## Endpoint mapping (X-Router → adapter)

| Adapter method | Live endpoint | Status |
|----------------|---------------|--------|
| listModels | `GET /v1/models` | ready |
| listPricing | `GET /v1/pricing` | ready |
| getUsage | `GET /admin/v1/usage` | ready |
| getWalletQuota | `GET /admin/v1/accounts/:id/quota` | ready |
| createApiKey | `POST /admin/v1/api-keys` | ready |
| assignPlan / sellerPayout / setPrice | — | mock-only (X-Router gap) |

## Trade-offs

- **Adapter fallback to mock on error vs surface error** → fallback for reads (UI stays alive), but expose typed error for writes (createApiKey) so the form can show failure. Keep it per-method.
- **In-memory webhook dedupe vs persistent** → in-memory for now (no DB yet); note it resets on restart. Real ledger is future work once Foza has a DB.
- **5s timeout** → avoid hanging the request if X-Router is slow/down during dev.

## Out of scope

- Real money ledger / DB persistence (mock store now).
- `plan`/`payout`/per-seller-pricing live calls (X-Router endpoints not built).
- Replacing `frontend-auth` mock with X-Router OAuth (separate follow-up).
