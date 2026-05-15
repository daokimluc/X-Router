# Requirements Document

## Introduction

Tính năng `provider-add-account` cho phép quản trị viên (admin) thêm một
ProviderAccount mới vào một provider type đã đăng ký trong gateway nội bộ
(Accountrouter). Bề mặt sử dụng gồm hai lớp: REST API quản trị (đã có sẵn
prefix `/admin` với `adminAuth` middleware) và Dashboard UI (React + Vite).

Mỗi provider type có thể hỗ trợ nhiều chế độ cấp credential khác nhau
(OAuth với PKCE, paste refresh token, paste API key, hoặc dữ liệu giả lập
cho `mock`). Sau khi thêm thành công, account được mã hoá secret bằng
`LocalEncryptionService`, persist vào `gateway-state.json` qua
`PersistenceService`, lưu snapshot bằng `ConfigRevisionService`, ghi nhận
qua `AdminAuditService`, và lập tức tham gia `AccountPool` với `enabled`
và `weight` đã được chuẩn hoá từ request (mặc định `enabled = true`,
`weight = 1` khi request không cung cấp).

Tính năng KHÔNG sửa chữa adapter đã có: nó chỉ tận dụng
`ProviderAdapterRegistry`, `ProviderTypeDefinition` và các service hiện hữu
để hiện thực hoá luồng "Add Account" đầu cuối.

## Glossary

- **Gateway**: Tiến trình `apps/gateway` chạy Express, tải state từ
  `apps/gateway/data/gateway-state.json`.
- **Admin**: Người gọi đã pass `adminAuth` middleware (token quản trị).
- **ProviderTypeDefinition**: Cấu hình mô tả một loại provider (`kiro`,
  `windsurf`, `mock`) gồm danh sách credential mode được hỗ trợ.
- **CredentialMode**: Một trong các chế độ `oauth_pkce`, `refresh_token`,
  `api_key`, `mock_static`. Mỗi mode có schema input riêng.
- **ProviderAccount**: Thực thể được persist, gồm metadata (id, label,
  providerType, credentialMode, weight, enabled) và secret đã mã hoá.
- **AccountPool**: Tập hợp account đang sống của một provider, do
  `AccountPool` quản lý theo strategy (RoundRobin, WeightedRoundRobin,
  LeastBusy).
- **OAuthSession**: Phiên OAuth ngắn hạn lưu `state`, `codeVerifier`,
  `providerType`, `accountDraft`, `expiresAt`.
- **AccountDraft**: Bản nháp ProviderAccount đã được normalize và
  validate, đang chờ credential trước khi được commit vào pool.
- **AddAccountRequest**: DTO REST gửi vào `POST /admin/providers/:type/accounts`.
- **AddAccountResponse**: DTO REST trả về (đã redact secret).
- **AdminAuditService**: Service ghi nhận hành động quản trị bằng entry
  `{actorHash, action, target, timestamp, requestId}`.
- **ConfigRevisionService**: Service tạo snapshot trạng thái cấu hình mỗi
  khi state thay đổi, hỗ trợ rollback.
- **LocalEncryptionService**: Service mã hoá đối xứng cho secret, dùng
  master key cấu hình từ env.
- **RefreshLockService**: Service mutex theo key, dùng để serialize ghi
  vào cùng một providerType/account.

## Requirements

### Requirement 1: Khởi tạo luồng thêm account qua REST

**User Story:** Là một admin, tôi muốn gọi REST API để mở luồng thêm account
cho một provider type, để có thể tự động hoá thao tác qua công cụ ngoài.

#### Acceptance Criteria

1. WHEN một admin gửi `POST /admin/providers/:providerType/accounts` với
   payload `AddAccountRequest` hợp lệ và `:providerType` đã được đăng ký,
   THE Gateway SHALL trả về HTTP 201 và body `AddAccountResponse` chứa
   `accountId`, `providerType`, `credentialMode`, `label`, `enabled`,
   `weight`, không chứa bất kỳ trường secret nào.
