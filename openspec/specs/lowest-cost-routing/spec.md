# lowest-cost-routing Specification

## Purpose
TBD - created by archiving change lowest-cost-routing. Update Purpose after archive.
## Requirements
### Requirement: Lowest-cost account selection for pooled models

For a pooled base-model request, the gateway SHALL select the serving seller by
**lowest cost at the candidate layer** — where each candidate corresponds to one
seller's supply — trying the cheapest costed candidate first and failing over to
the next cheapest when a candidate is unavailable (disabled, circuit-open, or no
available account). Candidates without a known listing cost SHALL be ordered after
all costed candidates. Selection SHALL NOT depend on account-level cost comparison,
because per-seller cost varies between candidates, not between accounts within one
seller's pool.

#### Scenario: Cheapest seller selected

- **WHEN** the `gpt-5.5` pool has healthy seller candidates costing `$2.10`, `$2.30` (house), and `$2.40`
- **THEN** the request SHALL be served by the `$2.10` candidate

#### Scenario: Failover skips the unhealthy cheapest to the next cheapest

- **WHEN** the `$2.10` candidate's supply is unavailable and the remaining healthy candidates cost `$2.30` (house) and `$2.40`
- **THEN** the request SHALL be served by the `$2.30` house candidate, not the `$2.40` one

#### Scenario: House bounds the ceiling

- **WHEN** the only healthy candidates are house at `$2.30` and a third-party at `$2.40`
- **THEN** the request SHALL be served by house at `$2.30`

#### Scenario: Uncosted candidate is tried last

- **WHEN** a pooled candidate has no listing cost and others do
- **THEN** it SHALL be ordered after all costed candidates

### Requirement: House cost is the routing ceiling

When a healthy house candidate is present in a pool, the `lowest_cost` strategy SHALL never select a candidate priced above the house candidate, because the minimum-cost selection inherently bounds at or below the house cost.

#### Scenario: No third-party cheaper than house

- **WHEN** the only healthy candidates are house at `$2.30` and a third-party at `$2.40`
- **THEN** the strategy SHALL select the house candidate at `$2.30`

### Requirement: Sell price is cost times one plus markup

The gateway SHALL compute the buyer sell price for a base model as the routed candidate's cost multiplied by `(1 + markup)`, where `markup` is the per-base-model markup if configured, else the global default. The same computation SHALL apply to plan metering, boost, and overage (one price).

#### Scenario: Default markup applied

- **WHEN** the routed cost input rate is `$2.10/M`, no per-model markup is set, and the global default markup is `0.15`
- **THEN** the sell input rate SHALL be `$2.415/M`

#### Scenario: Per-model markup overrides default

- **WHEN** base model `gpt-5.5` has a configured markup of `0.20` and the global default is `0.15`
- **THEN** the sell price for `gpt-5.5` SHALL use `0.20`

#### Scenario: Zero markup sells at cost, never below

- **WHEN** a base model's markup is `0`
- **THEN** the sell price SHALL equal the cost (markup SHALL be validated to be `>= 0`)

### Requirement: Direct namespaced requests pin the seller

A request to a direct namespaced model (`<seller>/<baseModel>`) SHALL bypass cost-based selection and use that listing's own cost, computing the sell price from that seller's cost times `(1 + markup)`.

#### Scenario: Direct request uses the pinned seller's cost

- **WHEN** a buyer calls `hoang/gpt-5.5` whose listing cost input rate is `$2.40/M` with markup `0.15`
- **THEN** the request SHALL be served by hoang's account and the sell input rate SHALL be `$2.76/M`, regardless of cheaper sellers in the pool

### Requirement: Routed cost and sell rates captured for settlement

After a pooled or direct request acquires an account, the gateway SHALL record the
routed `sellerId`, `accountId`, the candidate `costPrice`, and the derived sell
rates **from the account actually leased**, so post-request settlement charges the
buyer and credits the seller that served the request. This requirement SHALL NOT
itself move any money, and SHALL NOT rely on a pre-routing approximation of which
seller will serve.

#### Scenario: Routed context reflects the leased seller

- **WHEN** a pooled `gpt-5.5` request fails over and is ultimately served by the `cinb` candidate's account
- **THEN** the request context SHALL carry `sellerId = cinb`, the cinb cost price, and the sell rates derived from it — even if a different seller was cheapest before failover

#### Scenario: Leased account without a listing cost

- **WHEN** the leased account has no listing cost (e.g. a non-marketplace account serving a pooled name)
- **THEN** no routed context SHALL be recorded and settlement SHALL use its no-routed fallback (settle the reservation, credit no seller)

