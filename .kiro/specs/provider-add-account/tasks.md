# Implementation Plan: provider-add-account

## Overview

Triển khai tính năng thêm account cho provider type đã đăng ký. Sử dụng TypeScript, Fastify, Zod, vitest, và fast-check. Kiến trúc phân lớp: foundation services → API routes → PBT → Dashboard → wiring.

## Tasks

- [x] 1. Cài đặt dependency và cấu hình project
  - [x] 1.1 Thêm `fast-check` vào devDependencies của `apps/gateway`
    - Chạy `npm install --save-dev fast-check` trong `apps/gateway`
    - Xác nhận version `^3.22.0` trong `package.json`
    - _Requirements: Design — Dependencies_

- [x] 2. Tạo normalize pipeline
  - [x] 2.1 Implement `src/services/addAccount/normalize.ts`
    - Tạo thư mục `src/services/addAccount/`
    - Implement `normalizeLabel(raw: string): string` — trim + collapse whitespace
    - Implement `normalizeWeight(raw?: number): number` — clamp [1, 100], floor decimals
    - Implement `normalizeAddAccountRequest(raw): AccountDraft` — compose normalize functions
    - Export type `AccountDraft` và `CredentialMode`
    - _Requirements: 2.1, 2.4, 2.5, 2.6, 2.8_

  - [ ]* 2.2 Write property test — Idempotent Normalization (Property 1)
    - **Property 1: normalize(normalize(x)) === normalize(x)**
    - **Validates: Requirements 2.8**
    - File: `src/test/normalize.property.test.ts`
    - Dùng `fc.record` generate random `AddAccountRequest`
    - Assert deep equality sau 2 lần normalize

  - [ ]* 2.3 Write property test — Weight Clamping Invariant (Property 3)
    - **Property 3: 1 <= normalizeWeight(w) <= 100 AND isInteger**
    - **Validates: Requirements 2.4**
    - File: `src/test/normalize.property.test.ts`
    - Dùng `fc.double()` và `fc.integer()` generate arbitrary numbers
    - Assert output luôn trong [1, 100] và là integer

  - [ ]* 2.4 Write unit tests cho normalize pipeline
    - File: `src/test/normalize.test.ts`
    - Test trim whitespace, collapse multiple spaces
    - Test label edge cases: empty after trim, >64 chars
    - Test weight: undefined → 1, 0.5 → 1, 150 → 100, -5 → 1
    - Test defaults: enabled=true, maxConcurrency=3
    - _Requirements: 2.1, 2.2, 2.4, 2.5, 2.6_

- [x] 3. Tạo credential mode mapping
  - [x] 3.1 Implement `src/services/addAccount/credentialModeMapping.ts`
    - Define `AUTH_METHOD_TO_CREDENTIAL_MODE` mapping record
    - Implement `getSupportedCredentialModes(definition): CredentialMode[]`
    - Special case: `mock` provider includes `mock_static`
    - _Requirements: 1.4, 2.7, 6.2_

  - [ ]* 3.2 Write unit tests cho credential mode mapping
    - File: `src/test/credentialModeMapping.test.ts`
    - Test mapping cho mỗi authMethod (oauth → oauth_pkce, api_key → api_key, etc.)
    - Test mock provider includes mock_static
    - Test unsupported methods (session_cookie, custom_json) bị loại
    - _Requirements: 1.4, 6.2_

- [x] 4. Tạo AddAccountLockService
  - [x] 4.1 Implement `src/services/AddAccountLockService.ts`
    - Class `AddAccountLockService` wrap `KeyedMutex` từ `utils/mutex.ts`
    - Method `acquire<T>(providerType, normalizedLabel, task): Promise<T>`
    - Lock key format: `add-account:{providerType}:{normalizedLabel}`
    - Timeout 5000ms → throw `AddAccountLockTimeoutError` (code: `add_account_in_progress`, statusCode: 409)
    - _Requirements: 9.1, 9.2_

  - [ ]* 4.2 Write unit tests cho AddAccountLockService
    - File: `src/test/addAccountLock.test.ts`
    - Test acquire + release thành công
    - Test concurrent access cùng key → serialize
    - Test timeout → throw AddAccountLockTimeoutError
    - Test khác key → parallel execution
    - _Requirements: 9.1, 9.2_

