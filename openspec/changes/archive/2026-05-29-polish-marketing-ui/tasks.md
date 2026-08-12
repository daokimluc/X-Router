# Tasks — polish-marketing-ui

## 1. Hero
- [x] 1.1 Scale hero `h1` to `text-4xl ... sm:text-5xl lg:text-7xl` with `leading-[1.05]` (`components/home/hero.tsx`)
- [x] 1.2 Soften stat-card border to `border-border/80`

## 2. Navbar
- [x] 2.1 Change header surface to `bg-sidebar backdrop-blur-sm` (`components/site/site-header.tsx`)

## 3. Feature cards
- [x] 3.1 Add `transition-all duration-200 hover:shadow-md hover:-translate-y-0.5` to feature cards (`components/home/features.tsx`)
- [x] 3.2 Revert feature icon to `h-8 w-8 rounded-lg border border-border bg-transparent text-foreground hover:bg-accent/80`

## 4. Section cross-check (against template/home.html)
- [x] 4.1 Verify models-table section spacing/radius/hover — matches (`py-20`, rounded-xl, hover:bg-background)
- [x] 4.2 Verify integrations cards spacing/radius — matches
- [x] 4.3 Verify how-it-works + providers + CTA padding rhythm (`py-20`/`py-24`) — providers fixed: removed full-bleed `bg-card` band, now normal `max-w-7xl py-20` with `gap-14` per original
- [x] 4.4 Verify footer matches original

## 5. Verification
- [x] 5.1 `npm run build` passes (no MISSING_MESSAGE / type errors)
- [x] 5.2 Visual review in `vi` + `en` — served HTML confirms class changes in both
- [x] 5.3 Visual review in light + dark — user confirmed
- [x] 5.4 Responsive check at mobile / `sm` / `lg`

## 6. Theme & brand polish (added during review, via ui-ux-pro-max skill)
- [x] 6.1 Root-cause fix for light/dark mixing: replace baked-in full-color brand SVGs with monochrome `currentColor` glyphs (simple-icons)
- [x] 6.2 Apply official brand colors: Gemini official gradient (blue→purple→pink), Claude `#D97757`, DeepSeek `#5786FE`, Mistral `#FA520F`; OpenAI/Cursor monochrome (correct brand identity)
- [x] 6.3 Theme-aware elevation tokens (`--shadow-card`, `--shadow-elevated`) replacing hardcoded light-only rgba shadows
- [x] 6.4 Bump dark `--muted-foreground` to `#9ca3af` for 4.5:1 contrast
- [x] 6.5 Fix usage-chart bars (`bg-secondary` invisible in dark → `bg-primary/25`)
- [x] 6.6 Base radius `0.3rem` → `0.5rem`; add `prefers-reduced-motion`; `cursor-pointer` on buttons
- [x] 6.7 Audit: 0 hardcoded/theme-blind color classes remain in components

