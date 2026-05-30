## 1. Encrypt the business-webhook secret at rest

- [ ] 1.1 Persist the business-webhook secret via `SecretService`/`LocalEncryptionService` (ciphertext in the persisted slice); decrypt in memory for `notifyBusiness` HMAC. GET stays masked.
- [ ] 1.2 One-time migration: an existing plaintext secret in the state file is re-encrypted on first load (idempotent; detect plaintext vs ciphertext).
- [ ] 1.3 Vitest: set secret → persisted value is ciphertext (not the raw secret) → reload → HMAC signature still matches; GET masks it.

## 2. Document the security / trust model

- [ ] 2.1 Add a "Security model & trust assumptions" section to `docs/MARKETPLACE_INTEGRATION.md`: x-router enforces NO tenant isolation; the website MUST scope every keyId/sellerId to the authenticated user; provision key is god-mode + server-side only; website MUST verify webhook HMAC.
- [ ] 2.2 Include a threat-model table: what a leaked provision key grants (mint wallet, read all tenants, forge payout, hijack webhook) + mitigations (rotation, rate limit).
- [ ] 2.3 Document provision-key rotation (carry two keys, switch, remove old).

## 3. Rate-limit privileged provision routes

- [ ] 3.1 Attach a rate limiter (reuse `RateLimitService`) to `POST /provision/key`, `/provision/wallet/topup`, `/provision/grant`, `/provision/earnings/:id/mark-paid`. Configurable per-minute cap; reads unthrottled.
- [ ] 3.2 Default generous; document how to raise it for bulk provisioning/migration.
- [ ] 3.3 Vitest: exceeding the cap on a privileged route returns 429; reads + normal rates pass.

## 4. Fix contract drift

- [ ] 4.1 Persist `payoutRef` on the payout record (the `payouts` table from persistence-sqlite) on mark-paid; return it in the snapshot/audit.
- [ ] 4.2 Accept BOTH `usd` and `amountUsd` on topup + mark-paid (provision + admin); document `usd` as canonical, deprecate `amountUsd`.
- [ ] 4.3 Align audit action vocabulary across provision/admin twins.
- [ ] 4.4 Vitest: payoutRef round-trips through mark-paid; both field names accepted.

## 5. Multiple provision keys / rotation

- [ ] 5.1 Confirm `provisionApiKeys` array supports N keys live; `--set-provision-key` (and optionally `--add-provision-key`/`--remove-provision-key`) in bin.
- [ ] 5.2 Vitest: two provision keys both authorize; removing one revokes only it.

## 6. Verification

- [ ] 6.1 Gateway `tsc` clean.
- [ ] 6.2 Full suite green; expect +~10 tests.
- [ ] 6.3 Manual: inspect the persisted state file — the webhook secret is ciphertext; rotate the provision key with two keys live and no downtime; hammer a privileged route to hit the 429; mark-paid with a payoutRef and see it persisted.
- [ ] 6.4 `openspec validate provision-hardening --strict` passes.
