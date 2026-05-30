## 1. Encrypt the business-webhook secret at rest

- [x] 1.1 Business-webhook secret persisted as AES-GCM ciphertext (LocalEncryptionService.encryptString) in the marketplace `businessWebhook` slice; decrypted into the in-memory WebhookService config on load (so notifyBusiness HMAC uses plaintext). GET stays masked (`••••••••`).
- [x] 1.2 One-time migration: `isCiphertext()` distinguishes `v1.iv.tag.data` ciphertext from a legacy plaintext secret; plaintext is used as-is on load and re-encrypted on the next persist. Idempotent.
- [x] 1.3 Vitest: set secret → persisted value is ciphertext (decrypts back) → reload round-trip → in-memory plaintext matches; legacy plaintext tolerated + re-encrypted; GET masks.

## 2. Document the security / trust model

- [x] 2.1 Added "Security model & trust assumptions" section to `docs/MARKETPLACE_INTEGRATION.md`: x-router enforces NO tenant isolation; website MUST scope keyId/sellerId, hold the provision key server-side, verify webhook HMAC.
- [x] 2.2 Threat-model table: what a leaked provision key grants + mitigations (rotation, rate limit, encrypted secret, audit log).
- [x] 2.3 Provision-key rotation documented (two keys live → switch → drop old).

## 3. Rate-limit privileged provision routes

- [x] 3.1 RateLimitService attached (per provision-key hash) to `POST /provision/key`, `/provision/wallet/topup`, `/provision/grant`, `/provision/earnings/:id/mark-paid` via a `privOpts` preHandler [provisionAuth, rateLimit]. Reads unthrottled.
- [x] 3.2 `PROVISION_RATE_LIMIT_PER_MINUTE` config (default 120; 0 disables). Documented in the security section (raise for bulk provisioning).
- [x] 3.3 Vitest: 4th create over a cap of 3 → 429; reads pass; cap 0 → unlimited.

## 4. Fix contract drift

- [x] 4.1 `payoutRef` persisted on the `payouts` row on mark-paid (markPaid gained payoutRef in #3; provision route now passes it — was dropped). Returned in the payout record.
- [x] 4.2 Both `usd` and `amountUsd` accepted on `/provision/wallet/topup` + `/provision/earnings/:id/mark-paid`; `usd` documented as canonical, `amountUsd` deprecated alias.
- [ ] 4.3 Align audit action vocabulary across provision/admin twins → LEFT AS-IS. Provision actions are namespaced `provision.*` and admin `<entity>.<action>` deliberately (the audit log distinguishes the surface). Not drift; documented intent.
- [x] 4.4 Vitest: payoutRef round-trips through mark-paid (read from payouts table); both field names accepted on topup + mark-paid.

## 5. Multiple provision keys / rotation

- [x] 5.1 `provisionApiKeys` array already supports N keys live (createProvisionAuthMiddleware Set). Vitest confirms. `--set-provision-key` bin flag → DEFERRED (the env-var + restart path works and is documented; the bin convenience flag is a small follow-up, same as the #7-deferred bin flag).
- [x] 5.2 Vitest: two provision keys both authorize; an unknown key → 401.

## 6. Verification

- [x] 6.1 Gateway `tsc` clean.
- [x] 6.2 Full suite green — **622 pass + 7 skip** (was 614, +8 provisionHardening).
- [ ] 6.3 Manual (user): inspect state file → ciphertext secret; rotate keys; hit 429; mark-paid payoutRef persisted.
- [x] 6.4 `openspec validate provision-hardening --strict` passes.