- [x] 5. Tạo IdempotencyStore
  - [x] 5.1 Implement `src/services/IdempotencyStore.ts`
    - Class `IdempotencyStore` với `Map<string, IdempotencyRecord>`
    - Method `get(key)` — trả record hoặc undefined, auto-cleanup expired
    - Method `set(key, statusCode, body)` — lưu record với `createdAt = Date.now()`
    - TTL mặc định 600_000ms (10 phút)
    - Export type `IdempotencyRecord`
    - _Requirements: 9.3_

  - [ ]* 5.2 Write unit tests cho IdempotencyStore
    - File: `src/test/idempotencyStore.test.ts`
    - Test set + get trả đúng record
    - Test expired record trả undefined
    - Test auto-cleanup trên get/set
    - _Requirements: 9.3_

- [x] 6. Tạo OAuthSessionStore
  - [x] 6.1 Implement `src/services/OAuthSessionStore.ts`
    - Class `OAuthSessionStore` với `Map<string, OAuthSession>` và `Map<string, string>` (state → id)
    - Methods: `create`, `getById`, `getByState`, `hasActiveSession`, `complete`, `fail`
    - Auto-expire on access (check `expiresAt`)
    - Export type `OAuthSession`
    - _Requirements: 3.1, 3.3, 3.4, 3.5, 3.7_

  - [ ]* 6.2 Write unit tests cho OAuthSessionStore
    - File: `src/test/oauthSessionStore.test.ts`
    - Test create + getById
    - Test getByState lookup
    - Test hasActiveSession (true khi pending, false khi completed/expired)
    - Test complete/fail transitions
    - Test expired session trả undefined
    - _Requirements: 3.1, 3.5, 3.7_

- [x] 7. Checkpoint — Foundation services
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Tạo Zod schema và credential validation
  - [x] 8.1 Implement `src/services/addAccount/schema.ts`
    - Define `addAccountRequestSchema` với Zod
    - Credential validation per mode:
      - `refresh_token`: `credentials.refreshToken` non-empty, ≤ 4096 chars
      - `api_key`: `credentials.apiKey` 16–512 chars, ASCII printable (`/^[\x20-\x7E]+$/`)
      - `mock_static`: `credentials.mockToken` 1–256 chars
      - `oauth_pkce`: không cần credentials
    - Export parse function với error mapping
    - _Requirements: 1.5, 4.1, 4.2, 5.1, 5.2, 6.1_

  - [ ]* 8.2 Write unit tests cho schema validation
    - File: `src/test/addAccountSchema.test.ts`
    - Test valid payloads cho mỗi mode
    - Test invalid: missing label, wrong type, apiKey too short/long, non-ASCII
    - Test refreshToken > 4096 chars
    - Test mockToken empty/> 256 chars
    - Test oauth_pkce không cần credentials field
    - _Requirements: 1.5, 4.1, 4.2, 5.1, 5.2, 6.1_

- [x] 9. Implement route handler — synchronous modes (api_key, refresh_token, mock_static)
  - [x] 9.1 Implement `src/routes/providerAccounts.ts` — POST endpoint
    - Register route `POST /admin/v1/providers/:providerType/accounts`
    - Pipeline: adminAuth → rate limit → idempotency check → lock → validate+normalize → dedupe check → credential verify → encrypt → SecretService → AccountPool → PersistenceService → ConfigRevisionService → AdminAuditService → MetricsService → idempotency store
    - Handle `api_key` mode: verify via adapter (optional), encrypt, commit
    - Handle `refresh_token` mode: verify via adapter (optional), encrypt, commit
    - Handle `mock_static` mode: skip verify, encrypt, commit
    - Map `AccountDraft` → `ProviderAccount` (generate UUID, set metadata)
    - Return `AddAccountResponse` (no secrets)
    - Error handling: ZodError → 400, label_conflict → 409, lock timeout → 409, persist_failed → 500, verify rejected → 422
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 2.3, 4.3, 4.4, 5.3, 5.4, 6.3, 7.1, 7.2, 7.3, 7.4, 8.1, 8.2, 8.3, 8.4_

  - [ ]* 9.2 Write integration tests cho POST synchronous modes
    - File: `src/test/providerAccounts.integration.test.ts`
    - Test api_key mode: 201 response, account in pool, secret encrypted
    - Test refresh_token mode: 201 response, verify called
    - Test mock_static mode: 201 response, skip verify
    - Test 404 khi providerType không tồn tại
    - Test 401 khi thiếu admin token
    - Test 400 khi payload invalid
    - Test 409 khi label conflict
    - Test 422 khi adapter reject credential
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 2.3, 4.4, 5.4_

