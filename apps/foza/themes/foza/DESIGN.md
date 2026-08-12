# Foza — Style Reference
> Bright, frictionless developer console — a calm blue marketplace for AI

**Theme:** light (a distinct dark theme also ships; documented under Surfaces)

Foza presents as a clean, near-white developer product: a cool `#f6f8fb` canvas with pure-white cards floating on hairline `#dde1e7` borders, almost no shadow, and a single confident blue (`#1473ff`) carrying every primary action and link. The typeface is Lexend — a humanist, highly legible variable sans that reads friendly at body sizes and crisp-but-soft at display weights, set tight (`-0.025em`) on headlines. Color is used sparingly and functionally: blue for action, a desaturated `#e9ecf0` for secondary surfaces, soft `#e8f1ff` accent washes behind small labels, and the GitHub-style near-black `#0d1117` only inside code blocks. Depth comes from borders and subtle surface steps rather than drop shadows, giving the whole thing a flat, API-dashboard honesty. The signature rhythm break is the inline terminal/code card — dark, monospace, sk-foza-xxxx — dropped into an otherwise pale layout to remind you this is a tool for developers. Components are compact (small `0.3rem` default radius) and quiet, prioritizing scannable pricing tables and copy-paste snippets over decoration.

## Tokens — Colors

| Name | Value | Token | Role |
|------|-------|-------|------|
| Canvas | `#f6f8fb` | `--color-background` | Primary page background |
| Card | `#ffffff` | `--color-card` | Card / panel surface |
| Sidebar | `#ffffff` | `--color-sidebar` | Sidebar / nav surface |
| Ink | `#111827` | `--color-foreground` | Primary text, headings |
| Ink Sidebar | `#374151` | `--color-sidebar-foreground` | Sidebar / secondary nav text |
| Ink Muted | `#6b7280` | `--color-muted-foreground` | Secondary text, captions, table labels |
| Primary Blue | `#1473ff` | `--color-primary` | Primary buttons, links, focus ring, brand |
| On Primary | `#ffffff` | `--color-primary-foreground` | Text/icons on primary blue |
| Secondary | `#e9ecf0` | `--color-secondary` | Secondary button / chip surface |
| On Secondary | `#374151` | `--color-secondary-foreground` | Text on secondary surface |
| Muted Surface | `#e9ecf0` | `--color-muted` | Muted fills, skeletons, track |
| Accent Wash | `#e8f1ff` | `--color-accent` | Soft blue label/badge background |
| On Accent | `#0d55c4` | `--color-accent-foreground` | Text on accent wash |
| Hairline | `#dde1e7` | `--color-border` | Borders, dividers, input outlines |
| Input | `#dde1e7` | `--color-input` | Input border |
| Ring | `#1473ff` | `--color-ring` | Focus ring |
| Success | `#16a34a` | `--color-success` | Positive status, uptime, gains |
| Warning | `#d97706` | `--color-warning` | Warning status |
| Destructive | `#dc2626` | `--color-destructive` | Error / destructive action |

### Code Surface (GitHub-style, theme-independent)

| Name | Value | Token | Role |
|------|-------|-------|------|
| Code BG | `#0d1117` | `--docs-code-bg` | Code block / terminal background |
| Code Header | `#161b22` | `--docs-code-header` | Code block title bar |
| Code Ink | `#e6edf3` | `--docs-code-foreground` | Code text |
| Code Muted | `#8b949e` | `--docs-code-muted` | Comments, line numbers |
| Code Hover | `rgba(255,255,255,0.1)` | `--docs-code-hover` | Row hover in code |
| Code Highlight | `rgba(77,142,255,0.1)` | `--docs-code-highlight` | Highlighted code line |

> No gradient or glow tokens are present in the source CSS — depth is achieved with borders and flat surface steps. This category is intentionally skipped.

## Tokens — Typography

