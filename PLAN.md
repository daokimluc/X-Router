# Implementation Plan

This file reflects the current implementation state of the repository. The
original product requirements remain in `README.md`; implementation-specific
details live in `docs/`.

## Current Status

The project has passed the original skeleton phase and now contains:

- Fastify gateway with OpenAI-compatible and Anthropic-compatible endpoints.
- Provider adapter core plus mock, Kiro, and Windsurf adapters.
- Model registry, routing profiles, fallback, circuit breaker, concurrency guard.
- Account pool with round-robin, weighted round-robin, and least-busy strategies.
- Admin API for provider instances, accounts, credentials, models, profiles,
  API keys, audit logs, usage, request logs, metrics, and config revisions.
- React/Vite dashboard for control-plane workflows.
- JSON-file persistence for runtime control-plane state.
- Docker Compose for local gateway/dashboard runtime.

## Ground Rules For Future Agents

- Use `rtk` before shell commands.
- Keep gateway core provider-agnostic.
- Do not introduce real secrets into git.
- Do not log prompts, source code, completions, authorization headers, cookies,
  provider tokens, refresh tokens, session cookies, or raw credentials.
- Do not use `kiro-gateway` or `WindsurfAPI` as runtime dependencies.
- Preserve compatibility with OpenAI `/v1/chat/completions` and Anthropic
  `/v1/messages`.
- Prefer small, test-backed phases.

## Immediate Next Phase

### Phase 15: Internal Rate Limit And Quota

Goal: enforce internal API usage limits before the gateway is used by a team.

Completed:

- Config for per-key request rate limit.
- Config for daily per-key request quota.
- In-memory counters by internal API key hash.
- `429` with stable error codes:
  - `internal_rate_limit_exceeded`
  - `internal_quota_exceeded`
- Admin endpoints excluded from normal internal quota.
- API Keys dashboard page shows per-minute and daily counters.

Remaining:

- Token-based quota.
- Team/workspace quota.
- Persistent quota counters.
- Clear quota-exhausted status styling.

Acceptance:

- `npm run typecheck` passes in `apps/gateway`.
- `npm test` passes in `apps/gateway`.
- `npm run build` passes in `apps/dashboard`.
- Requests over the configured limit return `429`.

## Follow-Up Phases

### Phase 16: Usage And Logs UX

- Add filtering by route, status, model, provider, account, and API key hash.
- Add pagination or "last N" controls.
- Add CSV/JSON export.
- Add basic daily aggregates.

### Phase 17: Dashboard CRUD Completeness

- Edit provider config from dashboard.
- Edit account owner/tags/allowed models/max concurrency.
- Edit routing profile candidates with structured controls.
- Add archive/delete where safe.
- Add confirmation dialogs for destructive actions.

### Phase 18: Provider Onboarding Wizard

- Guided setup for Kiro and Windsurf.
- Credential validation test.
- Account creation with owner metadata.
- Default model mapping and routing profile creation.
- CLI config copy step.

### Phase 19: Production Persistence

- Replace JSON persistence with SQLite or Postgres.
- Persist audit logs, request logs, usage records, and rate-limit counters.
- Add backup/restore workflow.
- Add migration/versioning story.

### Phase 20: Security Hardening

- Strong default key generation guidance.
- Admin user login or RBAC.
- IP allowlist or private network binding guidance.
- CORS allowlist if dashboard is served separately.
- Secret manager integration option.

## Verification Commands

Gateway:

```powershell
rtk npm run typecheck
rtk npm test
rtk npm run build
rtk npm audit --audit-level=high
```

Dashboard:

```powershell
rtk npm run build
rtk npm audit --audit-level=high
```

Manual local URLs:

- Gateway: `http://127.0.0.1:8080`
- Dashboard: `http://127.0.0.1:3000`
