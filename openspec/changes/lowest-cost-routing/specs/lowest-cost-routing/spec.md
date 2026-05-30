## ADDED Requirements

### Requirement: Lowest-cost account selection for pooled models

The account pool SHALL provide a `lowest_cost` selection strategy that, given the healthy/available candidates for a base model and a cost lookup, selects the candidate with the lowest cost. Ties SHALL be broken by least active requests, then by lowest priority value, then by stable order. Candidates without a known cost SHALL be excluded.

#### Scenario: Cheapest candidate selected

- **WHEN** the `gpt-5.5` pool has healthy candidates costing `$2.10`, `$2.30` (house), and `$2.40`
- **THEN** the strategy SHALL select the `$2.10` candidate

#### Scenario: Failover skips the unhealthy cheapest

- **WHEN** the `$2.10` candidate is unavailable and the remaining healthy candidates cost `$2.30` (house) and `$2.40`
- **THEN** the strategy SHALL select the `$2.30` house candidate

#### Scenario: Equal cost breaks tie by least busy

- **WHEN** two candidates both cost `$2.20`, one with 1 active request and one with 4
- **THEN** the strategy SHALL select the one with 1 active request

#### Scenario: Candidate without cost is excluded

- **WHEN** a candidate has no cost entry in the lookup
- **THEN** it SHALL NOT be selected by the `lowest_cost` strategy

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

After routing a marketplace request, the gateway SHALL record the routed `sellerId`, `accountId`, the candidate `costPrice`, and the derived sell rates, so post-request settlement can charge the buyer and credit the seller. This requirement SHALL NOT itself move any money.

#### Scenario: Routing decision carries settlement inputs

- **WHEN** a pooled `gpt-5.5` request is routed to the cinb candidate
- **THEN** the request context SHALL carry `sellerId = cinb`, the cinb cost price, and the sell rates derived from it