### Lexend — Humanist variable sans, the single brand typeface for everything · `--font-sans`
- **Substitute:** Lexend is open-source (Google Fonts). Fallback chain: `"Lexend Fallback"` (Arial metric-adjusted, `size-adjust:109.91%`), then system sans.
- **Weights:** variable 100–900; used in practice 400 / 500 / 600 / 700
- **Sizes:** 0.75rem · 0.875rem · 1rem · 1.125rem · 1.25rem · 1.5rem · 1.875rem · 2.25rem · 3rem · 3.75rem · 4.5rem
- **Line height:** 1.25 (tight) · 1.375 (snug) · 1.5 (default) · 1.625 (relaxed)
- **Letter spacing:** -0.025em (tight, headlines) · 0 (body) · 0.05em (wider, labels) · 0.1em (widest, eyebrow)
- **Role:** All headings, body, navigation, buttons, table data, badges. One family, weight-differentiated.

### Monospace stack — Code blocks, terminal snippets, API keys · `--font-mono`
- **Substitute:** `ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace`
- **Weights:** 400
- **Sizes:** 0.75rem–0.875rem inside code cards
- **Line height:** 1.5
- **Letter spacing:** 0
- **Role:** `base_url`, `api_key`, CLI commands, config snippets only.

### Type Scale

| Role | Size | Line Height | Letter Spacing | Token |
|------|------|-------------|----------------|-------|
| micro | 0.75rem (12px) | 1.5 | 0.05em | `--text-xs` |
| caption | 0.875rem (14px) | 1.5 | — | `--text-sm` |
| body | 1rem (16px) | 1.625 | — | `--text-base` |
| body-lg | 1.125rem (18px) | 1.5 | — | `--text-lg` |
| subheading | 1.25rem (20px) | 1.5 | — | `--text-xl` |
| heading-sm | 1.5rem (24px) | 1.375 | -0.025em | `--text-2xl` |
| heading | 1.875rem (30px) | 1.25 | -0.025em | `--text-3xl` |
| heading-lg | 2.25rem (36px) | 1.25 | -0.025em | `--text-4xl` |
| display-sm | 3rem (48px) | 1.25 | -0.025em | `--text-5xl` |
| display | 3.75rem (60px) | 1.25 | -0.025em | `--text-6xl` |
| display-lg | 4.5rem (72px) | 1.25 | -0.025em | `--text-7xl` |

## Tokens — Spacing & Shapes

**Density:** comfortable (Tailwind 4px base unit; sections breathe at 96–128px)

### Spacing Scale

| Name | Value | Token |
|------|-------|-------|
| 1 | 4px | `--spacing-1` |
| 2 | 8px | `--spacing-2` |
| 3 | 12px | `--spacing-3` |
| 4 | 16px | `--spacing-4` |
| 5 | 20px | `--spacing-5` |
| 6 | 24px | `--spacing-6` |
| 8 | 32px | `--spacing-8` |
| 10 | 40px | `--spacing-10` |
| 12 | 48px | `--spacing-12` |
| 16 | 64px | `--spacing-16` |
| 20 | 80px | `--spacing-20` |
| 24 | 96px | `--spacing-24` |
| 32 | 128px | `--spacing-32` |

### Border Radius

| Name | Value | Token |
|------|-------|-------|
| default | 0.3rem (≈5px) | `--radius` |
| sm | calc(0.3rem - 2px) | `--radius-sm` |
| xl | 0.75rem (12px) | `--radius-xl` |
| 2xl | 1rem (16px) | `--radius-2xl` |
| pill | 9999px | `--radius-full` |

| Element | Value |
|---------|-------|
| buttons | 0.3rem |
| inputs | 0.3rem |
| cards | 0.75rem–1rem |
| badges / chips | 9999px (pill) |

### Shadows

The source uses Tailwind's ring/shadow variable system but applies essentially no elevation shadows on marketing surfaces — depth is carried by the `#dde1e7` hairline border and surface color steps. Use borders, not shadows.

| Name | Value | Token |
|------|-------|-------|
| card | `0 1px 2px rgba(17,24,39,0.04)` (optional, very subtle) | `--shadow-card` |
| none | `none` (default for most surfaces) | `--shadow-none` |

