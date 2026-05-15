# Security Checklist

This project is an internal gateway. Do not expose it to the public internet without hardening.

## Current MVP Controls

- `/healthz` returns minimal public liveness data only.
- `/readyz`, `/metrics`, `/v1/models`, `/v1/chat/completions`, `/v1/messages` require internal or admin auth as appropriate.
- `/admin/v1/*` requires admin API key.
- Raw internal/admin API keys are not returned by admin endpoints.
- Account credential references are redacted in admin account responses.
- Request logging redacts authorization, cookies, API keys, tokens and session values.
- Prompt/completion bodies are not logged by gateway middleware.
- Real `.env` and `secrets/*.json` are ignored by git and Docker context rules.
- Reference repositories are not runtime dependencies or sidecar services.
- Docker images do not copy `.env` or real secret files.

## Required Before Public Exposure

- HTTPS/TLS termination.
- Strong generated internal and admin API keys.
- Admin RBAC and user login.
- IP allowlist or private network binding.
- CORS allowlist.
- Persistent audit log storage.
- Secret manager or encrypted secret backend.
- Redis-backed distributed rate/concurrency state if running multiple gateway instances.
- Dependency vulnerability scanning in CI.
- Backup/restore process for config revisions and audit logs.
- Monitoring and alerting on `/metrics`.

## Secret Handling

- Keep real provider credentials in `secrets/provider-accounts.json` or a secret manager.
- Do not commit `.env`.
- Do not commit `secrets/*.json`.
- Only commit `*.example.json` files with placeholder values.

