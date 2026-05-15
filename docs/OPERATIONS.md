# Operations

## Local Development

Gateway:

```powershell
cd apps/gateway
rtk npm install
rtk npm run dev
```

Dashboard:

```powershell
cd apps/dashboard
rtk npm install
rtk npm run dev
```

URLs:

- Gateway: `http://127.0.0.1:8080`
- Dashboard: `http://127.0.0.1:3000`

## Environment

`.env.example`:

```env
NODE_ENV=development
PORT=8080
HOST=0.0.0.0
INTERNAL_API_KEYS=dev-key-1,dev-key-2
ADMIN_API_KEYS=admin-key-1
REQUEST_BODY_LIMIT=1mb
DATA_FILE=data/gateway-state.json
INTERNAL_RATE_LIMIT_PER_MINUTE=0
INTERNAL_DAILY_REQUEST_QUOTA=0
LOG_LEVEL=info
```

`INTERNAL_RATE_LIMIT_PER_MINUTE=0` disables per-minute limiting.
`INTERNAL_DAILY_REQUEST_QUOTA=0` disables daily request quota enforcement.

## Persistence

The gateway persists control-plane state to `DATA_FILE`.

Default:

```text
data/gateway-state.json
```

Persisted:

- Provider instances.
- Accounts.
- Model mappings.
- Routing profiles.
- API key hashes.
- Encrypted provider secrets.
- Current config.
- Config revisions.

Not persisted yet:

- Usage records.
- Request logs.
- Audit logs.
- Metrics counters.

## Secrets

Do not commit real credentials.

Allowed in git:

- `secrets/provider-accounts.example.json`

Not allowed in git:

- `.env`
- `secrets/*.json`
- `data/gateway-state.json`

Provider credentials submitted through the dashboard are encrypted before being
persisted. The current local encryption key is development-oriented and should
be replaced with an env-provided key or secret manager before production use.

## Docker

See `DOCKER.md`.

Compose persists state through:

```text
./data:/app/data
DATA_FILE=/app/data/gateway-state.json
```

## Verification

Gateway:

```powershell
cd apps/gateway
rtk npm run typecheck
rtk npm test
rtk npm run build
rtk npm audit --audit-level=high
```

Dashboard:

```powershell
cd apps/dashboard
rtk npm run build
rtk npm audit --audit-level=high
```

Smoke checks:

```powershell
rtk node -e "fetch('http://127.0.0.1:8080/healthz').then(async r=>console.log(r.status, await r.text()))"
rtk node -e "fetch('http://127.0.0.1:8080/v1/models',{headers:{authorization:'Bearer dev-key-1'}}).then(async r=>console.log(r.status, await r.text()))"
```

## Restart Behavior

After restart, persisted control-plane state should survive:

- Dashboard-created provider instances.
- Dashboard-created accounts.
- Dashboard-created model mappings.
- Dashboard-created routing profiles.
- Dashboard-created internal API key hashes.
- Config revisions.

The raw value of a dashboard-created API key is not persisted. Its hash is
persisted, and the original raw key remains valid if the caller saved it.
