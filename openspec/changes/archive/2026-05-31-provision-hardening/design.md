## Context

`provisionAuth.ts` is a flat `Set.has(token)` check; the context carries only an
`apiKeyHash` for audit, no tenant claim. All `/provision/*` routes use only that
preHandler — no rate limit (the engine `RateLimitService` is wired only into the
`/v1` client-auth path). `WebhookService.getBusinessConfig()` returns the real
secret, and the persistence contributor serializes it verbatim → plaintext in the
state file (provider credentials, by contrast, go through `SecretService`
encryption). `markPaid` accepts a `payoutRef` in the route body but never passes
it to the ledger. Provision and admin have drifted: provision top-up/mark-paid use
`{ usd }`, admin uses `{ amountUsd }`.

## Goals / Non-Goals

**Goals:**
- No plaintext webhook secret at rest.
- The tenant-isolation trust boundary is written down as a security requirement.
- A throughput ceiling on the most damaging provision mutations.
- Remove the `payoutRef`-dropped and field-name-drift contract bugs.
- Document key rotation for a leaked provision key.

**Non-Goals:**
- Per-tenant provision keys / scoped tokens (a larger redesign) — out of scope;
  the model stays "one trusted website key". We harden + document it, not redesign.
- Encrypting all of buyer wallet/earnings (those aren't secrets; they're data the
  website is authorized to read). Only the webhook *secret* is a credential.
- Changing the god-mode nature of the provision key — that's inherent to the
  trusted-control-plane design; we reduce blast-radius levers (rate limit, rotation)
  and document the trust, not eliminate the privilege.

## Decisions

### Encrypt the webhook secret via SecretService
On save, the business-webhook secret is encrypted with the existing
`LocalEncryptionService`/`SecretService` and the persisted slice holds ciphertext;
on use (`notifyBusiness` HMAC), it's decrypted in memory. GET stays masked. First
load of an existing plaintext secret migrates it to ciphertext transparently. This
removes the one credential currently written plaintext to the state file.

### Document the trust model (the most important deliverable)
Add to `docs/MARKETPLACE_INTEGRATION.md` a "Security model" section stating
plainly:
- x-router performs **no buyer/seller isolation**; `/provision/*` accepts any
  `keyId`/`sellerId`. The **website MUST** substitute only the authenticated
  end-user's identifiers — a mis-scoped call leaks one tenant's data to another.
- The provision key is **god-mode** and **MUST** be held server-side only, never
  exposed to a browser/buyer.
- The website **MUST** verify the webhook `X-Provision-Signature` HMAC over the raw
  body before trusting an event.
- A threat-model summary (what a leaked provision key grants) so operators size the
  risk.
This converts load-bearing assumptions from folklore into a contract.

### Rate-limit privileged provision routes
Attach the engine `RateLimitService` (or a small dedicated limiter) to the
mutating, money-touching routes: `POST /provision/key`, `/provision/wallet/topup`,
`/provision/grant`, `/provision/earnings/:id/mark-paid`. A sane default cap
(per-minute), configurable; reads + the rest stay unthrottled. This bounds abuse
of a leaked key without hurting normal website traffic.

### Multiple provision keys + rotation
`provisionApiKeys` is already an array. Document + support carrying two keys during
a rotation (add new, deploy, switch website to new, remove old) so a suspected leak
can be rotated with zero downtime. `bin/x-router.js --set-provision-key` already
exists; extend docs (and optionally an `--add`/`--remove` variant).

### Fix the contract drift
- Persist `payoutRef` on the payout record (`payouts` table from
  `persistence-sqlite`) so mark-paid's reference isn't dropped.
- Align field names: accept BOTH `usd` and `amountUsd` on the topup/mark-paid
  routes (provision + admin) during a deprecation window; document the canonical
  one (`usd`). Align audit action vocab.

## Risks / Trade-offs

- **Secret migration.** A botched plaintext→ciphertext migration could break webhook
  signing. Mitigation: migrate on load behind a flag, keep the ability to re-set the
  secret via PUT, test the round-trip (encrypt→persist→reload→decrypt→sign matches).
- **Rate limit could throttle a legitimate burst** (e.g. bulk key provisioning at
  launch). Mitigation: generous default, configurable, and scoped to the
  money-touching routes only; document how to raise it for migrations.
- **Documentation-as-deliverable is easy to under-do.** Mitigation: treat the trust
  section as a required artifact with a threat-model table, reviewed like code.
- **Still god-mode.** Rate limit + rotation + docs reduce and bound risk but don't
  eliminate the single-key blast radius — that's inherent to the design and called
  out explicitly. Per-tenant scoping is a future, larger change if ever needed.

## Open Questions

- Rate-limit scope: per provision key (one website = one key, so effectively
  global) or per target keyId? Lean: per provision key with a high global ceiling —
  the point is abuse-bounding, not fairness. Confirm.
- Field-name alignment: hard-switch to `usd` (breaking the admin `amountUsd`) or
  accept-both-deprecate? Lean: accept both, deprecate `amountUsd`. Confirm.
- Do we also encrypt the provision keys themselves at rest? They live in
  `config.provisionApiKeys` (config/env), same as admin keys, not in the money
  store. Lean: out of scope — treat like admin keys (config-managed), document
  secure handling. Confirm.
