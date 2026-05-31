## ADDED Requirements

### Requirement: Group-to-member model expansion over the provision key

The gateway SHALL expose, authenticated by the provision API key alone (admin and client
keys rejected), the inverse of its model→group classification: a `group → member models`
map and, on the plan list, the concrete models each plan grants. The member models SHALL
be derived from the gateway's single model→group classifier (the same function used by
plan enforcement), so the website never copies classification rules. A plan granting all
groups (`"*"`) SHALL be represented as `["*"]` rather than an enumerated list.

#### Scenario: Plan list embeds expanded models

- **WHEN** the website calls `GET /provision/plans` with a valid provision key
- **THEN** each plan SHALL include a `models` field expanded from its `modelGroups` — the union of the granted groups' member models, or `["*"]` when the plan grants all groups

#### Scenario: Group-to-members map is available

- **WHEN** the website calls `GET /provision/model-groups` with a valid provision key
- **THEN** the response SHALL return each group mapped to its member models, classified by the same function the gateway uses to enforce plan scope

#### Scenario: Admin or client key is rejected

- **WHEN** either endpoint is called with an admin key or a client API key
- **THEN** the request SHALL be rejected exactly as the other `/provision/*` reads

### Requirement: The free group is always populated from its curated set

The expansion SHALL always include the curated free-model set in the `free` group,
independent of the canonical model list, because that set cannot be derived from the
classification rules. A plan granting `free` SHALL therefore never render zero models.

#### Scenario: Free plan shows its curated models

- **WHEN** the model-group expansion runs (even if no canonical model classifies as free)
- **THEN** the `free` group SHALL contain the curated free models, and a plan with `modelGroups: ["free"]` SHALL expand to those models

### Requirement: Optional filtering to actually-available models

The group-to-members endpoint SHALL support restricting members to models that are
actually serveable — those with at least one enabled listing from an approved seller — so
the website can choose to show only models a buyer can call.

#### Scenario: activeOnly keeps only listed models

- **WHEN** `GET /provision/model-groups?activeOnly=true` is called
- **THEN** the returned members SHALL exclude canonical models that have no enabled listing from an approved seller
