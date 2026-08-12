## Why

The foza-clone marketing site (homepage + plans/login/register) is ~80% visually faithful to foza.ai, but a side-by-side comparison of the saved original DOM against the current build surfaces concrete, fixable gaps: the hero headline is too small on desktop, cards are flatter than the original (missing hover shadow), the navbar uses the wrong surface token, and feature-icon treatment differs. The user confirmed "gần giống rồi" (almost there) and wants the UI tightened before any functional work begins. This change closes the visual gap so the clone is pixel-faithful before auth and X-Router integration land on top of it.

This is scoped to **visual/UX fidelity only** — no new pages, no functionality, no backend. It is intentionally independent of the auth and integration work that follows, so it can ship immediately.

## What Changes

Grounded in the original `template/home.html` (Vietnamese locale, Tailwind classes) vs the current Next.js build:

- **Hero headline**: scale to `text-4xl → sm:text-5xl → lg:text-7xl` (72px) with `leading-[1.05]`; currently caps at `text-5xl`.
- **Navbar surface**: use `bg-sidebar backdrop-blur-sm` (original) instead of `bg-background/80`.
- **Feature cards**: add `hover:shadow-md hover:-translate-y-0.5` with `transition-all duration-200`; current cards only translate.
- **Feature icons**: match original — `h-8 w-8` rounded-lg, `border border-border`, `bg-transparent`, `text-foreground`, `hover:bg-accent/80`; current uses a larger filled accent chip.
- **Card borders**: soften to `border-border/80` where the original does (stat cards).
- **Section rhythm**: verify section padding matches original `py-20`/`py-24` cadence.
- **Cross-check pass**: compare every section (hero, features, models table, integrations, how-it-works, providers, CTA, footer) against the original DOM and align spacing, radius, shadow, and hover states.
- **Dark-mode + i18n verification**: confirm all adjustments hold in both `vi`/`en` and light/dark.

## Capabilities

### New Capabilities
- `marketing-ui-fidelity`: Visual and interaction specifications for the public marketing pages (homepage and auth/plans), defining the target appearance — typography scale, surface tokens, card elevation, hover/transition states, and spacing rhythm — measured against the original foza.ai DOM.

### Modified Capabilities
<!-- None — no existing spec-level behavior changes; this is the first spec. -->

## Impact

- **Affected code**: `src/components/home/*` (hero, features, models-table, integrations, sections), `src/components/site/site-header.tsx`, `src/app/[locale]/(marketing)/*`, `src/app/globals.css` (token usage only — no token value changes).
- **No impact**: routing, i18n message keys, console, docs, dependencies, backend.
- **Risk**: low — purely presentational; verified by `npm run build` + visual review in both locales and themes.
- **Reference**: `template/home.html` and `template/Foza — P2P LLM API Marketplace.html` (saved rendered DOM) are the source of truth for fidelity.