- [x] 10. Implement route handler — OAuth PKCE flow
  - [x] 10.1 Implement OAuth PKCE trong `src/routes/providerAccounts.ts`
    - POST với `credentialMode = oauth_pkce`: generate state (32 bytes base64url), codeVerifier (64 chars), codeChallenge (SHA256 base64url)
    - Build authorizationUrl từ adapter config + state + code_challenge
    - Lưu OAuthSession vào OAuthSessionStore
    - Return HTTP 202 `OAuthStartResponse` (oauthSessionId, authorizationUrl, expiresAt) — KHÔNG trả codeVerifier
    - Check `hasActiveSession` → reject 409 nếu đã có session sống
    - _Requirements: 3.1, 3.2, 3.7_

  - [x] 10.2 Implement OAuth callback handler
    - Route: `GET /oauth/:providerType/callback` (hoặc integrate vào existing oauth route)
    - Lookup session by state → 400 nếu không tìm thấy
    - Check expired → 410
    - Exchange code + codeVerifier → tokens via adapter
    - Encrypt refresh_token → SecretService → Pool → Persist → Snapshot → Audit
    - Mark session completed
    - _Requirements: 3.3, 3.4, 3.5, 3.6_

  - [x] 10.3 Implement OAuth session poll endpoint
    - Route: `GET /admin/v1/oauth-sessions/:oauthSessionId`
    - Return `OAuthSessionStatusResponse` (id, status, providerType, label, result, expiresAt)
    - _Requirements: 3.2_

  - [ ]* 10.4 Write integration tests cho OAuth PKCE flow
    - File: `src/test/oauthFlow.integration.test.ts`
    - Test POST oauth_pkce → 202 với authorizationUrl
    - Test callback thành công → session completed
    - Test callback state mismatch → 400
    - Test callback expired → 410
    - Test poll endpoint trả status
    - Test duplicate session → 409
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_

- [x] 11. Implement GET list và DELETE account
  - [x] 11.1 Implement GET và DELETE trong `src/routes/providerAccounts.ts`
    - `GET /admin/v1/providers/:providerType/accounts` → 200 + array `ProviderAccountSummary` (no secrets)
    - `DELETE /admin/v1/providers/:providerType/accounts/:accountId` → remove from pool, delete from state, snapshot, audit → 204
    - 404 nếu accountId không tồn tại
    - _Requirements: 12.1, 12.2, 12.3_

  - [ ]* 11.2 Write integration tests cho GET list và DELETE
    - File: `src/test/providerAccounts.integration.test.ts` (append)
    - Test GET trả danh sách đúng, không chứa secret
    - Test DELETE thành công → 204, account removed from pool
    - Test DELETE accountId không tồn tại → 404
    - _Requirements: 12.1, 12.2, 12.3_

- [x] 12. Rate limit integration
  - [x] 12.1 Implement rate limit cho add-account
    - Thêm `parseAddAccountRateLimit` vào `src/config.ts` — đọc env `ADD_ACCOUNT_RATE_LIMIT_PER_MIN`
    - Default 10, fail-fast nếu invalid (≤ 0, non-integer, NaN)
    - Tạo instance `RateLimitService` riêng cho add-account
    - Gọi `checkAndConsume(actorKeyHash)` ở đầu POST route handler, trước idempotency
    - Return 429 + `Retry-After` header khi vượt limit
    - _Requirements: 11.1, 11.2, 11.3, 11.4_

  - [ ]* 12.2 Write integration tests cho rate limit
    - File: `src/test/rateLimit.integration.test.ts`
    - Test N requests thành công, N+1 bị 429
    - Test Retry-After header có giá trị dương
    - Test invalid env → fail-fast at startup
    - _Requirements: 11.1, 11.2, 11.3, 11.4_

