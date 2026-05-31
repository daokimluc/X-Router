# admin-error-semantics Specification

## Purpose
TBD - created by archiving change admin-routes-decompose. Update Purpose after archive.
## Requirements
### Requirement: Correct HTTP status for admin input and missing resources

Admin endpoints SHALL return HTTP 400 with a field-level message when a request body
or parameter fails validation, and SHALL return HTTP 404 when a referenced resource
does not exist. Malformed input or a missing resource SHALL NOT surface as a generic
HTTP 500. All admin error responses SHALL use the consistent
`{ error: { type, message, code } }` envelope.

#### Scenario: Malformed admin body returns 400

- **WHEN** an admin request body or parameter fails schema validation
- **THEN** the response SHALL be HTTP 400 with a message identifying the invalid field, not HTTP 500

#### Scenario: Missing resource returns 404

- **WHEN** an admin handler references an account, instance, key, or other resource that does not exist
- **THEN** the response SHALL be HTTP 404 with the error envelope, not HTTP 500

#### Scenario: Auth and route contracts unchanged

- **WHEN** an admin route is invoked after decomposition into per-domain modules
- **THEN** its path, admin-key auth requirement, and success response SHALL be identical to before

