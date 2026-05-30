## Context

The dashboard (`apps/dashboard/src/App.tsx` + page components) already has the
patterns this needs: a console shell + nav, `createApiClient` (holds the admin
key), `DataTable`, modal components (e.g. `ApiKeyEditModal`, `TopupModal`),
EN/VI i18n via `i18n.ts`, and lazy-loaded heavy panels (the recharts usage panel
is already code-split). The marketplace admin endpoints already exist:
`/admin/v1/plans`, `/admin/v1/sellers`, `/admin/v1/listings`,
`/admin/v1/canonical-models`, `/admin/v1/markup`, `/admin/v1/earnings/*`,
`/admin/v1/api-keys/:id/wallet` + topup, `/admin/v1/business-webhook`, plus the
money-out routes from `marketplace-lifecycle`.

So this is a pure consumption/UI change: build screens over existing APIs.

## Goals / Non-Goals

**Goals:**
- An operator can do every marketplace admin task from the dashboard — no curl.
- The screens appear only when the marketplace is enabled, and never ship in the
  community (flag-off) build's active nav.
- Match existing dashboard conventions (panels, DataTable, modals, i18n, lazy).

**Non-Goals:**
- Any backend/endpoint work — consumes existing admin APIs only.
- The buyer/seller website (`XRouter.ai`) — separate repo, separate audience.
- Real-time/live-updating dashboards — simple fetch-on-load + refresh-after-action
  is enough (mirrors current pages).
- Auth changes — the dashboard already authenticates with the admin key.

## Decisions

### One Marketplace section, sub-panels by entity
```
   Console nav (when MARKETPLACE_ENABLED)
     └─ Marketplace
          ├─ Plans          (CRUD)
          ├─ Sellers        (approval queue + term edits + earnings)
          ├─ Listings       (enable/disable/delete/re-price)
          ├─ Earnings       (per-seller + platform margin + mark-paid/reverse)
          ├─ Wallets        (lookup/topup/refund/debit)
          ├─ Markup         (default + per-model)
          ├─ Canonical models
          └─ Webhook        (business webhook config)
```
Reuse `DataTable` for lists, the existing modal pattern for create/edit, and the
toast/message pattern for action results. Lazy-load the whole Marketplace section
so it stays out of the main entry chunk (like the usage charts panel).

### Gating: show only when enabled
Expose a marketplace-enabled flag the dashboard can read without the admin key
working it out indirectly — reuse/extend an existing public or admin read (e.g.
the version/health/auth-info read already on the login/boot path) to include
`marketplaceEnabled`. The nav entry + routes render only when true. The community
build (flag off) shows nothing.

### Money-out is explicit and confirmed
Refund / debit / reverse actions show a confirm step (amount + reason required),
display the resulting balance/unpaid, and surface the audit reason. These are the
only destructive-money screens; they read clearly as such (distinct styling) to
avoid an operator fat-fingering a refund.

### Secret handling in the webhook panel
The business-webhook panel shows `secretSet` + masked secret on read, and only
sends a new secret on explicit change (never round-trips the masked value back as
the secret). Mirrors the existing admin endpoint's masking.

### i18n + reuse
All new strings get EN/VI keys in `i18n.ts`. Prefer composing existing components
(DataTable, modal shell, form-field styles) over new bespoke UI.

## Risks / Trade-offs

- **Largest surface of the five changes (many screens).** Mitigation: it's
  low-risk (frontend, existing APIs, no money math); can be built panel-by-panel
  and shipped incrementally (Plans + Sellers first — they unblock the original
  question — then the rest).
- **Bundle size.** Mitigation: lazy-load the section; verify it's a separate chunk
  (the build already code-splits the charts panel).
- **Flag drift.** If the enabled flag isn't surfaced cleanly, the nav could show
  for a flag-off build. Mitigation: single source of truth read at boot; default
  hidden.
- **Destructive money actions in a UI.** Mitigation: confirm + reason required +
  distinct styling; the backend already audits every call.

## Open Questions

- Build all panels in one change, or split (Plans+Sellers first, rest follow)?
  Lean: one change, but implement + verify panel-by-panel in tasks so it can land
  incrementally. Confirm.
- Does the operator need a buyer-key admin screen here too (disable/revoke/expire),
  or is that purely the website's job via provision? Lean: include a read-only
  buyer-key lookup + the admin disable/delete (operator support tool), since the
  admin endpoints exist; the website still drives the routine path. Confirm.
- Reuse the existing single-key `TopupModal` for wallets, or a dedicated wallet
  panel? Lean: dedicated panel (topup + refund + debit + lookup in one place).
