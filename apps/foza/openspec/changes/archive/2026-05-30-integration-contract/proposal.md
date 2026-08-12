## Why

Foza (the website: marketing + end-user console) and X-Router (`@daokimluc/x-router`, the self-hosted AI gateway) are two independently-owned systems that must cooperate to deliver a working marketplace. Today there is no written contract for how they exchange data, which would force ad-hoc decisions during integration and risk billing/payout errors (double-charging, missed usage, reconciliation drift).

This change captures the **integration contract** as a specification — not implementation code. It records the architectural decisions reached during exploration so that, when the user finishes adding X-Router endpoints and integration begins (`integrate-xrouter`), both sides build to the same agreed shape. It is the system-of-record for *who owns what* and *what messages cross the boundary*.

## What Changes

This change introduces specification only (no code). It documents:

- **Roles & system-of-record boundaries**: Foza owns identity, the real-money ledger, plan catalog, invoices, and payouts. X-Router owns routing, usage metering, quota execution, and provider-account pooling.
- **Wallet model = Hybrid (Model C)**: Foza holds real money and grants spendable *quota* to X-Router; X-Router decrements quota, blocks at zero, and emits usage events; Foza reconciles against its ledger.
- **Direction 1 — Commands (Website → X-Router)**: create wallet / grant quota, assign plan, register seller source + pricing, set price.
- **Direction 2 — Events (X-Router → Website)**: usage consumed ($X for user/model/tokens), seller credit ($Y) → Foza issues invoices and computes payouts.
- **Cross-cutting guarantees**: idempotency (event IDs, dedupe), reconciliation (granted-quota vs received-events), seller attribution in event payloads, and event granularity.

## Capabilities

### New Capabilities
- `integration-contract`: The bidirectional contract between Foza and X-Router — system-of-record boundaries, the Hybrid wallet model, the command set (website→gateway), the event set (gateway→website), and the cross-cutting guarantees (idempotency, reconciliation, seller attribution) that keep billing and payout correct.

### Modified Capabilities
<!-- None — specification-only change; no existing spec behavior changes. -->

## Impact

- **Affected systems**: Foza (`XRouter.ai/`) and X-Router (`../Accountrouter/`). This change lives in Foza's OpenSpec but describes a shared boundary; relevant requirements may later be mirrored into X-Router's own specs.
- **X-Router foundation already present** (observed in `apps/gateway/src`): `AccountQuotaService` (balance/quota), `WebhookService` (event channel), `ApiKeyService`, `routes/providerAccounts.ts` (seller sources), `routes/oauth.ts` (auth).
- **Gaps the user will fill** (new X-Router endpoints): `plan` concept, `seller credit`/`payout` accounting, per-seller pricing, and the concrete command/event payloads.
- **No code impact in this change**: documentation/spec only. Implementation is deferred to `integrate-xrouter`.
- **Depends on**: nothing to author; consumed by `frontend-auth` (identity boundary) and `integrate-xrouter` (full wiring).
