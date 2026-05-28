## ADDED Requirements

### Requirement: Charts panel inside Usage page

The Usage page SHALL render a `UsageChartsPanel` component below the existing model leaderboard. The panel SHALL fetch from `GET /admin/v1/usage/aggregate` using the page-level time range selector and render three views switchable by tab.

#### Scenario: Trend tab shows stacked area chart

- **WHEN** the user opens the Usage page with the Trend tab active and the page-level range is `7d`
- **THEN** the panel SHALL display a stacked area chart with the X axis bucketed in hours and one stacked area per top-10 model plus `_other`, with the Y axis showing the currently selected metric (cost by default)

#### Scenario: Proportion tab shows pie chart

- **WHEN** the user clicks the Proportion tab
- **THEN** the panel SHALL display a pie chart with one slice per series proportional to `totalCost` over the selected window

#### Scenario: Top tab shows horizontal bar chart

- **WHEN** the user clicks the Top tab
- **THEN** the panel SHALL display a horizontal bar chart sorted by `totalCost` descending, one bar per series

#### Scenario: Metric switcher between cost, tokens, requests

- **WHEN** the user switches the metric selector to "Tokens"
- **THEN** all three chart views SHALL re-render against `totalTokens` / `perBucket.tokens` without issuing a new HTTP request

#### Scenario: Empty data state

- **WHEN** the aggregate endpoint returns `series: []`
- **THEN** the panel SHALL display a centered "No usage in selected range" message instead of an empty chart

### Requirement: Charts ship in a separately-loaded chunk

The chart library and `UsageChartsPanel` SHALL be loaded via `React.lazy` so that the JavaScript bytes for charting are NOT downloaded until the user navigates to the Usage page.

#### Scenario: Charts module not in initial bundle

- **WHEN** the dashboard is built for production
- **THEN** `recharts` and `UsageChartsPanel` SHALL be in a separate chunk file from the main entry chunk, and the main entry chunk size SHALL NOT include their bytes

#### Scenario: Lazy chunk fetched on Usage page entry

- **WHEN** the user navigates from Overview to Usage for the first time in a session
- **THEN** the browser SHALL issue a network request for the lazy chunk, and the panel SHALL render after the chunk loads

### Requirement: Page-level time range drives the panel

The panel SHALL read its `from`/`to` window from the existing `range` selector at the top of the Usage page and SHALL re-fetch the aggregate endpoint when that selector changes.

#### Scenario: Changing range refetches

- **WHEN** the user changes the page range from `7d` to `30d`
- **THEN** the panel SHALL issue a new request to `/admin/v1/usage/aggregate` with the updated `from` and `to` query parameters

### Requirement: Charts coexist with existing UsagePage content

The new panel SHALL render BELOW the existing model leaderboard table, and it SHALL NOT remove, hide, or restructure the existing topology graph, leaderboard, or totals cards.

#### Scenario: Existing UsagePage elements remain visible

- **WHEN** the user opens the Usage page after the panel ships
- **THEN** the totals cards, the topology graph, and the model leaderboard table SHALL remain rendered in the same DOM positions as before
