# Roadmap

## Completed MVP Capabilities

- Gateway skeleton.
- Auth and redacted logging.
- Provider adapter core.
- Mock provider.
- Kiro provider adapter.
- Windsurf provider adapter.
- Account pool.
- Model registry.
- Routing profiles.
- OpenAI-compatible chat completions.
- Anthropic-compatible messages.
- Streaming response support.
- Provider fallback.
- Circuit breaker.
- Concurrency guard.
- Admin API.
- Dashboard.
- Metrics and readiness.
- Usage and request log metadata.
- Config revisions.
- JSON persistence.
- Docker Compose files.

## Next Priority

### 1. Team/Workspace Quota

Per-key request rate limit and daily request quota are implemented. Remaining
quota work:

- Team/workspace quota.
- Token-based daily quota.
- Persistent quota counters.

### 2. Persist Operational Logs

Persist:

- Usage records.
- Request logs.
- Audit logs.

JSON file can be extended for MVP, but SQLite is a better next step.

### 3. Dashboard CRUD Completeness

Add:

- Full provider config edit.
- Full account metadata edit.
- Full model mapping edit.
- Full routing profile edit.
- Delete/archive flows.
- Confirmation dialogs.

### 4. Provider Onboarding Wizard

Add a guided flow:

1. Pick provider type.
2. Enter provider instance metadata.
3. Add credential.
4. Validate credential.
5. Create default model mapping.
6. Add provider to routing profile.
7. Copy CLI config.

### 5. Playground Upgrade

Add:

- Streaming UI.
- Anthropic mode.
- Temperature/max token controls.
- Raw JSON request/response view.

## Production Hardening

- Replace development encryption key with env or KMS-backed key.
- Add admin user login or RBAC.
- Add CORS allowlist.
- Add TLS/private network guidance.
- Add backup/restore.
- Add CI.
- Add Docker runtime verification in CI.
- Move distributed counters to Redis if multiple gateway instances are used.

## Later Provider Phases

Do not start these until Kiro/Windsurf MVP behavior is stable:

- OpenAI-compatible external provider.
- Anthropic-compatible external provider.
- OpenRouter.
- Gemini.
- Azure OpenAI.
- AWS Bedrock.
- Local OpenAI-compatible server.
- Custom HTTP provider.
