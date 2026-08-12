# xrouter-seller-listing

Create marketplace listings from within Foza for both platform (house) supply —
admin-gated, full-margin — and a seller's own approved supply — owner-scoped — with
provider instance/account selection sourced live from X-Router.

## ADDED Requirements

### Requirement: Create house listings (platform supply)

An admin SHALL create platform-owned listings from Foza.

#### Scenario: Admin creates a house listing
- **WHEN** an admin submits the listing form with source = house
- **THEN** Foza SHALL call `POST /provision/listing` with `sellerId="house"`, and the
  listing SHALL appear in `GET /provision/listings` and on the marketplace

#### Scenario: Non-admin cannot create house listings
- **WHEN** a non-admin attempts a house listing
- **THEN** the action SHALL be rejected and SHALL make no `/provision/*` call

### Requirement: Create seller listings (owner-scoped)

An approved seller SHALL create listings under their own seller only.

#### Scenario: Approved seller lists a model
- **WHEN** an approved seller submits the listing form
- **THEN** the `sellerId` SHALL be resolved from the session's account mapping (not
  the form) and the listing SHALL be created namespaced `<seller>/<model>`

#### Scenario: Non-seller blocked
- **WHEN** a user who is not an approved seller submits the seller form
- **THEN** the action SHALL be rejected with no `/provision/*` call

#### Scenario: Cannot inject another seller
- **WHEN** the form is tampered to reference a seller the user does not own
- **THEN** the action SHALL ignore it and use only the caller's own sellerId

### Requirement: Listing inputs validated against live supply

The form SHALL only offer valid models and provider sources.

#### Scenario: Canonical model only
- **WHEN** the model dropdown is shown
- **THEN** it SHALL list only canonical base models from X-Router

#### Scenario: Account belongs to instance
- **WHEN** a provider instance is chosen
- **THEN** the account dropdown SHALL show only accounts belonging to that instance

#### Scenario: Invalid cost rejected
- **WHEN** input or output price is missing or negative
- **THEN** the action SHALL reject before calling X-Router
