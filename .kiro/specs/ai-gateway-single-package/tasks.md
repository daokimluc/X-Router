# Implementation Plan: AI Gateway Single Package

## Overview

Merge the AI Gateway (Fastify backend) and React Dashboard into a single deployable package. The implementation builds the dashboard into static files at package time and serves them directly from the Fastify gateway process via `@fastify/static`, with a CLI entry point for `npx` usage and a unified Dockerfile for container deployment.

## Tasks

- [x] 1. Set up root package.json and build infrastructure
  - [x] 1.1 Create root package.json with bin, files, engines, type, and scripts fields
    - Create `package.json` at project root with `"name": "ai-gateway"`, `"type": "module"`, `"bin": {"ai-gateway": "./bin/ai-gateway.js"}`, `"files": ["bin/", "dist/", "dashboard-dist/"]`, `"engines": {"node": ">=22"}`
    - Add `"prepack"` script that runs the build script
    - Add `"build"` and `"start"` scripts
    - Ensure `"private"` is NOT set to true
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_

  - [x] 1.2 Create build script (`scripts/build.mjs`)
    - Implement build script that: (1) builds dashboard via `cd apps/dashboard && npm ci && npm run build`, (2) copies dashboard dist output to `dashboard-dist/` at root, (3) builds gateway via `cd apps/gateway && npm ci && npm run build`, (4) copies gateway dist output to `dist/` at root
    - Exit with non-zero code and stderr output if any step fails
    - Check that `apps/dashboard/` exists before attempting build; exit with error if missing
    - Ensure dashboard builds before gateway (build order)
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

- [x] 2. Implement static file serving plugin
  - [x] 2.1 Create dashboard static serving plugin (`apps/gateway/src/plugins/dashboard.ts`)
    - Install `@fastify/static` as a dependency in `apps/gateway/`
    - Create plugin that registers `@fastify/static` with `dashboard-dist/` as root directory
    - Configure `decorateReply: false` to avoid conflicts if multiple static registrations exist
    - Set `prefix: "/"` and `wildcard: false` to serve files at root path
    - Resolve `dashboardRoot` path relative to the compiled dist location (use `path.resolve` with `import.meta.url`)
    - _Requirements: 2.1, 2.2_

  - [x] 2.2 Implement cache header logic in the dashboard plugin
    - Add `setHeaders` hook in `@fastify/static` configuration
    - For files matching hash pattern (`/\.[a-f0-9]{8,}\./`): set `Cache-Control: public, max-age=31536000, immutable`
    - For `index.html`: set `Cache-Control: no-cache, no-store, must-revalidate`
    - For other files without hash: set `Cache-Control: public, max-age=3600`
    - _Requirements: 2.5_

  - [x] 2.3 Implement SPA fallback and 404 handling
    - Use Fastify's `setNotFoundHandler` to implement SPA fallback
    - Define static file extensions list: `.js`, `.css`, `.png`, `.svg`, `.ico`, `.woff`, `.woff2`, `.ttf`, `.map`, `.jpg`, `.jpeg`, `.gif`, `.webp`
    - In the not-found handler: if request path has a static file extension, respond with 404; otherwise serve `index.html` with status 200
    - Ensure API route prefixes (`/admin`, `/v1`, `/healthz`, `/oauth`, `/readyz`, `/metrics`) are registered before this plugin so they take priority
    - _Requirements: 2.3, 2.4, 2.6_

  - [ ]* 2.4 Write property tests for static file serving
    - **Property 1: Content-Type determined by file extension**
    - **Property 2: SPA fallback for non-API paths**
    - **Property 3: API route priority over static files**
    - **Property 4: Cache-Control based on filename hash pattern**
    - **Property 5: 404 for missing static file extensions**
    - **Validates: Requirements 2.2, 2.3, 2.4, 2.5, 2.6**

  - [ ]* 2.5 Write unit tests for dashboard plugin
    - Test that root path `/` serves index.html with HTTP 200
    - Test that known asset paths (e.g., `/assets/main.abc123.js`) serve correct files
    - Test that API-prefixed paths are not intercepted by static serving
    - Test 404 response for missing `.js`, `.css` files
    - Test cache headers for hashed vs non-hashed filenames
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