2. WHEN một admin gửi request với `:providerType` không tồn tại trong
   `ProviderAdapterRegistry`, THE Gateway SHALL trả về HTTP 404 với mã lỗi
   `provider_type_not_found` và không thay đổi state.
3. IF request KHÔNG đi qua `adminAuth` middleware (thiếu hoặc sai admin
   token), THEN THE Gateway SHALL trả về HTTP 401 với mã lỗi
   `admin_unauthenticated` và không thay đổi state.
4. IF `:providerType` hợp lệ nhưng không hỗ trợ `credentialMode` được yêu
   cầu, THEN THE Gateway SHALL trả về HTTP 400 với mã lỗi
   `credential_mode_unsupported` và không thay đổi state.
5. WHEN `AddAccountRequest` thiếu hoặc sai kiểu trường bắt buộc, THE
   Gateway SHALL trả về HTTP 400 với mã lỗi `invalid_request_payload` và
   danh sách lỗi field cụ thể, không tham chiếu giá trị secret thô.

### Requirement 2: Validation và normalization input

**User Story:** Là một admin, tôi muốn input của tôi được validate và chuẩn
hoá nhất quán, để tránh trùng label hay sai kiểu dữ liệu lan vào pool.

#### Acceptance Criteria

1. THE Gateway SHALL chuẩn hoá `label` bằng cách trim whitespace hai đầu và
   thay thế chuỗi whitespace nội bộ bằng một dấu cách đơn trước khi lưu.
2. IF `label` sau khi chuẩn hoá rỗng hoặc dài hơn 64 ký tự, THEN THE
   Gateway SHALL từ chối request với mã lỗi `invalid_label`.
3. IF tồn tại một `ProviderAccount` đang lưu cùng `providerType` và cùng
   `label` đã chuẩn hoá (so sánh không phân biệt hoa thường), THEN THE
   Gateway SHALL từ chối request với mã lỗi `label_conflict`.
4. WHERE `weight` được cung cấp trong request, THE Gateway SHALL clamp giá
   trị vào khoảng `[1, 100]` (số nguyên); giá trị thập phân được làm tròn
   xuống.
5. WHERE `weight` không được cung cấp, THE Gateway SHALL gán giá trị mặc
   định `1`.
6. WHERE `enabled` không được cung cấp, THE Gateway SHALL gán giá trị mặc
   định `true`.
7. THE Gateway SHALL xác thực `credentialMode` thuộc tập
   `{oauth_pkce, refresh_token, api_key, mock_static}` và phải nằm trong
   danh sách `supportedCredentialModes` của `ProviderTypeDefinition`.
8. FOR ALL cặp `(input, normalized)` của một `AddAccountRequest`, áp dụng
   bước normalize hai lần liên tiếp SHALL cho ra cùng một kết quả
   (idempotent normalization).

### Requirement 3: Credential mode oauth_pkce

**User Story:** Là một admin, tôi muốn liên kết account thông qua OAuth
PKCE, để không phải copy refresh token bằng tay.

#### Acceptance Criteria

1. WHEN `credentialMode = oauth_pkce`, THE Gateway SHALL tạo một
   `OAuthSession` mới với `state` là chuỗi ngẫu nhiên 32 byte mã hoá
   base64url, `codeVerifier` 64 ký tự ngẫu nhiên, `expiresAt` bằng
   `now + 10 phút`.
2. WHEN `OAuthSession` được tạo, THE Gateway SHALL trả về HTTP 202 với body
   chứa `authorizationUrl` (đã chèn `state` và `code_challenge` PKCE) và
   `oauthSessionId`, không trả về `codeVerifier`.
3. WHEN admin (qua trình duyệt) hoàn tất OAuth và provider gọi callback
   `GET /oauth/:providerType/callback?code=...&state=...`, THE Gateway
   SHALL tra cứu `OAuthSession` theo `state`, đổi `code` lấy refresh token
   thông qua adapter, gắn token đã mã hoá vào `AccountDraft`, và commit
   account vào pool.
4. IF `state` từ callback không khớp với bất kỳ `OAuthSession` nào, THEN
   THE Gateway SHALL trả về HTTP 400 với mã lỗi `oauth_state_mismatch` và
   không thay đổi state.
