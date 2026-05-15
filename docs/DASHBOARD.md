# Dashboard Guide

URL in local development:

```text
http://127.0.0.1:3000
```

Default admin key for local development:

```text
admin-key-1
```

The dashboard stores the admin key in browser local storage under
`gateway.adminKey`.

## Pages

### Overview

Shows counts for provider types, provider instances, active accounts, and
disabled accounts.

### Provider Catalog

Read-only list of registered provider adapter types.

Currently registered:

- `mock`
- `kiro`
- `windsurf`

### Provider Instances

Supported actions:

- Create provider instance.
- Enable/disable provider instance.

### Accounts

Supported actions:

- Create account.
- Enable/disable account.
- Rotate credential.
- Import local Kiro session.
- Import local Windsurf session from Cockpit/Windsurf account cache.
- Test a single account with the mapped provider model.

Credential JSON is sent to the admin API and stored encrypted by the gateway.
The dashboard does not display raw credential values after submission.

Use **Test** on an account before debugging routing profiles. A passing test
means the account credential, provider instance, model mapping, and adapter can
produce a non-streaming response. A failing test returns the provider error and
the exact public/upstream model pair used.

Current provider status:

- Kiro local session import and `kiro-sonnet` requests are functional.
- Windsurf local session import is functional. The adapter now targets the
  native Windsurf/Codeium Connect-RPC endpoint and the default model mapping
  uses the Cascade model UID `claude-sonnet-4-6-thinking` instead of legacy
  `sonnet`. Model discovery works; chat still returns upstream
  `invalid_argument` until the exact native Cascade request shape is finalized.

### Model Registry

Supported actions:

- Create model mapping.
- Enable/disable model mapping.
- Apply provider-specific presets.
- Copy public model names for client configuration.

`Public Model` is the model name clients call through the gateway.
`Upstream Model` is the provider-specific model identifier sent by the adapter.
For Kiro, prefer `claude-sonnet-4.5` rather than legacy `sonnet`.

### Routing Profiles

Supported actions:

- Create routing profile.
- Enable/disable routing profile.

### API Keys

Supported actions:

- Create internal API key.
- Enable/disable internal API key.
- View per-minute request counter and daily request quota counter.

The raw key is shown only once after creation. Store it externally if needed.

### CLI Tools

Shows copyable snippets for OpenAI-compatible and Anthropic-compatible clients.

### Playground

Sends a non-streaming OpenAI-compatible request to `/v1/chat/completions`.

Current limitations:

- No streaming UI.
- No Anthropic mode.
- No advanced request options.

### Usage

Shows in-memory usage records created from non-streaming provider responses.

Current limitations:

- No persistence.
- No cost/pricing.
- No filtering or export.

### Request Logs

Shows in-memory request metadata.

Current limitations:

- No persistence.
- No filtering or export.
- No prompt/completion content by design.

### Audit Logs

Shows admin audit events.

Current limitations:

- No persistence.
- No filtering or export.

### Settings

Supported actions:

- View current config.
- Validate draft config JSON.
- Publish config revision.
- Roll back to a previous revision.

Config revisions are persisted in `DATA_FILE`.

## Known UX Gaps

- Provider onboarding wizard is not implemented.
- Editing all fields is not implemented.
- Delete/archive workflows are not implemented.
- Confirmation dialogs are not implemented.
- Usage/log filtering and pagination are not implemented.
