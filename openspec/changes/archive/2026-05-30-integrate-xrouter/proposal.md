> **Superseded (2026-05)**: X-Router later added a dedicated **provision key** for all
> `/provision/*` reads + writes and webhook config (`PUT /provision/webhook`). The website
> no longer uses an admin key. Wherever this doc says `XROUTER_ADMIN_KEY` / "admin key",
> read it as the **provision key** (`XROUTER_PROVISION_KEY`) + the internal key
> (`XROUTER_INTERNAL_KEY`) for `/v1/*`. The default port is `3100`, not `8080`.

## Why

X-Router (`D:\Project\Accountrouter`, Fastify gateway on :8080) and Foza (`D:\Project\XRouter.ai`, Next.js on :3001) are two independent services in separate repos. They integrate over HTTP, not by sharing code. X-Router is still being built, so Foza must not hard-depend on it being up or feature-complete. We need an integration layer in Foza that:

1. Talks to X-Router's HTTP API server-side (admin key never reaches the browser, per the chosen "API route" approach).
2. Is gated by a feature flag (`XROUTER_ENABLED`) so that while X-Router is under construction Foza keeps working on mock data, and flipping one env var switches to the live gateway.
3. Degrades gracefully — if X-Router is unreachable or an endpoint isn't built yet, Foza falls back to mock instead of crashing.

This realizes the `integration-contract` (Hybrid wallet model, commands/events) against X-Router's actual admin API (`/admin/v1/api-keys`, `/accounts`, `/usage`, `/webhooks`, and public `/v1/models`, `/v1/pricing`).

## What Changes

- **Config**: add `XROUTER_URL`, `XROUTER_ADMIN_KEY`, `XROUTER_ENABLED` (default `false`) env vars + a typed config reader. `.env.example` documents them.
- **HTTP client** (`src/lib/xrouter/client.ts`): server-only fetch wrapper that injects the admin bearer key, sets timeouts, and normalizes errors. Never imported by client components.
- **Adapter** (`src/lib/xrouter/adapter.ts`): the single seam. Each capability (listModels, listPricing, createApiKey, getUsage, getWalletQuota…) checks `XROUTER_ENABLED`: if on, call the real client; if off or on error, return mock data shaped identically. This is where `frontend-auth`'s mock provider and the console's mock data converge onto one source of truth.
- **API routes** (`src/app/api/xrouter/**`): Next.js Route Handlers that the browser calls (e.g. `/api/xrouter/models`, `/api/xrouter/usage`). They run server-side, call the adapter, and return JSON — keeping the admin key off the client.
- **Webhook receiver** (`src/app/api/webhooks/xrouter/route.ts`): endpoint X-Router posts usage/credit events to; verifies a shared secret, dedupes by event id (idempotency), logs/accrues (mock store for now).
- **Wire console reads**: marketplace + usage pages fetch via the API routes so they show live data when `XROUTER_ENABLED=true`, mock otherwise — no UI change needed when flipping the flag.

## Capabilities

### New Capabilities
- `xrouter-integration`: The Foza-side integration layer for X-Router — server-side HTTP client, feature-flagged adapter with mock fallback, API route handlers (browser → Foza → X-Router), and the webhook receiver for usage/credit events. Implements the command/event contract from `integration-contract`.

### Modified Capabilities
<!-- frontend-auth's mock provider remains; later it can route through this adapter, but no spec change is required now. -->

## Impact

- **New env**: `XROUTER_URL` (default `http://localhost:8080`), `XROUTER_ADMIN_KEY`, `XROUTER_INTERNAL_KEY` (for end-user LLM calls), `XROUTER_ENABLED` (default `false`), `XROUTER_WEBHOOK_SECRET`.
- **New code**: `src/lib/xrouter/{config,client,adapter,mock,types}.ts`, `src/app/api/xrouter/**`, `src/app/api/webhooks/xrouter/route.ts`.
- **Edited**: console marketplace + usage pages to read from API routes; `.env.example`.
- **No coupling to X-Router repo**: integration is purely over HTTP via env-configured URL. The two projects stay in separate folders/repos.
- **Endpoints consumed** (already present in X-Router): `GET /v1/models`, `GET /v1/pricing`, `GET /v1/public/models`, `POST/GET /admin/v1/api-keys`, `GET /admin/v1/accounts/:id/quota`, `GET /admin/v1/usage`, `GET /admin/v1/spend/key/:id`, `PUT /admin/v1/webhooks`.
- **Gaps deferred to X-Router build**: `plan` assignment, `seller credit/payout`, per-seller pricing commands — adapter exposes these as mock-only until the endpoints exist; flipping individual methods to live is incremental.
- **Risk**: low while flag is off (mock path unchanged). Live path risk = network/timeouts/shape drift, contained by graceful fallback + typed parsing.