### Layout

- **Section gap:** 96px–128px
- **Card padding:** 24px
- **Element gap:** 16px–24px
- **Max content width:** 1200px (centered, generous side gutters)

## Components

### Primary Button
**Role:** Main CTA ("Start for free", "Get started", "Create free account")
- background: `{color.primary}` (#1473ff)
- color: `{color.primary-foreground}` (#ffffff)
- border-radius: `{radius}` (0.3rem)
- padding: 10px 18px
- font: Lexend 14–15px / 500 / -0.01em
- hover: brightness ~0.95 (slightly darker blue)
- active: transform scale(0.98)
- focus-visible: 2px ring `{color.ring}` (#1473ff) + 2px offset

### Secondary Button
**Role:** Alternate CTA ("Browse models", "See the marketplace")
- background: `{color.secondary}` (#e9ecf0) or transparent
- color: `{color.secondary-foreground}` (#374151)
- border: 1px solid `{color.border}` (#dde1e7) when ghost
- border-radius: 0.3rem
- padding: 10px 18px
- font: Lexend 14–15px / 500
- hover: background #e1e5ea

### Ghost / Nav Link
**Role:** Top navigation (Marketplace, Plans, How it works, Providers, Docs)
- background: transparent
- color: `{color.muted-foreground}` (#6b7280)
- font: Lexend 14px / 500
- hover: color `{color.foreground}` (#111827)
- active page: color `{color.foreground}`

### Badge / Eyebrow Pill
**Role:** "LLM API Marketplace is now live", section eyebrows, pricing tags (Flagship/Latest/Value)
- background: `{color.accent}` (#e8f1ff)
- color: `{color.accent-foreground}` (#0d55c4)
- border-radius: 9999px (pill)
- padding: 4px 12px
- font: Lexend 12px / 500 / 0.05em
- variant (status): success uses #16a34a text on #16a34a14 wash

### Feature Card
**Role:** 6-up feature grid (One Key Every Model, Verified Providers, Pay Per Token…)
- background: `{color.card}` (#ffffff)
- border: 1px solid `{color.border}` (#dde1e7)
- border-radius: `{radius-xl}` (0.75rem)
- padding: 24px
- title: Lexend 18px / 600 / #111827
- body: Lexend 14–15px / 400 / #6b7280
- icon: 20px, #1473ff in a #e8f1ff rounded square
- hover: border-color #1473ff33, subtle lift

### Pricing / Models Table
**Role:** "Latest models" table (Model, Provider, Input/1M, Output/1M)
- container: white card, 1px #dde1e7 border, 0.75rem radius
- header row: #6b7280 12px / 500 / uppercase, 0.05em
- row: #111827 14px, divider 1px #dde1e7
- price cells: monospace-ish tabular, #111827
- tag chips: pill, #e8f1ff / #0d55c4 (Flagship, Latest, Value, Coding, Fast, Cheap…)
- row hover: background #f6f8fb

### Code / Terminal Card
**Role:** Integration snippets, base-URL examples, "config", CLI commands
- background: `{docs-code-bg}` (#0d1117)
- header bar: `{docs-code-header}` (#161b22), title in #8b949e
- text: `{docs-code-foreground}` (#e6edf3), monospace 13–14px / 1.5
- comments: #8b949e
- highlight line: #4d8eff1a background
- border-radius: 0.75rem

### Input Field
**Role:** Email / search / API config inputs
- background: `{color.card}` (#ffffff)
- border: 1px solid `{color.input}` (#dde1e7)
- border-radius: 0.3rem
- padding: 10px 12px
- font: Lexend 14px / #111827
- placeholder: #6b7280
- focus: border #1473ff + 2px ring #1473ff33

### Stat Block
**Role:** Hero metrics (120M+, 150+, 30+, <2000ms)
- value: Lexend 30–36px / 700 / #111827 / -0.025em
- label: Lexend 14px / 400 / #6b7280

### Navigation Bar
**Role:** Sticky top bar
- background: rgba(246,248,251,0.8) with backdrop-blur, 1px bottom border #dde1e7
- logo: "Foza" wordmark, Lexend 18px / 700 / #111827
- links: ghost nav links (above)
- right: "Sign in" ghost + "Get started" primary button

### Footer
**Role:** Site footer
- background: `{color.background}` (#f6f8fb), 1px top border #dde1e7
- columns: link groups, Lexend 14px / #6b7280, headings #111827 / 600
- bottom: "© 2026 Foza", Discord / Zalo links, #6b7280

## Surfaces

Foza ships two themes. Default (documented above) is **light**. A complete **dark** palette is defined for `.dark` — visually distinct, so treat it as a separate mode (do not blend).

### Light (default)
| Level | Name | Value | Purpose |
|-------|------|-------|---------|
| 0 | Canvas | `#f6f8fb` | Base page background |
| 1 | Card | `#ffffff` | Cards, panels, nav |
| 2 | Secondary/Muted | `#e9ecf0` | Chips, tracks, secondary buttons |
| code | Code BG | `#0d1117` | Terminal / code blocks |

### Dark (`.dark`, distinct mode)
| Token | Value |
|-------|-------|
| `--background` | `#0d0d14` |
| `--foreground` | `#f1f1f4` |
| `--card` | `#1c1c2e` |
| `--sidebar` | `#0f0f1a` |
| `--primary` | `#4d8eff` |
| `--secondary` / `--muted` | `#1c1c2e` |
| `--muted-foreground` | `#6b7280` |
| `--accent` | `#0c1f45` |
| `--accent-foreground` | `#80aeff` |
| `--border` / `--input` | `#252535` |
| `--ring` | `#4d8eff` |
| `--success` | `#22c55e` |
| `--warning` | `#f59e0b` |
| `--destructive` | `#ef4444` |

## Do's and Don'ts

### Do
- Use `#f6f8fb` as the canvas and pure `#ffffff` for every card so surfaces read as floating panels.
- Reserve `#1473ff` for primary buttons, links, and focus rings only — it is the single brand signal.
- Separate surfaces with the `#dde1e7` hairline border, not drop shadows; this is a flat, border-led system.
- Set all headings in Lexend with `-0.025em` tracking and weight 600–700 for the crisp display voice.
- Put body and muted copy in `#6b7280` at 14–16px to keep the calm, low-contrast hierarchy.
- Render code, API keys, and CLI snippets on the `#0d1117` GitHub surface with `#e6edf3` monospace text.
- Use pill badges with `#e8f1ff` background / `#0d55c4` text for eyebrows and pricing tags (Flagship, Value…).
- Keep radii small (`0.3rem`) on buttons/inputs and slightly larger (`0.75–1rem`) on cards.

### Don't
- Don't introduce gradients or glows — the source has none; depth is borders + surface steps only.
- Don't use `#1473ff` for large background fills or body text; it is for action and links, never decoration.
- Don't drop heavy shadows on cards; a 1px `#dde1e7` border is the intended elevation cue.
- Don't mix the dark `.dark` palette tokens into the light theme — keep the two modes fully separate.
- Don't set headings without `-0.025em` tracking; loose tracking breaks Lexend's display voice.
- Don't use the `#0d1117` code surface for non-code content — it is reserved for snippets and terminals.
- Don't pick a second accent hue; success `#16a34a`, warning `#d97706`, destructive `#dc2626` are status-only.
- Don't enlarge button radius into pills — pills are for badges/chips, buttons stay at `0.3rem`.

## Imagery

Foza's visual language is UI-as-illustration: there are no photos or abstract 3D renders. The decorative weight is carried by realistic product surfaces — a pricing table of live models, a "Provider Console" earnings card with real numbers ($1,284.50, 48,291 requests, 142ms), and dark terminal/code cards showing `base_url` and `sk-foza-xxxx`. Integration logos (OpenAI, Cursor, Claude Code, Codex CLI, OpenClaw, Harness) appear as small, monochrome-ish lockups in a compatibility strip. Icons are simple line/solid glyphs at ~20px, tinted `#1473ff` and seated in soft `#e8f1ff` rounded-square chips. The effect is a trustworthy, data-forward developer dashboard — show the product, not metaphors.

## Layout

A max-width (~1200px) centered column on a `#f6f8fb` canvas, vertical-rhythm stacked sections separated by 96–128px gaps. The hero is centered: status pill → two-line display headline → muted subtitle → primary + secondary CTA → a 4-up stat row. Below it, a horizontal integration/compatibility strip, then a 3-column feature card grid, a full-width models pricing table, a tabbed code-example block, a 4-step "How it works" row, a two-column provider section pairing copy with a Provider Console card, a final centered CTA band, and a multi-column footer. Navigation is a sticky, blurred top bar with a wordmark, center links, and a right-aligned Sign in / Get started pair. Responsive: grids collapse to single column, nav to a menu, display type scales down to ~36px on mobile.

## Agent Prompt Guide

Quick Color Reference:
```
text:           #111827
muted text:     #6b7280
background:      #f6f8fb
card:            #ffffff
border:          #dde1e7
accent:          #1473ff (primary action + links)
accent wash:     #e8f1ff / text #0d55c4 (badges)
code surface:    #0d1117 / text #e6edf3
```

Example Component Prompts:
1. **Primary Button** — `#1473ff` background, `#ffffff` text, `0.3rem` radius, 10px/18px padding, Lexend 15px/500. Hover slightly darker, focus ring `#1473ff`. Use for "Start for free".
2. **Feature Card** — White (`#ffffff`) card, 1px `#dde1e7` border, `0.75rem` radius, 24px padding. 20px `#1473ff` icon in a `#e8f1ff` rounded chip. Title "One Key, Every Model" in Lexend 18px/600/`#111827`; body in Lexend 14px/400/`#6b7280`.
3. **Models Pricing Row** — White card with `#dde1e7` divider rows. Header labels `#6b7280` 12px/500 uppercase 0.05em. Cells `#111827` 14px. Tag pill `#e8f1ff`/`#0d55c4` reading "Flagship". Row hover background `#f6f8fb`.

## Similar Brands

- **OpenRouter** — Same category (multi-model LLM API gateway); shares the model-pricing-table-as-hero and OpenAI-compatible base-URL pitch.
- **Stripe** — Sophisticated neutral canvas with one confident blue accent, immaculate type, and product-surface imagery over decoration.
- **Vercel / Resend** — Flat, border-led developer-product aesthetic with monospace code cards and minimal shadow.
- **Linear** — Tight `-0.025em` display typography and a calm, low-chroma surface system (Foza is its light-mode cousin).
- **Together AI / Fireworks** — Adjacent AI-infra marketing pages built around model catalogs and copy-paste API snippets.

## Quick Start

### CSS Custom Properties

```css
:root {
  /* Colors — Light (default) */
  --color-background: #f6f8fb;
  --color-foreground: #111827;
  --color-card: #ffffff;
  --color-card-foreground: #111827;
  --color-sidebar: #ffffff;
  --color-sidebar-foreground: #374151;
  --color-primary: #1473ff;
  --color-primary-foreground: #ffffff;
  --color-secondary: #e9ecf0;
  --color-secondary-foreground: #374151;
  --color-muted: #e9ecf0;
  --color-muted-foreground: #6b7280;
  --color-accent: #e8f1ff;
  --color-accent-foreground: #0d55c4;
  --color-border: #dde1e7;
  --color-input: #dde1e7;
  --color-ring: #1473ff;
  --color-success: #16a34a;
  --color-warning: #d97706;
  --color-destructive: #dc2626;

  /* Code surface (theme-independent) */
  --docs-code-bg: #0d1117;
  --docs-code-header: #161b22;
  --docs-code-foreground: #e6edf3;
  --docs-code-muted: #8b949e;
  --docs-code-hover: rgba(255,255,255,0.1);
  --docs-code-highlight: rgba(77,142,255,0.1);

  /* Typography — Families */
  --font-sans: "Lexend", "Lexend Fallback", ui-sans-serif, system-ui, sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;

  /* Typography — Scale */
  --text-xs: 0.75rem;
  --text-sm: 0.875rem;
  --text-base: 1rem;
  --text-lg: 1.125rem;
  --text-xl: 1.25rem;
  --text-2xl: 1.5rem;
  --text-3xl: 1.875rem;
  --text-4xl: 2.25rem;
  --text-5xl: 3rem;
  --text-6xl: 3.75rem;
  --text-7xl: 4.5rem;

  /* Typography — Weights */
  --font-weight-normal: 400;
  --font-weight-medium: 500;
  --font-weight-semibold: 600;
  --font-weight-bold: 700;

  /* Typography — Tracking & Leading */
  --tracking-tight: -0.025em;
  --tracking-wider: 0.05em;
  --tracking-widest: 0.1em;
  --leading-tight: 1.25;
  --leading-snug: 1.375;
  --leading-normal: 1.5;
  --leading-relaxed: 1.625;

  /* Spacing */
  --spacing-1: 4px;
  --spacing-2: 8px;
  --spacing-3: 12px;
  --spacing-4: 16px;
  --spacing-5: 20px;
  --spacing-6: 24px;
  --spacing-8: 32px;
  --spacing-10: 40px;
  --spacing-12: 48px;
  --spacing-16: 64px;
  --spacing-20: 80px;
  --spacing-24: 96px;
  --spacing-32: 128px;

  /* Border Radius */
  --radius: 0.3rem;
  --radius-sm: calc(0.3rem - 2px);
  --radius-xl: 0.75rem;
  --radius-2xl: 1rem;
  --radius-full: 9999px;
}

/* Dark mode (distinct — apply on .dark) */
.dark {
  --color-background: #0d0d14;
  --color-foreground: #f1f1f4;
  --color-card: #1c1c2e;
  --color-sidebar: #0f0f1a;
  --color-sidebar-foreground: #c9c9d9;
  --color-primary: #4d8eff;
  --color-primary-foreground: #ffffff;
  --color-secondary: #1c1c2e;
  --color-secondary-foreground: #c9c9d9;
  --color-muted: #1c1c2e;
  --color-muted-foreground: #6b7280;
  --color-accent: #0c1f45;
  --color-accent-foreground: #80aeff;
  --color-border: #252535;
  --color-input: #252535;
  --color-ring: #4d8eff;
  --color-success: #22c55e;
  --color-warning: #f59e0b;
  --color-destructive: #ef4444;
}
```

### Tailwind v4

```css
@theme {
  --color-background: #f6f8fb;
  --color-foreground: #111827;
  --color-card: #ffffff;
  --color-primary: #1473ff;
  --color-primary-foreground: #ffffff;
  --color-secondary: #e9ecf0;
  --color-muted: #e9ecf0;
  --color-muted-foreground: #6b7280;
  --color-accent: #e8f1ff;
  --color-accent-foreground: #0d55c4;
  --color-border: #dde1e7;
  --color-ring: #1473ff;
  --color-success: #16a34a;
  --color-warning: #d97706;
  --color-destructive: #dc2626;

  --font-sans: "Lexend", "Lexend Fallback", ui-sans-serif, system-ui, sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;

  --text-xs: 0.75rem;
  --text-sm: 0.875rem;
  --text-base: 1rem;
  --text-lg: 1.125rem;
  --text-xl: 1.25rem;
  --text-2xl: 1.5rem;
  --text-3xl: 1.875rem;
  --text-4xl: 2.25rem;
  --text-5xl: 3rem;
  --text-6xl: 3.75rem;
  --text-7xl: 4.5rem;

  --radius: 0.3rem;
  --radius-xl: 0.75rem;
  --radius-2xl: 1rem;
}
```