- [x] 13. Idempotency-Key integration
  - [x] 13.1 Tích hợp Idempotency-Key vào route handler
    - Đọc header `Idempotency-Key` từ request
    - Check `IdempotencyStore.get(key)` trước lock acquire
    - Nếu hit → return cached response (statusCode + body) ngay
    - Nếu miss → sau commit thành công, `IdempotencyStore.set(key, statusCode, body)`
    - _Requirements: 9.3_

  - [ ]* 13.2 Write integration tests cho idempotency
    - File: `src/test/idempotency.integration.test.ts`
    - Test same key → same response, không tạo account thứ 2
    - Test different key → tạo account mới
    - Test expired key (>10 min) → tạo account mới
    - _Requirements: 9.3_

- [x] 14. Mở rộng redaction.ts
  - [x] 14.1 Thêm sensitive keys vào `src/utils/redaction.ts`
    - Thêm `mocktoken`, `code`, `codeverifier` vào `sensitiveKeys` set
    - Đảm bảo normalize key (lowercase) trước khi check
    - _Requirements: 10.1, 10.3_

  - [ ]* 14.2 Write unit tests cho redaction mở rộng
    - File: `src/test/redaction.test.ts` (append hoặc thêm test cases)
    - Test mockToken bị redact
    - Test code bị redact
    - Test codeVerifier bị redact
    - _Requirements: 10.1, 10.3_

- [x] 15. Checkpoint — API layer hoàn chỉnh
  - Ensure all tests pass, ask the user if questions arise.

- [x] 16. Property-Based Tests — Encryption và Security
  - [ ]* 16.1 Write property test — Encryption Round-Trip (Property 4)
    - **Property 4: decrypt(encrypt(payload)) === payload**
    - **Validates: Requirements 4.3, 5.3, 7.2, 7.5**
    - File: `src/test/encryption.property.test.ts`
    - Generate random credential objects (refreshToken, apiKey, mockToken)
    - Assert `decryptJson(encryptJson(payload))` deep equals original

  - [ ]* 16.2 Write property test — Label Deduplication case-insensitive (Property 2)
    - **Property 2: case-insensitive label conflict detection**
    - **Validates: Requirements 2.3**
    - File: `src/test/dedupe.property.test.ts`
    - Generate pairs (L1, L2) where `normalize(L1).toLowerCase() === normalize(L2).toLowerCase()`
    - Assert second add bị reject với `label_conflict`

  - [ ]* 16.3 Write property test — No Secrets in Response (Property 5)
    - **Property 5: response body contains no secret fields**
    - **Validates: Requirements 1.1, 3.2, 10.2**
    - File: `src/test/response.property.test.ts`
    - Generate random AddAccountRequest với credentials
    - Execute route, assert response không chứa refreshToken, apiKey, mockToken, code, codeVerifier

  - [ ]* 16.4 Write property test — OAuth State Uniqueness (Property 6)
    - **Property 6: all OAuth states are unique 32-byte values, codeVerifier 64 chars**
    - **Validates: Requirements 3.1**
    - File: `src/test/oauth.property.test.ts`
    - Generate N sessions, assert all states distinct
    - Assert mỗi state decode base64url = 32 bytes
    - Assert mỗi codeVerifier = 64 chars

