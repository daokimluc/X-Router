# Current Status

Last reviewed: 2026-05-13.

## Implemented

### Gateway

- Fastify TypeScript gateway.
- Public liveness route: `GET /healthz`.
- Authenticated readiness route: `GET /readyz`.
- Prometheus metrics route: `GET /metrics`.
- OpenAI-compatible route: `POST /v1/chat/completions`.
- Anthropic-compatible route: `POST /v1/messages`.
- Model listing: `GET /v1/models`.
- Request ID middleware.
- Redacted logging.
- Central error handler.
- Request body limit.
- Internal API key auth.
- Admin API key auth.
- Per-key request rate limit.
- Per-key daily request quota.

### Provider Core

- Provider adapter registry.
- Provider type definitions.
- Provider instances.
- Model registry.
- Routing profile registry.
- Model resolver and capability matching.
- Account pool.
- Round-robin, weighted round-robin, and least-busy selection.
- Provider fallback.
- Circuit breaker.
- Concurrency limiter.
- Secret encryption service.
- Kiro adapter.
- Windsurf adapter.
- Mock adapter for tests.

### Admin API

- Provider catalog.
- Provider instance list/create/update.
- Account list/create/update/enable/disable/credential rotation.
- Model mapping list/create/update.
- Routing profile list/create/update.
- Internal API key list/create/enable/disable.
- Usage list.
- Request log list.
- Audit log list.
- Config current/list revisions/validate/publish/rollback.

### Dashboard

- Overview.
- Provider catalog.
- Provider instances.
- Accounts and credential rotation.
- Model registry.
- Routing profiles.
- API keys.
- CLI tool snippets.
- Playground.
- Usage table.
- Request logs table.
- Audit logs table.
- Settings/config revisions.

### Persistence

Runtime control-plane state is persisted to JSON:

- Provider instances.
- Accounts.
- Model mappings.
- Routing profiles.
- Internal API key hashes.
- Encrypted provider secrets.
- Current config.
- Config revisions.

Default path:

```text
data/gateway-state.json
```

Docker path:

```text
/app/data/gateway-state.json
```

## Not Yet Implemented

These are known gaps.

- Per-key request rate limit is implemented.
- Per-key daily request quota is implemented.
- Team/workspace quota is not implemented.
- Usage cost/pricing calculation.
- Persistent usage/request/audit logs.
- Pagination/filtering/export for usage and logs.
- Full dashboard edit forms for every field.
- Provider onboarding wizard.
- Streaming UI in Playground.
- Admin RBAC/user login.
- SQLite/Postgres persistence.
- Docker runtime verification on a machine with Docker CLI available.

## Current Verification Baseline

Expected passing checks:

```powershell
cd apps/gateway
rtk npm run typecheck
rtk npm test
rtk npm run build
rtk npm audit --audit-level=high

cd ../dashboard
rtk npm run build
rtk npm audit --audit-level=high
```

Latest known baseline:

- Gateway tests: 22 files, 75 tests.
- Gateway typecheck: passing.
- Gateway build: passing.
- Dashboard build: passing.
- High-severity npm audit: clean for both apps.
