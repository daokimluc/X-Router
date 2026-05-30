## 1. Section scaffold + gating

- [ ] 1.1 Surface `marketplaceEnabled` to the dashboard via an existing boot/health/auth-info read (no admin-key guess). 
- [ ] 1.2 Add a lazy-loaded `MarketplacePage` + a "Marketplace" console nav entry, rendered only when `marketplaceEnabled`.
- [ ] 1.3 Confirm the section is a separate build chunk (not in the main entry bundle).

## 2. Plans panel (unblocks the original question)

- [ ] 2.1 List plans (`GET /admin/v1/plans`); create (`POST`), edit (`PATCH`), delete (`DELETE`) via a modal — fields: name, priceUsd, modelGroups, buckets {hourUsd,dayUsd,monthUsd}, overageEnabled, paygDailyLimitUsd.
- [ ] 2.2 Validation + result toast; refresh after action.
- [ ] 2.3 EN/VI i18n keys.

## 3. Sellers panel

- [ ] 3.1 Approval queue: list `GET /admin/v1/sellers?status=pending`; approve/reject; suspend/reactivate.
- [ ] 3.2 Edit seller terms (commissionPct, payoutRef) via `PATCH /admin/v1/sellers/:id`.
- [ ] 3.3 Show per-seller earnings snapshot inline (`GET /admin/v1/earnings/seller/:id`).
- [ ] 3.4 i18n.

## 4. Listings panel

- [ ] 4.1 List `GET /admin/v1/listings` (optionally filter by baseModel); show seller + providerAccount + cost.
- [ ] 4.2 Enable/disable, delete, and re-price (`PATCH /admin/v1/listings/:id` with costPrice).
- [ ] 4.3 i18n.

## 5. Earnings & payouts panel

- [ ] 5.1 Per-seller day/month/lifetime/unpaid; platform margin total (`GET /admin/v1/earnings/platform`).
- [ ] 5.2 Mark-paid (with payoutRef) → `POST /admin/v1/earnings/seller/:id/mark-paid`; reverse payout / settlement → the `marketplace-lifecycle` admin routes. Confirm + reason required; distinct destructive styling.
- [ ] 5.3 i18n.

## 6. Wallets panel

- [ ] 6.1 Lookup a key's wallet (`GET /admin/v1/api-keys/:id/wallet`); topup; refund; debit — each with amount + reason, confirm step, show resulting balance.
- [ ] 6.2 Optional: read-only buyer-key lookup + admin disable/delete (operator support).
- [ ] 6.3 i18n.

## 7. Markup, Canonical models, Webhook panels

- [ ] 7.1 Markup: show default + per-model; set default; add/edit/remove per-model override (`PUT /admin/v1/markup`).
- [ ] 7.2 Canonical models: list/add/remove (`/admin/v1/canonical-models`).
- [ ] 7.3 Business webhook: show enabled/url/events + secretSet (masked); set url/secret/events (`PUT /admin/v1/business-webhook`). Secret only sent on explicit change.
- [ ] 7.4 i18n.

## 8. Verification

- [ ] 8.1 Dashboard `tsc` clean; build clean; Marketplace section is a separate chunk.
- [ ] 8.2 With marketplace flag OFF: no Marketplace nav/section renders.
- [ ] 8.3 Manual (flag ON, x-router local): create a plan; approve a seller + edit commission; re-price a listing; mark a payout paid + reverse it; refund a wallet; set markup; add a canonical model; configure the webhook (secret masked).
- [ ] 8.4 `openspec validate admin-marketplace-ui --strict` passes.
