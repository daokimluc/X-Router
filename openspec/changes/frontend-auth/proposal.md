## Why

The cloned marketing site has `/login` and `/register` pages and a `/console` area, but authentication is purely cosmetic: the forms do nothing, there is no session, and the console is reachable by anyone via URL. Before wiring the real X-Router gateway (which the user is still extending with endpoints), we need a working auth *frontend* — login, register, logout, a persisted session, and a route guard — so the app behaves like a real product and so the later `integrate-xrouter` change only has to swap the mock auth provider for real OAuth/Bearer calls.

This phase deliberately uses **mock authentication** (no backend): a client-side session stored in a cookie/localStorage, validated by middleware. This is independent of X-Router readiness and ships immediately. It also upgrades the login/register UI to match foza.ai's actual two-column, OAuth-first layout.

## What Changes

Grounded in the rendered original (`/login`, `/register`):

- **Auth UI redesign** — replace the current single centered card with foza.ai's **two-column split**: left = branded panel with marketing bullets (login: "One API key. Every LLM." + 4 benefits; register: "Start earning from your AI infrastructure." + 4 benefits), right = the auth form. **OAuth-first**: "Continue with Google" primary, email/password secondary, Terms/Privacy notice, cross-link between login/register.
- **Mock auth provider** — a client `AuthProvider` (React context) exposing `user`, `signIn`, `signInWithGoogle`, `register`, `signOut`. Session persisted in a cookie (so middleware can read it) + mirrored to memory. No real credentials checked — any submit creates a demo session (`luc dao kim`).
- **Route guard** — middleware redirects unauthenticated users away from `/console/**` to `/login`, and redirects authenticated users away from `/login`/`/register` to `/console`. Preserve intended destination via `?next=`.
- **Logout** — wire the console topbar user menu to `signOut`, clearing the session and returning to `/`.
- **Session-aware UI** — site header shows "Sign in / Get started" when logged out, and a user chip / "Console" link when logged in.

## Capabilities

### New Capabilities
- `frontend-auth`: Client-side authentication for the Foza website — mock session lifecycle (sign in, register, Google, sign out), session persistence, route protection for the console, and the two-column auth page UI. Defines the seam that `integrate-xrouter` will later back with real X-Router OAuth/Bearer auth.

### Modified Capabilities
<!-- None at spec level — marketing-ui-fidelity is unaffected; auth pages are new behavior. -->

## Impact

- **Affected code**: `src/middleware`/`proxy.ts` (extend matcher + guard logic alongside next-intl), `src/components/site/auth-card.tsx` (redesign), new `src/components/providers/auth-provider.tsx`, `src/app/[locale]/(marketing)/login` + `register` pages, `src/app/[locale]/console/layout.tsx` (consume session), `src/components/console/console-shell.tsx` (logout), `src/components/site/site-header.tsx` (session-aware), `messages/{vi,en}.json` (auth + benefits strings).
- **Interaction with next-intl middleware**: the guard must compose with the existing locale middleware (run locale resolution first, then auth redirect on the resolved path).
- **No backend, no new deps**: pure frontend; cookie via `document.cookie` / `next/headers`.
- **Seam for later**: `AuthProvider` API is the single place `integrate-xrouter` swaps mock → real (X-Router `oauth.ts` / Bearer), per the Hybrid model in `integration-contract`.
- **Risk**: low-medium — middleware composition with next-intl is the main correctness risk; verified by `npm run build` + manual guard tests (logged-out `/console` → `/login`, logged-in `/login` → `/console`).
