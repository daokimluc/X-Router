# Architecture

## Runtime Shape

```text
Client / IDE / Dashboard
  -> Compatibility API
  -> Auth middleware
  -> Request validation
  -> ModelResolver
  -> ProviderAdapterRegistry
  -> Provider adapter
  -> AccountPool
  -> Provider client
  -> Upstream provider
```

## Main Applications

```text
apps/gateway
  Fastify API, routing, provider adapters, admin API, persistence.

apps/dashboard
  React/Vite admin control plane.
```

## Gateway Modules

### Routes

- `src/routes/root.ts`
- `src/routes/healthz.ts`
- `src/routes/readyz.ts`
- `src/routes/metrics.ts`
- `src/routes/models.ts`
- `src/routes/openai.ts`
- `src/routes/anthropic.ts`
- `src/routes/admin.ts`

### Middleware

- `src/middleware/auth.ts`
- `src/middleware/adminAuth.ts`
- `src/middleware/requestId.ts`
- `src/middleware/logger.ts`
- `src/middleware/errorHandler.ts`

### Provider Layer

- `src/providers/base/*`
- `src/providers/registry/*`
- `src/providers/adapters/mock/*`
- `src/providers/adapters/kiro/*`
- `src/providers/adapters/windsurf/*`

Gateway core must not import provider-specific behavior directly except through
adapter registration.

### Routing Layer

- `src/router/ModelRegistry.ts`
- `src/router/RoutingProfileRegistry.ts`
- `src/router/ModelResolver.ts`
- `src/router/CapabilityMatcher.ts`

Public model resolution supports two modes:

- Direct public model mapping, for example `kiro-sonnet`.
- Routing profile, for example `coding`, `fast`, `balanced`.

### Account Pool

- `src/account-pool/AccountPool.ts`
- `src/account-pool/RoundRobinStrategy.ts`
- `src/account-pool/WeightedRoundRobinStrategy.ts`
- `src/account-pool/LeastBusyStrategy.ts`
- `src/account-pool/strategyFactory.ts`

Account pools are per provider instance.

### Services

- `ApiKeyService`
- `SecretService`
- `LocalEncryptionService`
- `CircuitBreaker`
- `ConcurrencyLimiter`
- `MetricsService`
- `RequestLogService`
- `UsageService`
- `AdminAuditService`
- `ConfigRevisionService`
- `PersistenceService`

## Persistence Model

`PersistenceService` stores control-plane state as a JSON document. It is loaded
when the app is built and saved after successful mutating admin requests.

Persisted state includes:

- Provider instances.
- Accounts.
- Model mappings.
- Routing profiles.
- API key hashes.
- Encrypted secrets.
- Current config.
- Config revisions.

It does not currently persist:

- Request logs.
- Usage records.
- Audit logs.
- Metrics counters.
- Rate-limit counters.

## Dashboard Shape

The dashboard is currently a single React app in `src/App.tsx` with shared CSS in
`src/styles.css`. It talks to the gateway through Vite dev proxy:

- `/admin` -> `http://127.0.0.1:8080`
- `/v1` -> `http://127.0.0.1:8080`
- `/healthz` -> `http://127.0.0.1:8080`

## Security Boundary

- `/healthz` is public.
- `/readyz` and `/metrics` allow internal or admin API keys.
- `/v1/*` allows internal API keys, including dynamically created keys.
- `/admin/v1/*` allows admin API keys only.

Raw secrets and raw API keys must not be returned after creation. The only
exception is the one-time raw internal API key returned by `POST /admin/v1/api-keys`.
