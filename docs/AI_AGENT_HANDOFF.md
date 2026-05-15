# AI Agent Handoff

Use this file before continuing implementation.

## Read First

1. `docs/CURRENT_STATUS.md`
2. `docs/ARCHITECTURE.md`
3. `docs/API_REFERENCE.md`
4. `docs/DASHBOARD.md`
5. `PLAN.md`

## Current Code Reality

The repository is beyond Phase 1. Do not follow old instructions that say
"Phase 1 only". Current work should continue from the roadmap in `PLAN.md`.

## Current Best Next Task

Implement internal rate limit and quota:

- Add config values.
- Add service.
- Enforce on `/v1/models`, `/v1/chat/completions`, and `/v1/messages`.
- Return stable `429` errors.
- Add tests.
- Add dashboard visibility if possible.

## Command Rules

The workspace instruction requires `rtk` before shell commands.

Examples:

```powershell
rtk rg "createAuthMiddleware" apps/gateway/src
rtk npm test
rtk npm run build
```

## Editing Rules

- Use `apply_patch` for source/doc edits.
- Do not overwrite real secrets.
- Do not delete user-created data files unless explicitly requested.
- Do not revert unrelated changes.

## Verification Before Final Response

At minimum:

```powershell
cd apps/gateway
rtk npm run typecheck
rtk npm test

cd ../dashboard
rtk npm run build
```

If dependencies or security-relevant code changed:

```powershell
rtk npm audit --audit-level=high
```

## Known Pitfalls

- `README.md` is a product requirements document, not an implementation status
  document.
- `PLAN.md` is the current implementation roadmap.
- Dashboard-created API keys return raw key only once.
- API key hashes are persisted; raw keys are not.
- Usage, request logs, and audit logs are currently in memory.
- JSON persistence is MVP local persistence, not production-grade storage.
