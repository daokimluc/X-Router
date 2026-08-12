## Approach

Mock authentication entirely on the client, with a cookie-backed session so server middleware can guard routes before render. The `AuthProvider` exposes a small API that `integrate-xrouter` will later reimplement against X-Router OAuth/Bearer — the rest of the app depends only on that API, not on how auth works.

## Session model

```
AuthProvider (React context, "use client")
  user: { name, email } | null
  signIn(email, pw)        ─┐
  signInWithGoogle()        ├─► create mock session
  register(name, email, pw)─┘     • write cookie `foza_session` (JSON, 7d)
  signOut()  ───────────────────► clear cookie
  state hydrated on mount from cookie
```

- Cookie name `foza_session`, value = base64 JSON `{name,email}`. Readable by `proxy.ts` via `request.cookies`.
- Client reads the same cookie on mount to hydrate `user` (avoids flash). `suppressHydrationWarning` already on `<html>`.
- No password validation — any non-empty submit succeeds with demo identity `luc dao kim / khiconlauca9xx@gmail.com` (matches console mockups).

## Middleware composition (the tricky part)

next-intl's middleware must run first (locale resolution + redirects), then the auth guard acts on the resolved, locale-prefixed path.

```
request
  │
  ▼
intlMiddleware(request)  → response (may be a locale redirect)
  │
  ├─ if it's a redirect/rewrite → return as-is
  │
  ▼ otherwise inspect path: /{locale}/console/** ?
      ├─ protected + no session  → redirect /{locale}/login?next=<path>
      ├─ /{locale}/(login|register) + session → redirect /{locale}/console
      └─ else → return intl response
```

- Parse locale from the first path segment (`vi`/`en`); default handled by intl already.
- Wrap, don't replace: call `createMiddleware(routing)` to get the intl response, then layer auth redirects, copying intl's headers/cookies onto any new `NextResponse.redirect`.

## Auth page layout (from rendered foza.ai)

```
┌───────────────────────────┬───────────────────────────┐
│  BRAND PANEL (hidden < lg) │  AUTH FORM                │
│  • Foza wordmark           │  Foza wordmark (mobile)   │
│  • Headline                │  Title + subtitle         │
│    login: "One API key.    │  [ Continue with Google ] │
│     Every LLM."            │  ─────── or ───────       │
│    reg: "Start earning..." │  email / password         │
│  • 4 benefit bullets       │  [ Submit ]               │
│  • © 2026 Foza             │  Terms / Privacy notice   │
│  (accent/gradient surface) │  cross-link               │
└───────────────────────────┴───────────────────────────┘
```

- Left panel: `bg-card` (or subtle `bg-accent`) with `border-r`, benefits as check-bullets. Hidden below `lg`.
- Right: reuse the existing form styling, OAuth button primary (`variant="ghost"` full-width with Google glyph), divider, fields, submit.
- Benefits differ login vs register (see messages).

## Files

- New: `src/components/providers/auth-provider.tsx`, `src/lib/auth.ts` (cookie read/write helpers, shared client+server).
- Edit: `src/proxy.ts` (compose guard), `src/components/site/auth-card.tsx` (split layout + call provider), `src/app/[locale]/layout.tsx` (wrap children in `AuthProvider`), `src/components/console/console-shell.tsx` (sign-out + real identity), `src/components/site/site-header.tsx` (session-aware), `messages/{vi,en}.json`.

## Trade-offs

- **Cookie vs localStorage** → cookie. Middleware can't read localStorage; cookie lets the guard run server-side before render (no console flash).
- **Mock now vs real OAuth now** → mock. X-Router endpoints aren't finalized; the provider seam keeps the swap to one file later.
- **Guard in middleware vs per-layout server check** → middleware. Centralized, runs before render, composes once with locale logic, avoids duplicating checks across console pages.

## Out of scope

- Real credential validation, X-Router calls, tokens (→ `integrate-xrouter`).
- Password reset, email verification, MFA.
- Server-side session store (mock is stateless client cookie).
