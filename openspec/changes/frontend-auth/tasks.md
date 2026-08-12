# Tasks — frontend-auth

## 1. Auth provider + session
- [x] 1.1 `src/lib/auth.ts` — cookie read/write helpers (`foza_session`, base64 JSON, 7d), shared client/server
- [x] 1.2 `src/components/providers/auth-provider.tsx` — context with `user`, `signIn`, `signInWithGoogle`, `register`, `signOut`; hydrate from cookie on mount
- [x] 1.3 Wrap `[locale]/layout.tsx` children in `AuthProvider`

## 2. Route guard (middleware)
- [x] 2.1 Refactor `proxy.ts` to call next-intl middleware, then layer auth redirects
- [x] 2.2 Protect `/{locale}/console/**` → redirect to `/{locale}/login?next=<path>` when no session
- [x] 2.3 Redirect authenticated users away from `/{locale}/(login|register)` → `/{locale}/console`
- [x] 2.4 Preserve intl headers/cookies on guard redirects; verify locale parity (vi/en)

## 3. Auth page UI (two-column, OAuth-first)
- [x] 3.1 Redesign `auth-card.tsx` to split layout: brand panel (left, hidden <lg) + form (right)
- [x] 3.2 OAuth-first: "Continue with Google" primary, divider, email/password secondary, Terms/Privacy, cross-link
- [x] 3.3 Wire form + Google button to `AuthProvider`; handle `?next=` redirect on success
- [x] 3.4 Add login/register benefit bullets + strings to `messages/{vi,en}.json`

## 4. Session-aware chrome
- [x] 4.1 Console topbar: real identity from session + wire user menu sign-out (UserMenu dropdown)
- [x] 4.2 Site header: show Console/user when authed, Sign in/Get started when not

## 5. Verification
- [x] 5.1 `npm run build` + `tsc` pass (Suspense boundary added for useSearchParams)
- [x] 5.2 Guard: logged-out `/vi/console` → `/vi/login?next=/vi/console`; `?next=` preserved on nested routes
- [x] 5.3 Guard: logged-in `/vi/login` → `/vi/console`; `/en/register` → `/en/console` (locale preserved)
- [ ] 5.4 Sign out returns to home; session cleared (user to confirm in browser)
- [ ] 5.5 Locale + theme parity on auth pages (user to confirm visually)
