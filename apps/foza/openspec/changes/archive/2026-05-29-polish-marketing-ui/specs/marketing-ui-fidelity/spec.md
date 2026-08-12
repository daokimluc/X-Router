# marketing-ui-fidelity

Visual and interaction fidelity requirements for Foza's public marketing pages, measured against the original foza.ai rendered DOM (`template/home.html`). These requirements define the target appearance and interaction states; they are presentational and apply across both locales (`vi`, `en`) and both themes (light, dark).

## ADDED Requirements

### Requirement: Hero headline scale

The homepage hero headline SHALL scale responsively to match the original, growing from mobile to desktop and using tight leading.

#### Scenario: Desktop headline size
- **WHEN** the homepage is viewed at the `lg` breakpoint (≥1024px)
- **THEN** the hero `h1` SHALL render at `text-7xl` (72px) with `leading-[1.05]`

#### Scenario: Responsive ramp
- **WHEN** the viewport is below `sm`
- **THEN** the hero `h1` SHALL render at `text-4xl`, stepping to `text-5xl` at `sm` and `text-7xl` at `lg`

### Requirement: Navbar surface

The sticky site header SHALL use the sidebar surface token with a subtle blur, matching the original.

#### Scenario: Header background
- **WHEN** the marketing header is rendered
- **THEN** it SHALL use `bg-sidebar` with `backdrop-blur-sm` and a bottom `border-border`, not a translucent background background

### Requirement: Feature card elevation and hover

Feature cards SHALL present as bordered surfaces that lift and gain a shadow on hover, with a smooth transition.

#### Scenario: Resting state
- **WHEN** a feature card is at rest
- **THEN** it SHALL be `rounded-xl border border-border bg-card` with no drop shadow

#### Scenario: Hover state
- **WHEN** the pointer hovers a feature card
- **THEN** the card SHALL apply `hover:border-primary/40 hover:shadow-md hover:-translate-y-0.5` over `transition-all duration-200`

### Requirement: Feature icon treatment

Feature icons SHALL render in a small bordered, transparent container matching the original, not a large filled chip.

#### Scenario: Icon container
- **WHEN** a feature card icon is rendered
- **THEN** its container SHALL be `h-8 w-8 rounded-lg border border-border bg-transparent text-foreground` with `hover:bg-accent/80`

### Requirement: Surface and border tokens

Marketing surfaces SHALL use the Foza palette tokens exactly, including softened borders where the original uses them.

#### Scenario: Canvas and card surfaces
- **WHEN** any marketing section is rendered in light theme
- **THEN** the page background SHALL be `--background` (#f6f8fb) and cards SHALL be `--card` (#ffffff) separated by `--border` (#dde1e7) hairlines, with no gradients or glows

#### Scenario: Softened stat borders
- **WHEN** hero stat cards are rendered
- **THEN** they SHALL use `border-border/80` to match the original's softer edge

### Requirement: Section rhythm

Marketing sections SHALL follow the original's vertical spacing cadence.

#### Scenario: Section padding
- **WHEN** stacked marketing sections are rendered
- **THEN** each SHALL use the original `py-20`/`py-24` padding rhythm within a `max-w-7xl` container

### Requirement: Theme and locale parity

All fidelity requirements SHALL hold across both supported themes and locales.

#### Scenario: Dark mode parity
- **WHEN** the user toggles dark mode on any marketing page
- **THEN** the page SHALL switch to the dark palette (`--background` #0d0d14, `--primary` #4d8eff, etc.) with all elevation/hover states preserved

#### Scenario: Locale parity
- **WHEN** the user switches between `vi` and `en`
- **THEN** layout, spacing, and elevation SHALL remain identical and only text content SHALL change