- [x] 17. Dashboard — AddAccountModal component
  - [x] 17.1 Implement `AddAccountModal` component
    - Thêm component vào `apps/dashboard/src/App.tsx` (hoặc tách file mới)
    - Props: `providerType`, `supportedModes`, `onClose`, `onSuccess`
    - Form fields: label, credentialMode (dropdown), weight (default 1), enabled (default true)
    - Conditional credential fields theo mode:
      - `refresh_token` → textarea refreshToken
      - `api_key` → input apiKey
      - `mock_static` → input mockToken
      - `oauth_pkce` → nút "Continue with OAuth"
    - Client-side validation: label non-empty, credential fields required per mode
    - Submit gọi `POST /admin/v1/providers/:providerType/accounts`
    - _Requirements: 14.1, 14.3_

  - [x] 17.2 Thêm nút "Add account" vào ProviderDetail
    - Thêm button "Add account" trong phần provider detail
    - onClick mở AddAccountModal với providerType và supportedModes
    - Gọi `getSupportedCredentialModes` từ provider definition
    - _Requirements: 13.3, 14.1_

- [x] 18. Dashboard — OAuth polling integration
  - [x] 18.1 Implement OAuth polling trong AddAccountModal
    - Khi mode = `oauth_pkce` và nhận `oauthSessionId` từ 202 response:
      - Mở `authorizationUrl` trong tab mới (`window.open`)
      - `useEffect` poll `GET /admin/v1/oauth-sessions/:id` mỗi 2 giây
      - Khi `status = "completed"` → gọi `onSuccess()`, đóng modal
      - Khi `status = "failed"` hoặc `"expired"` → hiển thị lỗi
      - Cleanup interval khi unmount hoặc modal đóng
    - _Requirements: 14.2_

- [x] 19. Dashboard — Error messages Vietnamese và toast
  - [x] 19.1 Implement error handling và success feedback
    - Define `ERROR_MESSAGES_VI` record mapping error codes → Vietnamese messages
    - Hiển thị lỗi tại field tương ứng (inline validation)
    - Khi Gateway trả lỗi: map code → message, giữ nguyên form data
    - Khi thành công: đóng modal, toast "Đã thêm account", refresh danh sách
    - _Requirements: 14.3, 14.4, 14.5_

- [x] 20. Checkpoint — Dashboard hoàn chỉnh
  - Ensure all tests pass, ask the user if questions arise.

- [x] 21. Wire tất cả vào app.ts
  - [x] 21.1 Register routes và instantiate services trong `src/app.ts`
    - Import và instantiate `AddAccountLockService`
    - Import và instantiate `IdempotencyStore`
    - Import và instantiate `OAuthSessionStore`
    - Parse `ADD_ACCOUNT_RATE_LIMIT_PER_MIN` từ env (dùng `parseAddAccountRateLimit`)
    - Tạo `RateLimitService` instance riêng cho add-account
    - Gọi `registerProviderAccountRoutes(app, deps)` với tất cả dependencies
    - Đảm bảo `adminAuth` middleware áp dụng cho routes mới
    - _Requirements: 1.3, 8.1, 9.1, 11.1_

  - [ ]* 21.2 Write integration test cho wiring
    - Verify app khởi động thành công với tất cả services
    - Verify routes registered đúng path
    - Verify fail-fast khi env invalid
    - _Requirements: 11.3_

- [x] 22. Final checkpoint
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties (Property 1–6)
- Unit tests validate specific examples and edge cases
- Integration tests validate end-to-end flows qua Fastify inject
- TypeScript là ngôn ngữ implementation (đã xác định từ design document)
- Tất cả test dùng vitest; PBT dùng fast-check

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["2.1", "3.1", "4.1", "5.1", "6.1"] },
    { "id": 2, "tasks": ["2.2", "2.3", "2.4", "3.2", "4.2", "5.2", "6.2"] },
    { "id": 3, "tasks": ["8.1", "14.1"] },
    { "id": 4, "tasks": ["8.2", "14.2", "9.1"] },
    { "id": 5, "tasks": ["9.2", "10.1", "10.2", "10.3", "11.1", "12.1", "13.1"] },
    { "id": 6, "tasks": ["10.4", "11.2", "12.2", "13.2"] },
    { "id": 7, "tasks": ["16.1", "16.2", "16.3", "16.4"] },
    { "id": 8, "tasks": ["17.1", "17.2"] },
    { "id": 9, "tasks": ["18.1", "19.1"] },
    { "id": 10, "tasks": ["21.1"] },
    { "id": 11, "tasks": ["21.2"] }
  ]
}
```