5. IF callback đến sau `expiresAt`, THEN THE Gateway SHALL xoá session, trả
   về HTTP 410 với mã lỗi `oauth_session_expired` và không tạo account.
6. IF adapter từ chối exchange code (lỗi từ provider), THEN THE Gateway
   SHALL trả về HTTP 502 với mã lỗi `oauth_exchange_failed`, log lỗi đã
   redact secret, và không tạo account.
7. WHILE một `OAuthSession` còn sống cho cùng `providerType` và cùng
   `label`, THE Gateway SHALL từ chối request mới với mã lỗi
   `oauth_session_in_progress`.

### Requirement 4: Credential mode refresh_token

**User Story:** Là một admin, tôi muốn dán trực tiếp refresh token đã có
sẵn, để thêm account nhanh khi đã có credential bên ngoài.

#### Acceptance Criteria

1. WHEN `credentialMode = refresh_token`, THE Gateway SHALL yêu cầu trường
   `credentials.refreshToken` là chuỗi không rỗng dài tối đa 4096 ký tự.
2. IF `credentials.refreshToken` thiếu, rỗng, hoặc vượt 4096 ký tự, THEN
   THE Gateway SHALL trả về HTTP 400 với mã lỗi `invalid_refresh_token`.
3. WHEN refresh token hợp lệ, THE Gateway SHALL mã hoá token bằng
   `LocalEncryptionService` trước khi persist; bản plaintext SHALL không
   xuất hiện trong response, log, hoặc snapshot revision.
4. WHERE adapter cung cấp hàm `verifyRefreshToken`, THE Gateway SHALL gọi
   hàm đó và chỉ commit account khi xác thực thành công; nếu thất bại,
   trả về HTTP 422 với mã lỗi `refresh_token_rejected`.

### Requirement 5: Credential mode api_key

**User Story:** Là một admin, tôi muốn dùng API key để đăng ký account cho
provider hỗ trợ static key, để không cần OAuth.

#### Acceptance Criteria

1. WHEN `credentialMode = api_key`, THE Gateway SHALL yêu cầu trường
   `credentials.apiKey` là chuỗi không rỗng, dài 16–512 ký tự, chỉ chứa ký
   tự ASCII in được.
2. IF `credentials.apiKey` không thoả ràng buộc trên, THEN THE Gateway
   SHALL trả về HTTP 400 với mã lỗi `invalid_api_key`.
3. THE Gateway SHALL mã hoá API key bằng `LocalEncryptionService` trước
   khi persist.
4. WHERE adapter cung cấp hàm `verifyApiKey`, THE Gateway SHALL gọi hàm đó
   và chỉ commit account khi xác thực thành công; nếu thất bại, trả về
   HTTP 422 với mã lỗi `api_key_rejected`.

### Requirement 6: Credential mode mock_static

**User Story:** Là một developer dùng provider `mock`, tôi muốn thêm
account giả lập, để chạy test end-to-end mà không cần credential thật.

#### Acceptance Criteria

1. WHERE `providerType = mock`, THE Gateway SHALL chấp nhận
   `credentialMode = mock_static` với `credentials.mockToken` là chuỗi tuỳ
   ý dài 1–256 ký tự.
2. IF một adapter khác `mock` cố dùng `credentialMode = mock_static`, THEN
   THE Gateway SHALL từ chối với mã lỗi `credential_mode_unsupported`.
3. THE Gateway SHALL bỏ qua bước verify với adapter cho mode này và commit
   account ngay sau khi normalize và mã hoá `mockToken`.

### Requirement 7: Persist, encrypt và snapshot

**User Story:** Là một admin, tôi muốn account vừa thêm được lưu bền vững
và khôi phục được khi gateway restart, để không mất cấu hình.

#### Acceptance Criteria

1. WHEN một account được commit, THE Gateway SHALL ghi entry mới vào
   `gateway-state.json` thông qua `PersistenceService` trong cùng một lần
   ghi nguyên tử.
