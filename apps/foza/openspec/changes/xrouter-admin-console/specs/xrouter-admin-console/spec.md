# xrouter-admin-console

An in-Foza, admin-gated operator console backed by an X-Router admin key, for the
frequently-used marketplace management actions (plan CRUD, markup, seller approval
and terms, canonical models). Money-reversing actions (reverse/adjust earnings,
reverse settlement) are intentionally NOT here — they stay on the X-Router
dashboard.

## ADDED Requirements

### Requirement: Admin key is a server-only auth dimension

Foza SHALL use a dedicated admin key for `/admin/v1/*` calls, never exposed to the
client.

#### Scenario: Admin key stays server-side
- **WHEN** an admin action calls an `/admin/v1/*` endpoint
- **THEN** the admin key SHALL be attached only by server code and SHALL never be
  present in a client bundle

#### Scenario: Separate from provision key
- **WHEN** Foza calls `/provision/*` vs `/admin/v1/*`
- **THEN** it SHALL use the provision key for the former and the admin key for the
  latter, holding both server-side

### Requirement: Admin actions gated by FOZA_ADMIN_EMAILS

Every operator action SHALL require an authenticated admin.

#### Scenario: Admin allowed
- **WHEN** a user in `FOZA_ADMIN_EMAILS` triggers a plan/markup/seller/canonical
  action
- **THEN** it SHALL proceed

#### Scenario: Non-admin blocked
- **WHEN** a non-admin user attempts any operator action
- **THEN** it SHALL be rejected and SHALL make no `/admin/v1/*` call

### Requirement: Plan management in Foza

The operator SHALL create, edit, and delete plans from within Foza.

#### Scenario: Create a plan
- **WHEN** an admin creates a plan in the Foza admin console
- **THEN** Foza SHALL call `/admin/v1/plans`, and the new plan SHALL subsequently
  appear in `GET /provision/plans` for the buyer plan picker

### Requirement: Seller and catalog management in Foza

The operator SHALL approve/suspend/reject sellers, edit seller terms, set markup,
and manage canonical models from within Foza.

#### Scenario: Reject a seller
- **WHEN** an admin rejects a pending seller
- **THEN** Foza SHALL call `/admin/v1/sellers/:id/reject`

#### Scenario: Canonical precondition for listings
- **WHEN** an admin adds a canonical base model
- **THEN** a listing for that base model SHALL become creatable

### Requirement: Money-reversing actions excluded

Settlement/earnings reversal SHALL NOT be exposed in the Foza console.

#### Scenario: Reverse handled on the X-Router dashboard
- **WHEN** the operator needs to reverse/adjust earnings or reverse a settlement
- **THEN** Foza SHALL direct them to the X-Router dashboard and SHALL NOT perform
  the reversal itself
