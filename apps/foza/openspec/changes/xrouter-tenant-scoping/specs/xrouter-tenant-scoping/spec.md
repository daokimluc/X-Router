# xrouter-tenant-scoping

X-Router performs no tenant isolation — it executes any `keyId`/`sellerId`/
`listingId` passed on a `/provision/*` call. Foza is the trust boundary and SHALL
verify every client-supplied resource id belongs to the authenticated user before
forwarding the call. This closes the cross-tenant manipulation gap in the
end-user-facing server actions.

## ADDED Requirements

### Requirement: Self-scoped provision writes

Every `/provision/*` write triggered by an end-user action SHALL act only on a
resource owned by the authenticated user.

#### Scenario: Owner allowed
- **WHEN** a logged-in user triggers an action on a `keyId`/`sellerId`/`listingId`
  that belongs to them
- **THEN** the action SHALL proceed

#### Scenario: Non-owner rejected
- **WHEN** a logged-in user supplies a `keyId`/`sellerId`/`listingId` they do not
  own (e.g. by editing a form field)
- **THEN** the action SHALL be rejected with a forbidden error and SHALL make no
  `/provision/*` call

#### Scenario: Unauthenticated rejected
- **WHEN** there is no logged-in session
- **THEN** the action SHALL be rejected and SHALL make no `/provision/*` call

### Requirement: Ownership resolved from durable mapping

Ownership SHALL be decided from Foza's persisted `user→keyId/sellerId` mapping, not
from client-supplied claims.

#### Scenario: Listing ownership via seller
- **WHEN** a listing id is checked
- **THEN** its `sellerId` SHALL be resolved (live from X-Router) and matched against
  the user's persisted seller mapping

#### Scenario: Mapping survives restart
- **WHEN** the server has restarted since the resource was provisioned
- **THEN** the ownership check SHALL still succeed for the rightful owner (mapping is
  durable, per foza-persistence)

### Requirement: Admin actions remain cross-tenant

Operator/admin actions SHALL keep their admin gate and SHALL NOT be forced into
per-user self-scoping.

#### Scenario: Admin acts across tenants
- **WHEN** an admin (allowed by `FOZA_ADMIN_EMAILS`) approves a seller or sets
  markup
- **THEN** the action SHALL proceed under the `isAdmin()` gate without requiring the
  resource to belong to the admin's own account