2. THE Gateway SHALL mã hoá mọi trường secret (`refreshToken`, `apiKey`,
   `mockToken`) bằng `LocalEncryptionService` trước khi đưa vào
   `PersistenceService`; plaintext SHALL không tồn tại trong file.
3. WHEN một account được commit thành công, THE Gateway SHALL gọi
   `ConfigRevisionService.snapshot()` để tạo một revision mới gắn
   `requestId` của thao tác.
4. IF việc ghi persist thất bại, THEN THE Gateway SHALL không thêm account
   vào `AccountPool`, trả về HTTP 500 với mã lỗi `persist_failed`, và để
   trạng thái runtime không đổi so với trước request.
5. FOR ALL `ProviderAccount` được persist, đọc lại từ
   `PersistenceService` rồi giải mã secret SHALL khôi phục đúng giá trị
   plaintext gốc (round-trip).

### Requirement 8: Tham gia AccountPool và side-effect

**User Story:** Là một admin, tôi muốn account vừa thêm phục vụ traffic
ngay, để không cần thao tác bật thủ công.

#### Acceptance Criteria

1. WHEN một account được commit thành công, THE Gateway SHALL thêm vào
   `AccountPool` của `providerType` với `enabled` và `weight` lấy từ kết
   quả normalize ở Requirement 2 (mặc định `enabled = true`, `weight = 1`
   khi request không cung cấp).
2. THE Gateway SHALL giữ nguyên strategy hiện tại của pool và chỉ thông
   báo thêm thành viên (không reset state RoundRobin/LeastBusy).
3. WHEN account được thêm, THE Gateway SHALL tăng counter
   `provider_accounts_added_total{provider_type=...}` của `MetricsService`
   thêm 1.
4. WHEN account được thêm, THE Gateway SHALL ghi audit entry qua
   `AdminAuditService` với `action = "provider.account.add"`, `target =
   accountId`, và `actorHash` từ context của admin.

### Requirement 9: Đồng thời và idempotency

**User Story:** Là một admin, tôi muốn nhiều thao tác đồng thời không tạo
ra account trùng hay corrupt state, để vận hành an toàn.

#### Acceptance Criteria

1. WHILE một thao tác thêm account đang diễn ra cho cùng
   `(providerType, normalizedLabel)`, THE Gateway SHALL serialize bằng
   `RefreshLockService.acquire("add-account:{providerType}:{label}")`.
2. IF không lấy được lock trong 5 giây, THEN THE Gateway SHALL trả về HTTP
   409 với mã lỗi `add_account_in_progress`.
3. WHEN client cung cấp header `Idempotency-Key`, THE Gateway SHALL trả
   lại response của lần xử lý đầu tiên cho cùng key trong vòng 10 phút,
   không tạo account thứ hai.

### Requirement 10: Bảo mật log và response

**User Story:** Là người vận hành, tôi muốn không thấy secret trong log
hay response, để giảm rủi ro rò rỉ.

#### Acceptance Criteria

1. THE Gateway SHALL áp dụng `utils/redaction.ts` cho mọi log liên quan
   đến luồng add account, redact các trường tên `refreshToken`, `apiKey`,
   `mockToken`, `code`, `codeVerifier`, `authorization`.
2. THE Gateway SHALL không bao gồm các trường secret hay
   `oauthSession.codeVerifier` trong bất kỳ response nào.
3. IF một secret xuất hiện trong stack trace lỗi, THEN THE Gateway SHALL
   redact giá trị đó bằng `utils/redaction.ts` trước khi log hoặc trả về
   client.

### Requirement 11: Rate limiting

**User Story:** Là người vận hành, tôi muốn giới hạn tần suất thêm account
và có thể cấu hình ngưỡng qua env, để chống lạm dụng và lỗi cấu hình lặp.

#### Acceptance Criteria

1. THE Gateway SHALL đọc biến môi trường `ADD_ACCOUNT_RATE_LIMIT_PER_MIN`
   tại thời điểm khởi động và sử dụng giá trị này làm ngưỡng request mỗi
   phút trên mỗi `actorHash` cho endpoint
   `POST /admin/providers/:providerType/accounts`.
