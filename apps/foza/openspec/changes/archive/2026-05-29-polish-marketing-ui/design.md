## Approach

Treat the saved `template/home.html` as the source of truth and align the existing Next.js components to its exact Tailwind classes, section by section. No new components, no token-value changes — only class adjustments to existing JSX and verification in both themes/locales. Work is mechanical and low-risk; the design's value is the precise class deltas so implementation is unambiguous.

## Class deltas (original → current)

| Element | File | Current | Target (original) |
|---------|------|---------|-------------------|
| Hero `h1` | `components/home/hero.tsx` | `text-4xl ... sm:text-5xl` | `text-4xl font-bold tracking-tight leading-[1.05] sm:text-5xl lg:text-7xl` |
| Header | `components/site/site-header.tsx` | `bg-background/80 backdrop-blur-md` | `bg-sidebar backdrop-blur-sm` |
| Feature card | `components/home/features.tsx` | translate only | `transition-all duration-200 hover:border-primary/40 hover:shadow-md hover:-translate-y-0.5` |
| Feature icon | `components/home/features.tsx` | `h-[42px] bg-accent` filled | `h-8 w-8 rounded-lg border border-border bg-transparent text-foreground hover:bg-accent/80` |
| Stat card | `components/home/hero.tsx` | `border-border` | `border-border/80` |

## Verification strategy

1. `npm run build` must pass with no MISSING_MESSAGE or type errors.
2. Visual pass in `vi` + `en`, light + dark, at mobile / `sm` / `lg` widths.
3. Spot-diff each section's container padding against the original `py-20`/`py-24` rhythm.

## Trade-offs

- **Match original classes verbatim vs. re-derive from tokens** → match verbatim. The original is the spec; re-deriving risks drift. Token values are already correct.
- **Keep feature icon as filled chip (current) vs. revert to bordered (original)** → revert to bordered. Fidelity is the goal of this change; the filled chip was an earlier interpretation, not the original.
- **Scope creep guard**: explicitly exclude console/docs polish, new sections, and any functional behavior — those belong to later changes.

## Out of scope

- Auth behavior, route guards (→ `frontend-auth`).
- X-Router integration, live data (→ `integration-contract`, `integrate-xrouter`).
- Console and docs visual polish (can be a follow-up fidelity change if needed).