- [x] 3. Checkpoint - Ensure static serving works
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Implement CLI entry point
  - [x] 4.1 Create CLI entry point (`bin/ai-gateway.js`)
    - Create `bin/ai-gateway.js` with shebang line `#!/usr/bin/env node`
    - Parse `process.argv` for `--port`, `--host`, and `--help` flags
    - Set default port to 3100 and default host to `0.0.0.0`
    - Implement `--help` flag: display usage information listing all flags and required env vars, then exit with code 0
    - _Requirements: 3.1, 3.2, 3.5, 3.6, 3.8_

  - [x] 4.2 Implement port validation and environment variable checks
    - Validate `--port` value: must be numeric integer in range 1-65535; exit with non-zero code and error message if invalid
    - Check for required environment variables (`INTERNAL_API_KEYS`, `ADMIN_API_KEYS`); exit with non-zero code listing each missing variable if absent
    - Set `PORT` and `HOST` environment variables and import/start the gateway server
    - _Requirements: 3.3, 3.4, 3.7_

  - [x] 4.3 Implement port-in-use error handling and startup logging
    - Catch `EADDRINUSE` error from server startup; exit with non-zero code and message: "Port {port} is already in use"
    - On successful startup, log to stdout the full URL where dashboard is accessible (e.g., `http://0.0.0.0:3100`)
    - _Requirements: 6.3, 6.5_

  - [ ]* 4.4 Write property test for port validation
    - **Property 6: Port validation**
    - Generate random strings and numbers with fast-check; verify CLI accepts only integers in [1, 65535]
    - **Validates: Requirements 3.3, 3.4**

  - [ ]* 4.5 Write unit tests for CLI entry point
    - Test default port/host values when no flags provided
    - Test `--help` output and exit code 0
    - Test error message for missing environment variables
    - Test error message for invalid port values (non-numeric, out of range)
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.7, 3.8_

- [x] 5. Checkpoint - Ensure CLI and static serving integration works
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Create unified Dockerfile
  - [x] 6.1 Create multi-stage Dockerfile at project root
    - Stage 1 (dashboard-build): Use `node:22-alpine`, copy `apps/dashboard/` source, run `npm ci` and `npm run build`
    - Stage 2 (gateway-build): Use `node:22-alpine`, copy `apps/gateway/` source, run `npm ci`, `npm run build`, and `npm prune --omit=dev`
    - Stage 3 (runner): Use `node:22-alpine`, create non-root user (`gateway`), copy compiled gateway `dist/`, production `node_modules/`, `package.json`, dashboard `dashboard-dist/`, and `bin/` directory
    - Switch to non-root user via `USER gateway` before CMD
    - Add `EXPOSE 3100` directive
    - Add `HEALTHCHECK --interval=30s --timeout=5s --retries=3` using fetch against `/healthz`
    - Set `CMD ["node", "bin/ai-gateway.js"]`
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8_

  - [ ]* 6.2 Write unit tests for Dockerfile structure
    - Verify Dockerfile contains required directives: `FROM node:22-alpine`, `EXPOSE 3100`, `HEALTHCHECK`, `USER`, `CMD`
    - Verify multi-stage build structure (3 stages)
    - Verify non-root user creation and usage
    - _Requirements: 5.5, 5.6, 5.7, 5.8_

- [x] 7. Wire everything together and integration
  - [x] 7.1 Register dashboard plugin in gateway app setup
    - Modify `apps/gateway/src/app.ts` (or equivalent server setup file) to import and register the dashboard plugin
    - Ensure API routes are registered BEFORE the dashboard plugin to maintain priority
    - Pass resolved `dashboardRoot` path pointing to `dashboard-dist/` relative to the package root
    - _Requirements: 2.1, 2.4, 6.4_

  - [x] 7.2 Update gateway server startup to support CLI configuration
    - Ensure `apps/gateway/src/server.ts` reads `PORT` and `HOST` from environment variables (or already does)
    - Verify the server binds to the configured host and port
    - Ensure graceful shutdown on SIGTERM/SIGINT is preserved
    - _Requirements: 3.2, 3.5, 6.2_

  - [ ]* 7.3 Write integration tests for unified package
    - Test full request flow: API routes respond correctly, static assets are served, SPA fallback works
    - Test that `npm pack` produces tarball containing `bin/`, `dist/`, `dashboard-dist/`
    - Test server starts and serves dashboard at root path with HTTP 200
    - _Requirements: 6.1, 6.2, 6.4_

- [x] 8. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The design uses TypeScript for the gateway and Vite for the dashboard build
- `fast-check` is already available as a devDependency in the gateway package
- `@fastify/static` needs to be installed as a new dependency

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["2.1", "4.1"] },
    { "id": 2, "tasks": ["2.2", "2.3", "4.2"] },
    { "id": 3, "tasks": ["2.4", "2.5", "4.3"] },
    { "id": 4, "tasks": ["4.4", "4.5", "6.1"] },
    { "id": 5, "tasks": ["6.2", "7.1"] },
    { "id": 6, "tasks": ["7.2"] },
    { "id": 7, "tasks": ["7.3"] }
  ]
}
```
