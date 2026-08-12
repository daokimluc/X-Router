# Tasks — xrouter-resilience

## 1. 429-aware retry in client
- [x] 1.1 `client.ts` — detect `429` + read `retry-after`; wait then retry with
      capped exponential backoff + max-attempts bound
- [x] 1.2 After the cap, throw a typed `XRouterRateLimitError` callers can map to a
      friendly message
- [x] 1.3 Be deliberate about which calls retry (respect idempotency; topup/grant
      are safe to retry only if not already applied — prefer surfacing over blind
      retry where ambiguous)

## 2. Liveness-aware reads
- [x] 2.1 Small `health.ts` — `GET /healthz` (no auth) liveness check
- [x] 2.2 Console surfaces "gateway unreachable" instead of bare errors when
      /healthz fails; note `/readyz` (needs key) for readiness

## 3. Reconcile backoff
- [x] 3.1 `reconcile.ts` uses the same backoff so a 429 mid-replay doesn't abort

## 4. Rotation runbook
- [x] 4.1 Document no-downtime provision-key rotation (`PROVISION_API_KEYS=old,new`
      → switch Foza `XROUTER_PROVISION_KEY` → drop old)
- [x] 4.2 Note recommended prod `PROVISION_RATE_LIMIT_PER_MINUTE` (300–600) + the
      temporary raise for migration windows

## 5. Verify
- [x] 5.1 `npx tsc --noEmit` + `npm run build` pass
- [x] 5.2 Simulated 429 → client backs off per retry-after and eventually succeeds;
      past the cap → typed error surfaced
- [x] 5.3 /healthz down → console shows unreachable state, no unhandled throw
- [x] 5.4 Rotation runbook validated against a two-key window (old+new both accepted)
