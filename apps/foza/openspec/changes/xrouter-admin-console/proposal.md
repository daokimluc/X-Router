## Why

The operator (you) needs to run the marketplace day-to-day: create plans, set
markup, approve/suspend/reject sellers, manage the canonical model list. The
question that drove this decision was concrete: **"how do I add a new plan?"**

Today Foza can't — plan CRUD, re-price, canonical-model management, and seller
`reject`/term-edits are **admin-only** in X-Router (confirmed in code:
`planAdmin.ts`, `sellerAdmin.ts`; answers §C1/§C3) and Foza only holds a provision
key. The fallback is X-Router's own operator dashboard (`MarketplacePage.tsx`, 8
tabs) — but that means opening a second app and a second login for something done
frequently, especially early on. That is poor operator UX for a routine task.

X-Router's guidance (§C3): don't merge the keys into one; if Foza wants admins to
manage things in Foza, **hold both keys server-side** — that's the correct way.
So Foza takes on the admin key for the *frequently-used* operator actions, and
leaves the *rare + money-reversing* actions to X-Router's dashboard, where a
misclick has real-money consequences and a dedicated, audited tool is safer.

## What Changes

- **Add an admin-key auth dimension** to Foza's gateway client: a second
  server-side key (`XROUTER_ADMIN_KEY`) used only for `/admin/v1/*` calls. Never
  exposed to the browser; only reachable behind the existing `isAdmin()` /
  `FOZA_ADMIN_EMAILS` gate.
- **Extend the adapter/client** with the admin endpoints needed for the in-Foza
  operator actions (a third `auth: "admin"` dimension alongside provision/internal).
- **Bring the frequently-used operator actions into Foza's `console/admin`:**
  - **Plans:** create / edit / delete (`/admin/v1/plans`) + assign plan to a key.
  - **Markup:** set + clear per-model override (`/admin/v1/markup`).
  - **Sellers:** approve / suspend / **reject** + edit terms
    (commission/payoutRef) (`/admin/v1/sellers/...`).
  - **Canonical models:** list / add / remove (`/admin/v1/canonical-models`) — the
    precondition for creating listings.
- **Leave the rare, money-reversing actions to X-Router's dashboard** (documented,
  not built in Foza): reverse/adjust earnings, reverse settlement. These touch
  already-settled money; keeping them out of the internet-facing website reduces
  blast radius and they happen rarely.

The split rule: **frequent + catalog/markup/seller-admin → Foza (admin key);
rare + reverses-settled-money → X-Router dashboard.**

## Capabilities

### New Capabilities
- `xrouter-admin-console`: An in-Foza operator console (admin-gated, admin-key
  backed) for the frequently-used marketplace management actions — plan CRUD,
  markup, seller approval/terms, canonical models — so the operator manages the
  marketplace in one place without the X-Router dashboard for routine work, while
  money-reversing actions stay on the X-Router dashboard.

## Impact

- **Affected code:** `src/lib/xrouter/config.ts` (+`adminKey`),
  `src/lib/xrouter/client.ts` (+`auth: "admin"`), `src/lib/xrouter/adapter.ts`
  (+admin methods), `src/lib/xrouter/admin.ts` / `console/admin/actions.ts`
  (+plan/markup/seller-terms/canonical actions), `console/admin` UI (+plan editor,
  canonical manager, seller-terms editor). `.env` (+`XROUTER_ADMIN_KEY`).
- **Depends on:** nothing structural; composes with the existing `isAdmin()` gate.
  Independent of the persistence/ledger changes (can land in parallel), but listed
  after them because money-correctness is higher priority.
- **Security:** introduces the **admin (god-mode) key** into Foza. Mitigations
  (mandatory): key is server-only (`server-only`, env, never in a client bundle);
  every admin action gated by `FOZA_ADMIN_EMAILS`; the dangerous money-reversing
  operations are deliberately NOT exposed here. The threat model is X-Router's §7 —
  a leaked admin key can change prices and reverse settlements, so the gate and
  server-only handling are load-bearing.
- **Risk:** medium — wider privilege surface in an internet-facing app. The scope
  boundary (no reverses in Foza) is the main control.
