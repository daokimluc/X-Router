## 1. Section scaffold + gating

- [x] 1.1 `marketplaceEnabled` surfaced via `/v1/public/auth-info` (extended `registerPublicRoutes(app, config)`); App.tsx reads it on boot.
- [x] 1.2 Lazy-loaded `MarketplacePage` (default export) + a "Marketplace" nav entry in the Admin group, rendered only when `marketplaceEnabled` (visibleNavGroups filters it out otherwise).
- [x] 1.3 Confirmed separate chunk: `MarketplacePage-*.js` (28.77 kB) is built distinct from the main `index-*.js` entry.

## 2. Plans panel

- [x] 2.1 List/create/edit/delete plans via a modal — name, priceUsd, modelGroups (csv), buckets {hourUsd,dayUsd,monthUsd}, overageEnabled, paygDailyLimitUsd, optional id.
- [x] 2.2 Validation (name required) + inline flash + refresh after action.
- [x] 2.3 EN/VI i18n keys (mkt.plans.*).

## 3. Sellers panel

- [x] 3.1 Approval queue: list sellers; approve/reject (pending), suspend (approved), reactivate (suspended).
- [x] 3.2 Edit terms (commissionPct, payoutRef) via PATCH /admin/v1/sellers/:id; house has no actions.
- [x] 3.3 Per-seller earnings unpaid shown inline (GET /admin/v1/earnings/seller/:id).
- [x] 3.4 i18n (mkt.sellers.*).

## 4. Listings panel

- [x] 4.1 List listings; show namespacedModel + seller + provider account + cost.
- [x] 4.2 Enable/disable, delete, re-price (PATCH costPrice) via a modal.
- [x] 4.3 i18n (mkt.listings.*).

## 5. Earnings & payouts panel

- [x] 5.1 Per-seller day/month/lifetime/unpaid lookup; platform margin total.
- [x] 5.2 Mark-paid (with payoutRef), reverse payout, reverse settlement (by logId) — amount + reason, dangerButton styling on reversals, confirm on settlement reversal.
- [x] 5.3 i18n (mkt.earnings.*).

## 6. Wallets panel

- [x] 6.1 Lookup a key's wallet; topup / refund / debit each with amount (+ reason for refund/debit), confirm modal, resulting balance shown after.
- [ ] 6.2 Buyer-key disable/delete from the operator UI → DEFERRED. The provision/admin key-lifecycle endpoints exist (marketplace-lifecycle), but the operator path is the website's job per design; wallets panel covers the money side. Can add later if operators ask.
- [x] 6.3 i18n (mkt.wallets.*).

## 7. Markup, Canonical models, Webhook panels

- [x] 7.1 Markup: show default + per-model; set default; add/remove per-model override (null deletes).
- [x] 7.2 Canonical models: list/add/remove (remove surfaces the 409-in-use error via flash).
- [x] 7.3 Business webhook: enabled/url/events + secretSet (masked); secret sent only on explicit change (empty field = unchanged).
- [x] 7.4 i18n (mkt.markup.* / mkt.canonical.* / mkt.webhook.*).

## 8. Verification

- [x] 8.1 Dashboard tsc clean; build clean; MarketplacePage is a separate 28.77 kB chunk.
- [x] 8.2 Flag OFF → no Marketplace nav (visibleNavGroups filters; page only in lazy chunk, never imported when nav hidden). Gateway 614 pass + 7 skip; auth-info marketplaceEnabled:false in test.
- [ ] 8.3 Manual flag-on click-through (user).
- [x] 8.4 `openspec validate admin-marketplace-ui --strict` passes.

Note: the "books health" reconciliation panel (reconcilePlatform/reconcileSeller, also money-correctness #2 task 4.3) was NOT added as a distinct panel — the Earnings panel surfaces platform margin; a dedicated reconciliation read-panel is a small follow-up. Tracked, not blocking.
