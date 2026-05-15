# Requirements Document

## Introduction

Đóng gói AI Gateway (Fastify backend + React dashboard) thành một single package duy nhất. Hiện tại hệ thống chạy 2 service riêng (gateway port 3100, dashboard port 3000 qua nginx). Mục tiêu là gộp lại thành 1 command, 1 port, 1 process — dashboard được build thành static files và serve trực tiếp bởi Fastify gateway tại cùng port 3100.

## Glossary

- **Gateway**: Fastify server xử lý API requests, chạy tại port 3100 (apps/gateway)
- **Dashboard**: React SPA application được build bởi Vite (apps/dashboard)
- **Static_Files**: Output của Vite build (HTML, JS, CSS, assets) trong thư mục dist
- **CLI_Entry_Point**: File bin/ai-gateway.js — điểm khởi chạy khi user dùng npx hoặc global install
- **Single_Package**: Toàn bộ gateway + dashboard static files được đóng gói trong 1 npm package
- **SPA_Fallback**: Cơ chế trả về index.html cho mọi route không match API, hỗ trợ client-side routing

## Requirements

### Requirement 1: Build Dashboard thành Static Files

**User Story:** Là developer, tôi muốn dashboard được build thành static files trong quá trình package, để gateway có thể serve trực tiếp mà không cần nginx hay process riêng.

#### Acceptance Criteria

1. WHEN the package build script is executed, THE Single_Package SHALL compile Dashboard source code into Static_Files by running TypeScript compilation followed by Vite production build
2. WHEN the Dashboard build completes successfully, THE Single_Package SHALL place Static_Files into the `dashboard-dist/` directory at the package root, containing at minimum an `index.html` entry file
3. WHEN the package build script is executed, THE Single_Package SHALL build the Dashboard before building the Gateway, so that Static_Files are available for packaging
4. IF the Dashboard build fails, THEN THE Single_Package SHALL exit with a non-zero code and print the build error output to stderr
5. IF the Dashboard source directory (apps/dashboard/) is missing or contains no source files, THEN THE Single_Package SHALL exit with a non-zero code and print an error message indicating the missing Dashboard source

### Requirement 2: Gateway Serve Static Files tại Root Path

**User Story:** Là user, tôi muốn truy cập dashboard UI tại cùng port 3100 với API, để chỉ cần nhớ 1 URL duy nhất.

#### Acceptance Criteria

1. WHEN a request is received for path "/", THE Gateway SHALL serve the Dashboard index.html from Static_Files with HTTP status 200
2. WHEN a request is received for a static asset path (JS, CSS, images, fonts), THE Gateway SHALL serve the corresponding file from Static_Files with Content-Type header determined by file extension
3. WHEN a request is received for a path that does not match any API route or static file, THE Gateway SHALL respond with HTTP status 200 and the Dashboard index.html to support SPA_Fallback
4. THE Gateway SHALL serve API routes (/admin, /v1, /healthz, /oauth) with higher priority than Static_Files, such that a request matching an API route prefix is never handled by the static file middleware
5. WHILE the Gateway is serving Static_Files, THE Gateway SHALL set Cache-Control header to "public, max-age=31536000, immutable" for assets whose filename contains a hash pattern (e.g., [name].[hash].[ext]), and "no-cache, no-store, must-revalidate" for index.html
6. IF a request targets a path with a static file extension (JS, CSS, image, font) but the file does not exist in Static_Files, THEN THE Gateway SHALL respond with HTTP status 404 and an error message indicating the file was not found

### Requirement 3: CLI Entry Point

**User Story:** Là user, tôi muốn khởi chạy AI Gateway bằng một command duy nhất (npx ai-gateway), để không cần clone repo hay cấu hình phức tạp.

#### Acceptance Criteria

