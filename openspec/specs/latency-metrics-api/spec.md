# latency-metrics-api Specification

## Purpose
TBD - created by archiving change latency-observability. Update Purpose after archive.
## Requirements
### Requirement: Admin endpoint returns latency snapshot

The gateway SHALL expose `GET /admin/v1/metrics/latency` (admin auth required) that returns the current rolling-window snapshot for every active tuple.

The response SHALL be a JSON object:
```
{
  "windowSeconds": 300,
  "tuples": [
    {
      "providerInstanceId": string,
      "publicModel":        string,
      "accountId":          string,
      "ok":    { "count": number, "p50": number|null, "p95": number|null, "p99": number|null },
      "error": { "count": number, "p50": number|null, "p95": number|null, "p99": number|null }
    },
    ...
  ]
}
```

#### Scenario: Admin gets snapshot of all tracked tuples

- **WHEN** an authenticated admin calls `GET /admin/v1/metrics/latency`
- **THEN** the response SHALL contain `windowSeconds: 300` and one `tuples[]` entry per active tuple

#### Scenario: Unauthenticated request returns 401

- **WHEN** the endpoint is called without admin auth
- **THEN** the gateway SHALL return HTTP 401 and SHALL NOT include any latency data in the response

#### Scenario: No traffic returns empty tuples array

- **WHEN** no requests have completed in the last 5 minutes
- **THEN** the response SHALL return `windowSeconds: 300, tuples: []`

