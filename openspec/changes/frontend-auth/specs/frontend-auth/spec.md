# frontend-auth

Client-side authentication for the Foza website. This phase uses a **mock** session (no backend); the requirements define the auth lifecycle, session persistence, route protection, and auth-page UI. The `AuthProvider` API is the seam that a later change (`integrate-xrouter`) backs with real X-Router OAuth/Bearer auth.

## ADDED Requirements

### Requirement: Session lifecycle

The app SHALL provide sign-in, registration, Google sign-in, and sign-out operations that create or clear a user session.

#### Scenario: Sign in with email
- **WHEN** a user submits the login form
- **THEN** a session SHALL be created and the user SHALL be redirected to the console (or to the `?next=` destination if present)

#### Scenario: Register
- **WHEN** a user submits the register form
- **THEN** a session SHALL be created and the user SHALL be redirected to the console

#### Scenario: Continue with Google
- **WHEN** a user activates "Continue with Google"
- **THEN** a session SHALL be created (mock) and the user SHALL be redirected to the console

#### Scenario: Sign out
- **WHEN** an authenticated user signs out from the console user menu
- **THEN** the session SHALL be cleared and the user SHALL be returned to the home page

### Requirement: Session persistence

A session SHALL survive page reloads and be readable by server middleware.

#### Scenario: Reload keeps session
- **WHEN** an authenticated user reloads any page
- **THEN** they SHALL remain authenticated without re-entering credentials

#### Scenario: Middleware can read session
- **WHEN** a request reaches the server middleware
- **THEN** the session state SHALL be available (via cookie) so the route guard can act before render

### Requirement: Console route protection

The console area SHALL be protected; unauthenticated access SHALL be redirected to login.

#### Scenario: Unauthenticated console access
- **WHEN** an unauthenticated user navigates to any `/console` route
- **THEN** they SHALL be redirected to `/login` with a `?next=` pointing back to the requested console route

#### Scenario: Post-login redirect to intended page
- **WHEN** a user signs in after being redirected from a protected route
- **THEN** they SHALL land on the originally requested route

### Requirement: Auth pages redirect when already signed in

Authenticated users SHALL NOT see the login/register pages.

#### Scenario: Authenticated visits login
- **WHEN** an authenticated user navigates to `/login` or `/register`
- **THEN** they SHALL be redirected to `/console`

### Requirement: Guard composes with locale routing

Route protection SHALL work for every supported locale and SHALL NOT break locale resolution.

#### Scenario: Locale-prefixed protected route
- **WHEN** an unauthenticated user visits `/vi/console` or `/en/console`
- **THEN** they SHALL be redirected to the login page in the same locale (`/vi/login` or `/en/login`)

### Requirement: Session-aware navigation

Navigation chrome SHALL reflect authentication state.

#### Scenario: Logged-out header
- **WHEN** a visitor is not authenticated
- **THEN** the site header SHALL show "Sign in" and "Get started" actions

#### Scenario: Logged-in header
- **WHEN** a visitor is authenticated
- **THEN** the site header SHALL show a link to the console and the user identity instead of sign-in/get-started

### Requirement: Auth page layout

The login and register pages SHALL use a two-column, OAuth-first layout matching foza.ai.

#### Scenario: Split layout with brand panel
- **WHEN** the login or register page is rendered on desktop
- **THEN** it SHALL show a branded left panel (headline + benefit bullets) and a right-side auth form; on mobile the form SHALL stack full-width

#### Scenario: OAuth-first form
- **WHEN** the auth form is rendered
- **THEN** "Continue with Google" SHALL be the primary action, with email/password as a secondary option, a Terms/Privacy notice, and a cross-link to the other auth page

#### Scenario: Theme and locale parity
- **WHEN** the auth pages are viewed in either theme or locale
- **THEN** all text SHALL be translated and all surfaces SHALL use semantic tokens with correct light/dark contrast
