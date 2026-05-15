# Testing

## Gateway

Run from `apps/gateway`:

```powershell
rtk npm run typecheck
rtk npm test
rtk npm run build
rtk npm audit --audit-level=high
```

Current expected baseline:

- 22 test files.
- 75 tests.

Important test groups:

- `auth.test.ts`
- `adminRoutes.test.ts`
- `openaiRoute.test.ts`
- `anthropicRoute.test.ts`
- `streamingRoute.test.ts`
- `phase8Fallback.test.ts`
- `phase13Observability.test.ts`
- `persistence.test.ts`

## Dashboard

Run from `apps/dashboard`:

```powershell
rtk npm run build
rtk npm audit --audit-level=high
```

## Manual Smoke Checks

Start gateway and dashboard, then run:

```powershell
rtk node -e "fetch('http://127.0.0.1:8080/healthz').then(async r=>console.log(r.status, await r.text()))"
rtk node -e "fetch('http://127.0.0.1:8080/v1/models',{headers:{authorization:'Bearer dev-key-1'}}).then(async r=>console.log(r.status, await r.text()))"
rtk node -e "fetch('http://127.0.0.1:8080/admin/v1/provider-types',{headers:{authorization:'Bearer admin-key-1'}}).then(async r=>console.log(r.status, await r.text()))"
```

Expected:

- `/healthz` returns `200`.
- `/v1/models` with internal key returns `200`.
- `/admin/v1/provider-types` with admin key returns `200`.

## Persistence Smoke Test

1. Start gateway with `DATA_FILE=data/gateway-state.json`.
2. Create an API key or provider instance from dashboard.
3. Stop gateway.
4. Start gateway again.
5. Confirm the created object is still visible.
6. If an API key was created, confirm the saved raw key still works.

## Browser Smoke Test

Dashboard URL:

```text
http://127.0.0.1:3000
```

Check:

- Overview loads without error.
- Provider catalog shows `mock`, `kiro`, and `windsurf`.
- API Keys page can create a key.
- Playground can call a configured model/profile with an internal API key.
- Accounts page can run **Test** for an active account.
- Settings can validate and publish a config revision.

## Provider Account Test

Use the admin endpoint when the dashboard result is not enough:

```powershell
rtk node -e "fetch('http://127.0.0.1:8080/admin/v1/accounts/<account-id>/test',{method:'POST',headers:{authorization:'Bearer admin-key-1','content-type':'application/json'},body:JSON.stringify({model:'kiro-sonnet',prompt:'Health check. Reply ok.',maxTokens:32})}).then(async r=>console.log(r.status, await r.text()))"
```

Expected for a working Kiro local account:

- `ok: true`
- `publicModel: kiro-sonnet`
- `upstreamModel: claude-sonnet-4.5`

Windsurf local import can create an account. Use a Cascade model UID such as
`claude-sonnet-4-6-thinking`, not legacy `sonnet`. Native chat now reaches the
Connect-RPC endpoint; if it returns upstream `invalid_argument`, the account is
imported but the exact Cascade chat payload still needs adjustment.
