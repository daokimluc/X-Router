# Tasks — integration-contract

> Specification-only change. "Implementation" here means authoring/ratifying the contract artifacts, not writing code.

## 1. Ratify boundaries
- [x] 1.1 Confirm system-of-record split (Foza: money/identity/plans/invoices/payouts; X-Router: routing/metering/quota/pooling) — recorded in proposal.md "Roles & system-of-record boundaries" + design.md architecture diagram
- [x] 1.2 Confirm Hybrid (Model C) wallet model with stakeholders — design.md "Wallet model: C (Hybrid) — chosen", implemented & E2E-verified in `integrate-xrouter`

## 2. Resolve open questions (design.md)
- [x] 2.1 Decide event granularity (per-request vs batched) — `usage.recorded` per-request real-time; edge events edge-triggered (design.md Q1)
- [x] 2.2 Decide command transport (REST admin vs queue) — REST `/provision/*` group (design.md Q2)
- [x] 2.3 Define usage-event payload fields (align with X-Router `WebhookService`) — `{keyId, baseModel, sellerId, inputTokens, outputTokens, sellAmount, sellerCredit, platformMargin}` (design.md Q3)
- [x] 2.4 Define plan model (quota grant + model allow-list vs richer) — `Plan{id,name,priceUsd,modelGroups[],buckets{hour/day/month},overageEnabled,paygDailyLimitUsd?}` (design.md Q4)
- [x] 2.5 Set reconciliation tolerance — both sides integer micro-USD; Foza ledger authoritative, month bucket may overshoot on in-flight (design.md Q5)
- [x] 2.6 Choose command auth (OAuth bearer vs service token) — dedicated provision key, 3rd dimension (design.md Q6)

## 3. Mirror into X-Router (coordination)
- [x] 3.1 Note which requirements need matching X-Router endpoints (plan, seller credit/payout, per-seller pricing) — design.md "Existing X-Router foundation" table maps each contract need to an X-Router change
- [x] 3.2 Hand off contract to X-Router endpoint work — X-Router's 7 changes (`usd-wallet`, `hourly-spend-buckets`, `marketplace-plans`, `seller-supply`, `lowest-cost-routing`, `two-sided-settlement`, `provision-webhook`) implement this contract; `integrate-xrouter` wired against the live endpoints

## 4. Sign-off
- [x] 4.1 Validate spec (`openspec validate integration-contract`) — passes ("Change 'integration-contract' is valid")
- [x] 4.2 Confirm `frontend-auth` and `integrate-xrouter` can build against this contract — `integrate-xrouter` Complete (E2E-verified on live :3100), `frontend-auth` code complete (16/18, remaining 2 are manual browser confirmations)
