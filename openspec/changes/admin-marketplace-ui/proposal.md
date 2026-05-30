## Why

The admin marketplace endpoints exist (plans, sellers, listings, earnings,
markup, wallet, business-webhook) and `marketplace-lifecycle` adds the missing
money-out + amendment endpoints — but there is **no dashboard UI to drive any of
them**. The Phase-34 specs deferred the admin UI as "website-driven / admin
fallback", and the audit confirmed the operator currently has no screen to:

- create / edit / delete **plans** (the question that started this thread —
  today only reachable by hand-calling the admin API),
- work the **seller approval queue** (approve / suspend / reject) and edit seller
  terms (commission, payoutRef),
- view and manage **listings** (enable/disable/delete, re-price),
- see **earnings** per seller, the platform margin, and **mark payouts paid** /
  reverse them,
- **refund / debit** a buyer wallet,
- set **markup** (default + per-model, remove overrides),
- manage the **canonical base-model** vocabulary,
- configure the **business webhook** target.

An operator running a real marketplace needs these as screens, not curl. This
change builds the admin dashboard surface; it adds no new backend (it consumes
the admin endpoints from `provision-webhook`, `seller-supply`,
`two-sided-settlement`, and `marketplace-lifecycle`).

## What Changes

Add a **Marketplace** section to the existing x-router dashboard (admin-key
authenticated, shown only when `MARKETPLACE_ENABLED`), with panels:

- **Plans** — list/create/edit/delete plan presets (modelGroups, buckets
  hour/day/month, overage, paygDailyLimit, priceUsd-informational).
- **Sellers** — approval queue (pending → approve/reject), suspend/reactivate,
  edit commissionPct + payoutRef, view per-seller earnings + unpaid.
- **Listings** — per base model, enable/disable/delete, re-price cost, see which
  seller + provider account serves it.
- **Earnings & payouts** — per-seller day/month/lifetime/unpaid, platform margin
  running total, mark-paid (with payoutRef), reverse payout / settlement.
- **Wallets** — look up a key's balance, top up, refund, debit (corrections).
- **Markup** — default + per-model overrides, add/remove override.
- **Canonical models** — list/add/remove the base-model vocabulary.
- **Business webhook** — set url/secret/events (secret masked), see status.

Reuse the dashboard's existing patterns (panels, DataTable, modals, i18n EN/VI,
lazy-load to keep it out of the main bundle). Gated so the community (flag-off)
build never ships these screens.

- **BREAKING** none — dashboard-only; gateway untouched.

## Capabilities

### New Capabilities
- `admin-marketplace-ui`: An operator dashboard surface for managing the
  marketplace — plans, sellers, listings, earnings/payouts, wallets, markup,
  canonical models, and the business webhook — driving the existing admin
  endpoints, shown only when the marketplace is enabled.

### Modified Capabilities
- (none — pure frontend; consumes existing admin APIs.)

## Impact

- New dashboard pages/panels under `apps/dashboard/src/` (e.g. a `MarketplacePage`
  + sub-panels), lazy-loaded; routes added to the console nav, conditional on a
  marketplace-enabled flag exposed via an existing admin/public read.
- EN/VI i18n keys for all new panels.
- Reuses `createApiClient` (admin key already held by the dashboard) — no new auth.
- Depends on: `marketplace-lifecycle` (the money-out + amendment endpoints the UI
  drives) and the admin endpoints from `provision-webhook` / `seller-supply` /
  `two-sided-settlement` / `marketplace-plans`.
- Out of scope: the buyer/seller-facing website (separate repo `XRouter.ai`) — this
  is the x-router operator dashboard only.
