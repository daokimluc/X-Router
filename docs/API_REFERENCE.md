# API Reference

## Public

### `GET /`

Returns gateway index metadata.

### `GET /healthz`

No auth required.

Response:

```json
{
  "status": "ok"
}
```

## Internal API

Auth:

```http
Authorization: Bearer <internal-api-key>
```

### `GET /v1/models`

Returns OpenAI-compatible model list. Includes enabled direct model mappings and
enabled routing profiles.

### `POST /v1/chat/completions`

OpenAI-compatible chat completions endpoint.

Required body:

```json
{
  "model": "coding",
  "messages": [
    { "role": "user", "content": "Hello" }
  ]
}
```

Streaming is supported with:

```json
{
  "stream": true
}
```

### `POST /v1/messages`

Anthropic-compatible messages endpoint.

Required body:

```json
{
  "model": "coding",
  "max_tokens": 1024,
  "messages": [
    { "role": "user", "content": "Hello" }
  ]
}
```

## Observability

Auth: internal or admin API key.

### `GET /readyz`

Returns readiness checks for provider registry, provider runtime, and model
registry.

### `GET /metrics`

Returns Prometheus text metrics.

## Admin API

Auth:

```http
Authorization: Bearer <admin-api-key>
```

### Provider Types

- `GET /admin/v1/provider-types`

### Provider Instances

- `GET /admin/v1/provider-instances`
- `POST /admin/v1/provider-instances`
- `PATCH /admin/v1/provider-instances/:id`

Create body:

```json
{
  "id": "provider_kiro_extra",
  "type": "kiro",
  "name": "Kiro Extra",
  "enabled": true,
  "accountSelectionStrategy": "round_robin"
}
```

### Accounts

- `GET /admin/v1/accounts`
- `POST /admin/v1/accounts`
- `PATCH /admin/v1/accounts/:id`
- `POST /admin/v1/accounts/:id/enable`
- `POST /admin/v1/accounts/:id/disable`
- `POST /admin/v1/accounts/:id/credential`

Create body:

```json
{
  "id": "account_kiro_1",
  "providerInstanceId": "provider_kiro_main",
  "displayName": "Kiro Account 1",
  "credentialType": "api_key",
  "credentialPayload": {
    "apiKey": "replace-me"
  },
  "maxConcurrency": 3
}
```

Admin account responses redact `credentialRef`.

### Model Mappings

- `GET /admin/v1/model-mappings`
- `POST /admin/v1/model-mappings`
- `PATCH /admin/v1/model-mappings/:id`

Create body:

```json
{
  "id": "model_kiro_custom",
  "publicModel": "kiro-custom",
  "providerInstanceId": "provider_kiro_main",
  "providerType": "kiro",
  "upstreamModel": "sonnet",
  "capabilities": ["chat", "streaming"]
}
```

### Routing Profiles

- `GET /admin/v1/routing-profiles`
- `POST /admin/v1/routing-profiles`
- `PATCH /admin/v1/routing-profiles/:id`

Create body:

```json
{
  "id": "custom",
  "displayName": "Custom",
  "candidates": ["kiro-sonnet", "windsurf-sonnet"],
  "fallback": true,
  "requiredCapabilities": ["chat"]
}
```

### API Keys

- `GET /admin/v1/api-keys`
- `POST /admin/v1/api-keys`
- `POST /admin/v1/api-keys/:id/enable`
- `POST /admin/v1/api-keys/:id/disable`

Create body:

```json
{
  "owner": "developer"
}
```

The create response returns the raw key once. List responses return hashes only.

### Usage, Logs, Audit

- `GET /admin/v1/usage`
- `GET /admin/v1/request-logs`
- `GET /admin/v1/audit-logs`

### Config Revisions

- `GET /admin/v1/config/current`
- `GET /admin/v1/config/revisions`
- `POST /admin/v1/config/validate`
- `POST /admin/v1/config/publish`
- `POST /admin/v1/config/revisions/:id/rollback`

Publish body:

```json
{
  "config": {
    "routingMode": "default"
  }
}
```

## Error Codes

Common errors:

- `invalid_api_key`
- `invalid_admin_api_key`
- `payload_too_large`
- `internal_rate_limit_exceeded`
- `internal_quota_exceeded`
- `no_available_account`
- `provider_rate_limited`
- `provider_auth_error`
- `config_revision_not_found`
- `internal_error`

`internal_rate_limit_exceeded` and `internal_quota_exceeded` return HTTP `429`.
