# Tasks — xrouter-admin-console

## 1. Admin-key auth dimension
- [x] 1.1 `config.ts` — add `adminKey` from `XROUTER_ADMIN_KEY` (server-only)
- [x] 1.2 `client.ts` — add `auth: "admin"` dimension (Bearer admin key on
      `/admin/v1/*`); keep provision/internal as-is
- [x] 1.3 `.env.local` + `.env.example` — document `XROUTER_ADMIN_KEY`

## 2. Adapter admin methods
- [x] 2.1 Plans: `createPlan` / `updatePlan` / `deletePlan` (`/admin/v1/plans`),
      `assignPlanToKey` (`/admin/v1/keys/:id/plan`)
- [x] 2.2 Markup: `setMarkupAdmin` incl. clearing a per-model override (null)
- [x] 2.3 Sellers: `rejectSeller`, `updateSellerTerms` (commission/payoutRef)
- [x] 2.4 Canonical: `listCanonical` / `addCanonical` / `removeCanonical`
- [x] 2.5 All admin writes surface typed errors (no silent mock for admin ops)

## 3. console/admin UI + actions (admin-gated)
- [x] 3.1 Plans panel — list + create/edit/delete form (the "add a plan" flow)
- [x] 3.2 Canonical-models panel — list + add/remove (precondition for listings)
- [x] 3.3 Seller-terms editor — reject + edit commission/payoutRef
- [x] 3.4 Markup editor — default + per-model, with clear-override
- [x] 3.5 Every action wrapped by `isAdmin()` guard server-side

## 4. Document the boundary (NOT built in Foza)
- [x] 4.1 In console/admin, link out to X-Router dashboard for reverse/adjust
      earnings + reverse settlement, with a short "why these live there" note

## 5. Verify
- [x] 5.1 `npx tsc --noEmit` + `npm run build` pass
- [x] 5.2 Admin creates a plan in Foza → appears in `GET /provision/plans` →
      buyer sees it in the plan picker (end-to-end) — VERIFIED live
- [x] 5.3 Non-admin user blocked from every admin action (isAdmin gate)
- [x] 5.4 Admin key never appears in any client bundle (server-only)
- [x] 5.5 Canonical add → listing creation for that model now allowed
      — VERIFIED: after rebuilding X-Router gateway (`npm run build:gateway`),
        POST/DELETE /admin/v1/canonical-models work end-to-end. Plan CRUD +
        reject seller also verified.