1. THE CLI_Entry_Point SHALL exist at path bin/ai-gateway.js trong package
2. WHEN the CLI_Entry_Point is executed without flags, THE CLI_Entry_Point SHALL start the Gateway server on port 3100 and host 0.0.0.0 as default configuration
3. WHEN the CLI_Entry_Point is executed with --port flag followed by a numeric value between 1 and 65535, THE CLI_Entry_Point SHALL start the Gateway on the specified port
4. IF the CLI_Entry_Point is executed with --port flag with a non-numeric value or a value outside range 1-65535, THEN THE CLI_Entry_Point SHALL exit with a non-zero code and display an error message indicating the valid port range
5. WHEN the CLI_Entry_Point is executed with --host flag, THE CLI_Entry_Point SHALL bind the Gateway to the specified host address
6. THE CLI_Entry_Point SHALL include a shebang line (#!/usr/bin/env node) for direct execution
7. IF required environment variables (INTERNAL_API_KEYS, ADMIN_API_KEYS) are missing, THEN THE CLI_Entry_Point SHALL exit with a non-zero code and display an error message listing each missing variable by name
8. WHEN the CLI_Entry_Point is executed with --help flag, THE CLI_Entry_Point SHALL display usage information listing all supported flags and environment variables, then exit with code 0

### Requirement 4: Package.json Configuration

**User Story:** Là developer, tôi muốn package.json root được cấu hình đúng với bin field, để npm/npx có thể resolve và chạy ai-gateway command.

#### Acceptance Criteria

1. THE Single_Package SHALL declare "bin" field with entry {"ai-gateway": "./bin/ai-gateway.js"} in package.json
2. THE Single_Package SHALL declare "files" field containing exactly the following entries: ["bin/", "dist/", "dashboard-dist/"], ensuring only these directories are included in the published package
3. THE Single_Package SHALL declare "engines" field with {"node": ">=22"} and SHALL NOT set "private" to true, enabling npm publish and npx resolution
4. THE Single_Package SHALL include a "prepack" script that builds both Gateway (TypeScript compilation) and Dashboard (Vite build), ensuring the published tarball always contains up-to-date compiled output
5. THE Single_Package SHALL declare "type" field as "module" and a "name" field matching the intended npm registry package name used for npx resolution (e.g., "ai-gateway")
6. IF the "prepack" script build fails, THEN THE Single_Package SHALL exit with a non-zero code, preventing publication of an incomplete package

### Requirement 5: Single-Stage Dockerfile

**User Story:** Là DevOps engineer, tôi muốn một Dockerfile duy nhất build cả dashboard và gateway, để deploy bằng 1 container thay vì docker-compose với 2 services.

#### Acceptance Criteria

1. WHEN the Docker image is built, THE Dockerfile SHALL build Dashboard Static_Files in a build stage using npm ci for dependency installation and npm run build for compilation
2. WHEN the Docker image is built, THE Dockerfile SHALL build Gateway TypeScript source in a subsequent build stage, after Dashboard Static_Files are produced
3. WHEN the Docker image is built, THE Dockerfile SHALL produce a final image containing only production dependencies (node_modules without devDependencies), compiled Gateway code (dist/), and Dashboard Static_Files, excluding TypeScript source, build tools, and test files
4. WHEN the container starts, THE Dockerfile SHALL run the Gateway process bound to host 0.0.0.0 serving both API and Dashboard on port 3100
5. THE Dockerfile SHALL use node:22-alpine as base image for the final stage
6. THE Dockerfile SHALL create a non-root user and switch to that user (via USER directive) before the CMD instruction for running the Gateway process
7. THE Dockerfile SHALL include an EXPOSE 3100 directive to document the listening port
8. THE Dockerfile SHALL include a HEALTHCHECK instruction that verifies the Gateway is responding on the /healthz endpoint within 5 seconds, with a check interval of 30 seconds and 3 retries

### Requirement 6: Unified Execution Experience

**User Story:** Là user, tôi muốn chạy AI Gateway bằng npx ai-gateway hoặc docker run mà không cần thêm bước nào khác.

#### Acceptance Criteria

1. WHEN a user runs "npx ai-gateway", THE Single_Package SHALL download, install dependencies, and start the Gateway with Dashboard serving HTTP 200 on path "/" at port 3100 within 30 seconds of command execution
2. WHEN a user runs "docker run" with the built image, THE Single_Package SHALL start the Gateway with Dashboard serving HTTP 200 on path "/" at port 3100 within 10 seconds of container start
3. WHEN the Gateway starts successfully, THE Gateway SHALL log to stdout the full URL (including host and port) where Dashboard is accessible
4. THE Gateway SHALL serve both API routes and Dashboard Static_Files from a single process without requiring external services (nginx, reverse proxy)
5. IF the configured port is already in use, THEN THE Gateway SHALL exit with a non-zero code and display an error message indicating the port conflict and the port number