2. WHERE `ADD_ACCOUNT_RATE_LIMIT_PER_MIN` không được cung cấp, THE Gateway
   SHALL dùng giá trị mặc định `10`.
3. IF `ADD_ACCOUNT_RATE_LIMIT_PER_MIN` không phải số nguyên dương hợp lệ
   (≤ 0, không phải số, hoặc thập phân), THEN THE Gateway SHALL fail-fast
   khi khởi động với log lỗi mô tả tên biến và giá trị nhận được.
4. IF actor vượt giới hạn, THEN THE Gateway SHALL trả về HTTP 429 với mã
   lỗi `rate_limited` và header `Retry-After` tính theo giây còn lại của
   cửa sổ rate limit.

### Requirement 12: Liệt kê và xoá account

**User Story:** Là một admin, tôi muốn xem và xoá account đã thêm, để
quản lý toàn vòng đời tối thiểu.

#### Acceptance Criteria

1. WHEN một admin gửi `GET /admin/providers/:providerType/accounts`, THE
   Gateway SHALL trả về HTTP 200 với mảng `ProviderAccountSummary` (chứa
   `accountId`, `label`, `credentialMode`, `enabled`, `weight`,
   `createdAt`), không chứa secret.
2. WHEN một admin gửi `DELETE /admin/providers/:providerType/accounts/:accountId`
   với accountId tồn tại, THE Gateway SHALL gỡ account khỏi pool, xoá
   khỏi state, tạo revision snapshot, ghi audit entry, và trả về HTTP 204.
3. IF `accountId` không tồn tại, THEN THE Gateway SHALL trả về HTTP 404
   với mã lỗi `account_not_found`.

### Requirement 13: Dashboard UI liệt kê provider

**User Story:** Là một admin, tôi muốn thấy danh sách provider trong
dashboard kèm logo, để biết nơi cần thêm account.

#### Acceptance Criteria

1. WHEN admin mở trang Providers của dashboard, THE Dashboard SHALL gọi
   `GET /admin/providers` và hiển thị danh sách provider type đã đăng ký.
2. THE Dashboard SHALL hiển thị logo từ
   `/provider-logos/{providerType}.png` cho mỗi provider; nếu file logo
   không tồn tại (HTTP 404), THE Dashboard SHALL hiển thị placeholder
   chữ cái đầu của `providerType`.
3. THE Dashboard SHALL hiển thị nút "Add account" cho mỗi provider type.

### Requirement 14: Dashboard UI form Add Account

**User Story:** Là một admin, tôi muốn dùng form để thêm account, để không
cần gọi REST bằng tay.

#### Acceptance Criteria

1. WHEN admin nhấn "Add account" cho một provider, THE Dashboard SHALL mở
   modal với các trường: `label`, `credentialMode` (dropdown chỉ chứa các
   mode được provider hỗ trợ), `weight` (mặc định 1), `enabled` (mặc định
   true), và các trường credential tương ứng theo mode đã chọn.
2. WHEN người dùng chọn `credentialMode = oauth_pkce`, THE Dashboard SHALL
   ẩn ô credential và hiển thị nút "Continue with OAuth"; khi nhấn nút,
   dashboard mở `authorizationUrl` trả về từ Gateway trong tab mới và
   poll `GET /admin/oauth-sessions/:oauthSessionId` mỗi 2 giây để biết
   kết quả.
3. WHEN người dùng nhập sai dữ liệu (ví dụ label rỗng), THE Dashboard
   SHALL hiển thị thông báo lỗi tại trường tương ứng và không gửi request.
4. WHEN Gateway trả lỗi với mã `label_conflict`, `invalid_refresh_token`,
   `invalid_api_key`, hay `credential_mode_unsupported`, THE Dashboard
   SHALL hiển thị thông báo tiếng Việt tương ứng và giữ nguyên dữ liệu
   form để admin chỉnh sửa.
5. WHEN thêm account thành công, THE Dashboard SHALL đóng modal, hiển thị
   toast "Đã thêm account" và refresh danh sách account của provider đó.
