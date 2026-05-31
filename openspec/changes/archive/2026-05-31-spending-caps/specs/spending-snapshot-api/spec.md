## ADDED Requirements

### Requirement: Snapshot endpoint for spend per scope

The gateway SHALL expose two admin endpoints (admin auth required):

- `GET /admin/v1/spend/key/:id` — return current period spend and remaining budget for a single API key.
- `GET /admin/v1/spend/team/:id` — return current period spend and remaining budget for a team.

The response SHALL be:
```
{
  "scope": "key" | "team",
  "id":    string,
  "today":     { "spent": number, "cap": number | null, "remainingPct": number | null },
  "thisMonth": { "spent": number, "cap": number | null, "remainingPct": number | null },
  "lastBlocked": ISO8601 string | null
}
```

When a cap is `null` (unlimited), `remainingPct` SHALL also be `null`.

#### Scenario: Key with day cap returns spent and remaining

- **WHEN** an admin calls `GET /admin/v1/spend/key/abc123` for a key with `dailySpendLimitUsd = 10.00` and current day spend `2.34`
- **THEN** the response SHALL contain `today.spent = 2.34`, `today.cap = 10.00`, `today.remainingPct ≈ 76.6`

#### Scenario: Key without caps returns null caps

- **WHEN** an admin calls the endpoint for a key with no caps and no team
- **THEN** the response SHALL contain `today.cap = null`, `today.remainingPct = null`, and `today.spent` reflecting any tracked spend

#### Scenario: Unauthenticated request returns 401

- **WHEN** the endpoint is called without admin auth
- **THEN** the gateway SHALL return HTTP 401

#### Scenario: Team scope returns team-level totals

- **WHEN** an admin calls `GET /admin/v1/spend/team/default` and the team has 3 keys totaling `15.00` spent today
- **THEN** the response `today.spent` SHALL equal the team-level ledger total (computed from the same atomic increments that decrement individual keys), not the sum of per-key spend at read time
