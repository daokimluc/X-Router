# Internal AI Gateway

## Implementation Docs

This README is the product requirements document. For the current code status
and implementation handoff, read these files first:

- `docs/CURRENT_STATUS.md`
- `docs/ARCHITECTURE.md`
- `docs/API_REFERENCE.md`
- `docs/DASHBOARD.md`
- `docs/OPERATIONS.md`
- `docs/ROADMAP.md`
- `docs/TESTING.md`
- `docs/AI_AGENT_HANDOFF.md`
- `PLAN.md`

The project is no longer in Phase 1 only. `PLAN.md` is the current execution
roadmap for future implementation work.

> Internal AI Gateway is an internal AI routing control plane, not just an API proxy.
>
> Dự án này là **control plane nội bộ** để quản lý provider, account pool, model routing, API key, usage, logs, dashboard và observability cho toàn bộ AI workflow của team.

## 1. Product Vision

Xây dựng một **Internal AI Gateway** dùng nội bộ, cho phép gom nhiều provider AI và nhiều account/provider credential thành một API thống nhất, tương thích với OpenAI API và Anthropic API.

Ban đầu hệ thống tập trung vào **Windsurf** và **Kiro**, nhưng kiến trúc phải được thiết kế theo hướng **multi-provider** ngay từ đầu. Kiro và Windsurf chỉ là hai provider adapter đầu tiên, không phải giới hạn lâu dài của hệ thống.

Mục tiêu dài hạn:

- Một endpoint API chung cho Cursor, Cline, Claude Code, Aider, Continue, Roo Code, script nội bộ và các AI coding tools khác.
- Một dashboard kiểu 9Router để quản lý provider, account, model mapping, routing profile, API key, usage, logs và settings.
- Một provider adapter system có thể mở rộng thêm OpenAI, Anthropic, OpenRouter, Gemini, Azure OpenAI, AWS Bedrock, local OpenAI-compatible server, Custom HTTP provider hoặc provider nội bộ khác.
- Một account pool native tự quản lý round-robin, retry, failover, cooldown, disabled state, health check và session/token lifecycle.
- Một model routing layer cho phép map `publicModel → providerInstance → upstreamModel`, đồng thời hỗ trợ routing profile như `auto`, `coding`, `fast`, `balanced`, `strong`.

---

## 2. Core Decisions

### 2.1 Native Provider Mode

Gateway chạy theo **native provider mode**.

Gateway **không chạy `kiro-gateway` hoặc `WindsurfAPI` như service phụ**.

Các repo tham khảo chỉ dùng để đọc hiểu behavior/API, account handling, model mapping, streaming behavior và compatibility behavior:

```text
https://github.com/dwgx/WindsurfAPI
https://github.com/jwadow/kiro-gateway
```

Không dùng các repo này làm runtime dependency trong MVP.

### 2.2 Multi-Provider Core

Không thiết kế Gateway chỉ cho Kiro/Windsurf.

Thiết kế đúng là:

```text
Gateway Core
  ↓
ProviderAdapterRegistry
  ↓
Provider Adapter System
  ├─ KiroProviderAdapter
  ├─ WindsurfProviderAdapter
  ├─ OpenAICompatibleProviderAdapter
  ├─ AnthropicCompatibleProviderAdapter
  ├─ CustomHTTPProviderAdapter
  └─ Future Provider Adapters
```

Gateway core không được import trực tiếp logic provider-specific. Tất cả provider phải được đăng ký qua `ProviderAdapterRegistry`.

### 2.3 Dashboard as Control Plane

Dashboard không chỉ để xem trạng thái. Dashboard là **admin control plane** của gateway.

Dashboard cần quản lý:

- Provider catalog.
- Provider instances.
- Provider accounts/account pools.
- Credentials/secrets metadata.
- Model registry.
- Routing profiles/combos.
- Internal API keys.
- Team/workspace quota.
- Usage/cost analytics.
- Request logs.
- Audit logs.
- Metrics/health.
- Settings.
- CLI tools setup.
- Playground.
- Config versioning/rollback.

### 2.4 9Router-inspired UX

Dashboard nên học tinh thần của 9Router:

- Provider connect wizard.
- Model aliases/model registry.
- Combos/fallback chain, đổi tên trong dự án này thành **Routing Profiles**.
- API key generation UX.
- CLI tools setup page.
- Usage analytics.
- Local-first admin experience.

Không copy nguyên code nếu chưa kiểm tra license và attribution.

---

## 3. Goals

Dự án cần đạt các mục tiêu chính:

- Expose API dạng **OpenAI-compatible**.
- Expose API dạng **Anthropic-compatible**.
- Tự implement provider adapter native, bắt đầu với Kiro và Windsurf.
- Có `ProviderAdapterRegistry` để thêm provider mới mà không sửa gateway core.
- Có `ProviderRouter` route request theo model/routing profile.
- Có `ModelRegistry` tách public model và upstream model.
- Có `RoutingProfileRegistry` cho `auto`, `coding`, `fast`, `balanced`, `strong`.
- Có `CapabilityMatcher` để chọn provider/model theo capability.
- Có `AccountPool` riêng cho từng provider instance.
- Có round-robin, weighted round-robin, least-busy account selection.
- Có retry, failover, cooldown, disabled state.
- Có token/session lifecycle management cho từng provider.
- Có internal API key cho user/team nội bộ.
- Có admin API key riêng.
- Có rate limit theo internal API key/team.
- Có quota theo team/workspace.
- Có concurrency limit và backpressure.
- Có request queue tùy chọn.
- Có circuit breaker theo provider instance.
- Có logging metadata, không lưu prompt/code/completion nhạy cảm.
- Có streaming SSE tương thích OpenAI/Anthropic.
- Có response normalization cho OpenAI/Anthropic.
- Có usage tracking và cost/pricing system tùy chọn.
- Có dashboard quản trị.
- Có metrics endpoint hoặc metrics service.
- Có config versioning, validation, draft/test/publish, rollback.
- Có Docker Compose để chạy local.
- Có test plan và provider contract tests.

---

## 4. Non-goals

MVP không làm các việc sau:

- Không public gateway ra internet.
- Không xây billing system thương mại hoàn chỉnh.
- Không lưu prompt, source code hoặc completion content.
- Không dùng gateway để bypass quota, billing limit, rate limit hoặc điều khoản sử dụng của provider.
- Không chia sẻ credential provider cho người không có quyền.
- Không support multi-region.
- Không support horizontal scaling nhiều gateway instance nếu chưa có Redis/Postgres.
- Không implement toàn bộ provider, dashboard, streaming, admin API và metrics trong một file lớn.
- Không đảm bảo support đầy đủ tool calling, image input, audio input hoặc advanced multimodal trong MVP nếu provider không hỗ trợ ổn định.
- Không phụ thuộc runtime vào repo tham khảo.

---

## 5. Compliance & Allowed Use

Gateway chỉ được dùng cho mục đích nội bộ và với các tài khoản/provider mà team có quyền sử dụng hợp pháp.

Yêu cầu bắt buộc:

- Chỉ dùng với tài khoản/provider thuộc quyền quản lý hợp pháp của team.
- Không dùng gateway để bypass quota, rate limit, billing limit hoặc điều khoản dịch vụ của provider.
- Mỗi account phải có owner hoặc nguồn gốc rõ ràng.
- Admin phải có khả năng disable account khi phát hiện lỗi hoặc vi phạm.
- Không chia sẻ credential provider cho người không có quyền.
- Không public gateway/dashboard ra internet nếu chưa có security hardening đầy đủ.
- Không log hoặc lưu nội dung prompt, source code, completion, token/session/cookie.

---

## 6. Reference Code Policy

Các repo tham khảo chỉ dùng để đọc hiểu behavior/API.

Không copy nguyên file, nguyên module hoặc lượng code đáng kể từ repo tham khảo nếu chưa kiểm tra license.

Nếu cần sử dụng lại logic đáng kể từ repo tham khảo:

- Kiểm tra license của repo đó.
- Ghi attribution phù hợp nếu license yêu cầu.
- Ưu tiên tự thiết kế lại interface/module theo kiến trúc của gateway.
- Không đưa repo tham khảo thành runtime dependency nếu không có quyết định kiến trúc rõ ràng.

---

## 7. High-level Architecture

```text
Client / IDE / Script
  ↓
Compatibility API Layer
  ↓
Auth Middleware
  ↓
Request ID Middleware
  ↓
Request Validation
  ↓
Rate Limit / Quota / Concurrency Guard
  ↓
ModelResolver
  ↓
RoutingProfileResolver
  ↓
CapabilityMatcher
  ↓
ProviderRouter
  ↓
ProviderAdapterRegistry
  ↓
Provider Adapter
  ↓
AccountPool
  ↓
SessionManager / TokenManager
  ↓
Provider Client
  ↓
Upstream AI Service
```

Admin control plane:

```text
Dashboard UI
  ↓
Admin API /admin/v1/*
  ↓
Config Store / State Store / Secret Store
  ↓
Gateway Core
```

---

## 8. Multi-Provider Architecture

### 8.1 Provider Type

`ProviderType` mô tả loại provider adapter mà hệ thống hỗ trợ.

Ví dụ:

```text
kiro
windsurf
openai
anthropic
openrouter
gemini
bedrock
azure-openai
openai-compatible
anthropic-compatible
custom-http
local-llm
```

Schema đề xuất:

```ts
export interface ProviderTypeDefinition {
  type: string;
  displayName: string;
  adapterName: string;

  authMethods: Array<
    | "api_key"
    | "bearer_token"
    | "oauth"
    | "refresh_token"
    | "session_cookie"
    | "custom_json"
  >;

  supportedProtocols: Array<
    | "openai_chat_completions"
    | "anthropic_messages"
    | "custom"
  >;

  capabilities: ProviderCapabilities;

  configSchema: Record<string, unknown>;
  credentialSchema: Record<string, unknown>;
}
```

### 8.2 Provider Instance

`ProviderInstance` là một cấu hình provider cụ thể đang được bật trong gateway.

Ví dụ:

```text
Kiro Main
Windsurf Main
OpenAI Backup
Anthropic Premium
Local Qwen Server
OpenRouter Fallback
```

Schema đề xuất:

```ts
export interface ProviderInstance {
  id: string;
  type: string;
  name: string;

  enabled: boolean;
  baseUrl?: string;
  priority?: number;

  config: Record<string, unknown>;

  defaultTimeoutMs: number;
  maxRetries: number;
  cooldownMs: number;

  accountSelectionStrategy:
    | "round_robin"
    | "weighted_round_robin"
    | "least_busy"
    | "lowest_error_rate"
    | "lowest_latency";

  maxConcurrentRequests: number;
  maxConcurrentRequestsPerAccount: number;

  circuitBreaker: {
    enabled: boolean;
    failureThreshold: number;
    cooldownMs: number;
    halfOpenMaxRequests: number;
  };

  createdAt: Date;
  updatedAt: Date;
}
```

### 8.3 Provider Account

Mỗi provider instance có account pool riêng.

Schema generic:

```ts
export type AccountStatus = "active" | "cooldown" | "disabled";

export interface ProviderAccount {
  id: string;

  providerInstanceId: string;
  providerType: string;

  displayName: string;
  status: AccountStatus;

  weight: number;
  priority?: number;
  maxConcurrency: number;

  credentialRef: string;
  allowedModels?: string[];
  tags?: string[];
  owner?: string;

  runtime: {
    activeRequests: number;
    totalRequests: number;
    failedRequests: number;
    consecutiveFailures: number;
    lastUsedAt?: Date;
    lastSuccessAt?: Date;
    lastFailureAt?: Date;
    lastError?: string;
    cooldownUntil?: Date;
  };

  metadata?: Record<string, unknown>;

  createdAt: Date;
  updatedAt: Date;
}
```

### 8.4 Provider Account Secret

Credential phải được tách riêng và mã hóa.

```ts
export interface ProviderAccountSecret {
  id: string;
  accountId: string;

  credentialType:
    | "api_key"
    | "bearer_token"
    | "oauth"
    | "refresh_token"
    | "session_cookie"
    | "custom_json";

  encryptedPayload: string;

  expiresAt?: Date;
  updatedAt: Date;
}
```

Admin API/dashboard không được trả raw secret sau khi lưu.

### 8.5 Provider Adapter Interface

```ts
export interface AIProviderAdapter {
  type: string;

  getCapabilities(): ProviderCapabilities;

  validateConfig(config: Record<string, unknown>): Promise<void>;
  validateCredential(payload: Record<string, unknown>): Promise<void>;

  listModels(context: ProviderContext): Promise<ProviderModel[]>;

  chatCompletions(
    request: OpenAIChatCompletionRequest,
    context: ProviderRequestContext
  ): Promise<NormalizedOpenAIResponse | ProviderStream>;

  messages(
    request: AnthropicMessagesRequest,
    context: ProviderRequestContext
  ): Promise<NormalizedAnthropicResponse | ProviderStream>;

  healthCheck(context: ProviderContext): Promise<ProviderHealth>;

  refreshSession?(
    account: ProviderAccount,
    context: ProviderContext
  ): Promise<SessionRefreshResult>;
}
```

### 8.6 Provider Adapter Registry

```ts
export interface ProviderAdapterRegistry {
  register(definition: ProviderTypeDefinition, adapter: AIProviderAdapter): void;
  getAdapter(providerType: string): AIProviderAdapter;
  listProviderTypes(): ProviderTypeDefinition[];
}
```

Rule:

```text
Gateway core must not import provider-specific logic directly.
All providers must be registered through ProviderAdapterRegistry.
```

---

## 9. Provider Plugin SDK

Về lâu dài, nên có Provider Plugin SDK để thêm provider mới mà ít sửa core.

Example:

```ts
registerProviderAdapter({
  type: "deepseek",
  displayName: "DeepSeek",
  adapter: new DeepSeekProviderAdapter(),
  configSchema,
  credentialSchema,
  capabilities
});
```

Provider adapter mới phải pass Provider Adapter Contract Test Suite trước khi được merge.

---

## 10. Custom HTTP Provider

Nên có `CustomHTTPProviderAdapter` để kết nối nhanh các provider OpenAI-compatible hoặc Anthropic-compatible mà chưa cần viết adapter riêng.

MVP custom provider chỉ cần support OpenAI-compatible.

Schema đề xuất:

```ts
export interface CustomHTTPProviderConfig {
  protocol:
    | "openai_compatible"
    | "anthropic_compatible"
    | "custom";

  baseUrl: string;

  authType:
    | "none"
    | "api_key_header"
    | "bearer_token"
    | "custom_header";

  authHeaderName?: string;
  defaultHeaders?: Record<string, string>;

  modelListEndpoint?: string;
  chatCompletionEndpoint?: string;
  messagesEndpoint?: string;

  responseMapping?: Record<string, unknown>;
  streamMapping?: Record<string, unknown>;
}
```

---

## 11. API Endpoints

### 11.1 Compatibility API

```text
GET  /healthz
GET  /readyz
GET  /metrics
GET  /v1/models
POST /v1/chat/completions
POST /v1/messages
```

### 11.2 Admin API

Admin API phải có version.

```text
GET    /admin/v1/overview
GET    /admin/v1/provider-types
GET    /admin/v1/provider-instances
POST   /admin/v1/provider-instances
GET    /admin/v1/provider-instances/:id
PATCH  /admin/v1/provider-instances/:id
DELETE /admin/v1/provider-instances/:id

GET    /admin/v1/accounts
POST   /admin/v1/accounts
GET    /admin/v1/accounts/:id
PATCH  /admin/v1/accounts/:id
DELETE /admin/v1/accounts/:id
POST   /admin/v1/accounts/:id/enable
POST   /admin/v1/accounts/:id/disable
POST   /admin/v1/accounts/:id/cooldown
POST   /admin/v1/accounts/:id/clear-cooldown
POST   /admin/v1/accounts/:id/test
POST   /admin/v1/accounts/:id/refresh-session
POST   /admin/v1/accounts/:id/rotate-credential

GET    /admin/v1/model-mappings
POST   /admin/v1/model-mappings
GET    /admin/v1/model-mappings/:id
PATCH  /admin/v1/model-mappings/:id
DELETE /admin/v1/model-mappings/:id

GET    /admin/v1/routing-profiles
POST   /admin/v1/routing-profiles
GET    /admin/v1/routing-profiles/:id
PATCH  /admin/v1/routing-profiles/:id
DELETE /admin/v1/routing-profiles/:id
POST   /admin/v1/routing-profiles/:id/test

GET    /admin/v1/api-keys
POST   /admin/v1/api-keys
PATCH  /admin/v1/api-keys/:id
DELETE /admin/v1/api-keys/:id
POST   /admin/v1/api-keys/:id/disable
POST   /admin/v1/api-keys/:id/enable

GET    /admin/v1/teams
POST   /admin/v1/teams
PATCH  /admin/v1/teams/:id
DELETE /admin/v1/teams/:id

GET    /admin/v1/usage
GET    /admin/v1/request-logs
GET    /admin/v1/audit-logs
GET    /admin/v1/metrics
GET    /admin/v1/settings
PATCH  /admin/v1/settings

GET    /admin/v1/config/revisions
POST   /admin/v1/config/validate
POST   /admin/v1/config/publish
POST   /admin/v1/config/rollback
GET    /admin/v1/openapi.json
```

---

## 12. Health, Readiness & Metrics

### 12.1 `/healthz`

`/healthz` dùng cho Docker/Kubernetes liveness check.

Endpoint này có thể không cần auth, nhưng chỉ được trả thông tin tối thiểu.

```json
{
  "status": "ok"
}
```

Không trả thông tin provider/account chi tiết qua endpoint public.

### 12.2 `/readyz`

`/readyz` dùng cho readiness check nội bộ.

Endpoint này phải cần internal API key hoặc admin API key.

```json
{
  "status": "ok",
  "version": "0.1.0",
  "providers": {
    "provider_kiro_main": {
      "type": "kiro",
      "enabled": true,
      "status": "ok",
      "circuitBreaker": "closed",
      "activeAccounts": 3,
      "cooldownAccounts": 1,
      "disabledAccounts": 0
    }
  }
}
```

### 12.3 `/metrics`

`/metrics` dùng cho monitoring nội bộ.

Endpoint này nên cần admin API key hoặc chỉ bind trong private network.

Metrics tối thiểu:

```text
request_total
request_success_total
request_error_total
request_latency_ms
provider_request_total
provider_error_total
provider_latency_ms
active_accounts
cooldown_accounts
disabled_accounts
stream_active_total
rate_limited_total
circuit_breaker_open_total
request_queue_size
```

MVP có thể trả JSON metrics. Production nên dùng Prometheus format.

---

## 13. Authentication, Admin Auth & RBAC

### 13.1 Internal API Key

Mọi request tới API chính cần kiểm tra header:

```text
Authorization: Bearer <INTERNAL_API_KEY>
```

Exception:

```text
GET /healthz
```

MVP `.env`:

```env
INTERNAL_API_KEYS=dev-key-1,dev-key-2
ADMIN_API_KEYS=admin-key-1
```

Gateway không được log raw API key.

Khi log, chỉ được log hash:

```text
user_api_key_hash=sha256(key).slice(0, 12)
```

### 13.2 Internal API Key Schema

```ts
export interface InternalApiKey {
  id: string;
  name: string;
  keyHash: string;

  owner?: string;
  teamId?: string;

  enabled: boolean;

  allowedModels?: string[];
  allowedProviders?: string[];

  rpmLimit?: number;
  dailyLimit?: number;
  monthlyLimit?: number;

  createdAt: Date;
  lastUsedAt?: Date;
}
```

Raw API key chỉ hiển thị đúng một lần khi tạo.

### 13.3 Admin Auth

MVP:

```text
Authorization: Bearer <ADMIN_API_KEY>
```

Production:

- Admin login.
- RBAC.
- OIDC/SSO nếu cần.
- HTTPS.
- IP allowlist.
- Audit log.
- CSRF protection nếu dùng cookie session.

### 13.4 RBAC Roles

Roles đề xuất:

```text
Owner
Admin
Operator
Viewer
```

Permissions:

```text
Viewer:
- Xem overview, provider, account, model, usage, logs metadata.

Operator:
- Enable/disable account.
- Clear cooldown.
- Test account.
- Reset circuit breaker.

Admin:
- Thêm/sửa/xóa account.
- Thêm/sửa/xóa model mapping.
- Tạo API key.
- Sửa provider config.

Owner:
- Quản lý admin users.
- Quản lý encryption key.
- Xóa dữ liệu.
- Sửa security settings.
```

---

## 14. Team / Workspace Multi-tenancy

Long-term nên có khái niệm:

```text
Team
Project
User
API Key
Quota
Allowed Models
Allowed Providers
```

Example:

```text
Team Frontend:
- allowed models: coding, fast
- daily limit: 5000 requests

Team Backend:
- allowed models: coding, strong
- daily limit: 10000 requests
```

Schema:

```ts
export interface Team {
  id: string;
  name: string;
  enabled: boolean;
  allowedModels?: string[];
  allowedProviders?: string[];
  rpmLimit?: number;
  dailyLimit?: number;
  monthlyLimit?: number;
  createdAt: Date;
  updatedAt: Date;
}
```

---

## 15. Rate Limit, Quota, Concurrency & Backpressure

MVP config:

```env
DEFAULT_KEY_RPM=60
DEFAULT_KEY_DAILY_LIMIT=1000
MAX_CONCURRENT_REQUESTS=100
MAX_CONCURRENT_REQUESTS_PER_PROVIDER=50
MAX_CONCURRENT_REQUESTS_PER_ACCOUNT=3
```

Rules:

```text
Per-key RPM limit exceeded           → 429 internal_rate_limit_exceeded
Per-key daily quota exceeded         → 429 internal_quota_exceeded
Global concurrency exceeded          → 503 gateway_overloaded
Provider concurrency exceeded        → 503 provider_overloaded
Account concurrency exceeded         → chọn account khác; nếu không có thì 503 no_available_account
```

### 15.1 Optional Request Queue

Nếu account pool hết capacity, gateway có thể dùng queue ngắn.

Config:

```env
REQUEST_QUEUE_ENABLED=true
REQUEST_QUEUE_MAX_SIZE=100
REQUEST_QUEUE_TIMEOUT_MS=10000
```

Nếu queue đầy:

```json
{
  "error": {
    "type": "overloaded",
    "message": "Gateway is overloaded"
  }
}
```

---

## 16. Model Registry

Model mapping phải provider-agnostic:

```text
publicModel → providerInstance → upstreamModel
```

Examples:

```text
kiro-sonnet       → Kiro Main        → sonnet
windsurf-sonnet   → Windsurf Main    → sonnet-4.6
openai-gpt-4.1    → OpenAI Backup    → gpt-4.1
anthropic-sonnet  → Anthropic Main   → claude-sonnet
local-qwen        → Local Qwen       → qwen3-coder
```

`model` là required field. Nếu request thiếu `model`, gateway trả `400 invalid_request_error`.

Schema:

```ts
export interface ModelMapping {
  id: string;

  publicModel: string;

  providerInstanceId: string;
  providerType: string;

  upstreamModel: string;

  enabled: boolean;
  description?: string;

  capabilities: {
    chat: boolean;
    messages: boolean;
    streaming: boolean;
    tools: boolean;
    jsonMode: boolean;
    vision: boolean;
    embeddings: boolean;
    rerank: boolean;
  };

  limits?: {
    maxInputTokens?: number;
    maxOutputTokens?: number;
  };

  defaultParams?: {
    temperature?: number;
    topP?: number;
    maxTokens?: number;
  };

  pricingRef?: string;
  priority?: number;

  createdAt: Date;
  updatedAt: Date;
}
```

Unknown model:

```json
{
  "error": {
    "message": "Unknown model: abc",
    "type": "invalid_request_error",
    "code": "model_not_found"
  }
}
```

---

## 17. Routing Profiles

Routing Profile thay thế khái niệm virtual model.

Các profile như:

```text
auto
coding
fast
balanced
strong
```

Routing profile là combo/fallback chain giống tinh thần 9Router.

Examples:

```yaml
auto:
  strategy: priority_order
  candidates:
    - anthropic-sonnet
    - openai-gpt-4.1
    - kiro-sonnet
    - windsurf-sonnet
  fallback: true

coding:
  strategy: capability_match
  constraints:
    requireTools: false
    minContextTokens: 128000
  candidates:
    - local-qwen
    - kiro-sonnet
    - windsurf-sonnet
    - anthropic-sonnet
  fallback: true

fast:
  strategy: lowest_latency
  candidates:
    - openai-mini
    - gemini-flash
    - local-small
  fallback: true

strong:
  strategy: priority_order
  candidates:
    - anthropic-opus
    - openai-gpt-4.1
    - gemini-pro
  fallback: true
```

Schema:

```ts
export interface RoutingProfile {
  id: string;
  name: string;

  enabled: boolean;

  strategy:
    | "priority_order"
    | "weighted_round_robin"
    | "lowest_latency"
    | "lowest_error_rate"
    | "least_busy"
    | "cost_aware"
    | "quality_score"
    | "context_length_match"
    | "team_policy"
    | "time_based_routing"
    | "budget_based_routing"
    | "capability_match";

  candidates: Array<{
    modelMappingId: string;
    publicModel: string;
    providerInstanceId: string;
    providerType: string;
    upstreamModel: string;
    priority: number;
    weight?: number;
  }>;

  fallbackEnabled: boolean;

  constraints?: {
    requireStreaming?: boolean;
    requireTools?: boolean;
    requireJsonMode?: boolean;
    requireVision?: boolean;
    minContextTokens?: number;
    maxLatencyMs?: number;
    maxEstimatedCost?: number;
    allowedTeams?: string[];
  };

  createdAt: Date;
  updatedAt: Date;
}
```

Model resolve order:

```text
1. Tìm exact public model trong ModelRegistry.
2. Nếu không có, tìm RoutingProfile cùng tên.
3. Nếu không có, trả 404 model_not_found.
```

Không nên phụ thuộc vào prefix rule như `kiro-*` hoặc `ws-*` trong production. Prefix rule chỉ nên là dev convenience nếu thật sự cần.

---

## 18. Capability Matrix & Capability Matcher

Gateway phải biết capability nào được support bởi từng provider/model.

MVP support tối thiểu:

| Capability | OpenAI `/v1/chat/completions` | Anthropic `/v1/messages` | MVP status |
|---|---:|---:|---|
| Text input | Yes | Yes | Required |
| Text output | Yes | Yes | Required |
| Streaming | Yes | Yes | Required before MVP complete |
| System message | Yes | Yes | Required |
| Multi-turn messages | Yes | Yes | Required |
| Tool/function calling | Best effort | Best effort | Optional / Phase later |
| JSON mode | Best effort | Best effort | Optional / Phase later |
| Image input | No | No | Not in MVP |
| Audio input | No | No | Not in MVP |
| Embeddings | Optional | N/A | Phase later |
| Rerank | Optional | N/A | Phase later |

Rules:

- Nếu client gửi capability mà selected provider/model không support, gateway phải fallback sang candidate khác có support nếu routing profile cho phép.
- Nếu không có candidate nào support, trả lỗi rõ ràng.
- Không silently ignore tool calls hoặc JSON mode nếu client phụ thuộc vào chúng.
- Nếu chỉ pass-through best effort, phải log metadata rằng capability đó được pass-through.

Unsupported capability error:

```json
{
  "error": {
    "message": "Model windsurf-sonnet does not support tool calling",
    "type": "invalid_request_error",
    "code": "unsupported_capability"
  }
}
```

---

## 19. Account Pool

Mỗi provider instance có account pool riêng.

```text
ProviderInstance: Kiro Main
  → AccountPool: kiro-main-pool

ProviderInstance: Windsurf Main
  → AccountPool: windsurf-main-pool

ProviderInstance: OpenAI Backup
  → AccountPool: openai-backup-pool
```

AccountPool interface:

```ts
export interface AccountPool {
  nextAccount(options?: NextAccountOptions): Promise<ProviderAccount | null>;
  markAccountSuccess(accountId: string): Promise<void>;
  markAccountFailed(accountId: string, error: ProviderError): Promise<void>;
  markAccountCooldown(
    accountId: string,
    durationMs: number,
    reason: string
  ): Promise<void>;
  markAccountDisabled(accountId: string, reason: string): Promise<void>;
  acquireAccountSlot(accountId: string): Promise<boolean>;
  releaseAccountSlot(accountId: string): Promise<void>;
}
```

Selection strategies:

```text
round_robin
weighted_round_robin
least_busy
lowest_error_rate
lowest_latency
```

MVP default:

```text
round_robin
```

Rules:

- Chỉ chọn account `active`.
- Không chọn account `cooldown`.
- Không chọn account `disabled`.
- Không chọn account đã đạt max concurrency.
- Nếu account có `cooldownUntil` đã hết hạn, có thể chuyển lại `active`.
- Round-robin index phải concurrency-safe.
- Nếu chạy nhiều gateway replicas, phải dùng Redis/Postgres shared state.

---

## 20. Account Runtime State

Provider credential và runtime state phải tách riêng.

Credential source MVP:

```text
secrets/provider-accounts.json
```

Runtime state MVP:

```text
memory
```

Runtime state production:

```text
Redis/Postgres
```

Config:

```env
ACCOUNT_STATE_BACKEND=memory
```

Future:

```env
ACCOUNT_STATE_BACKEND=redis
REDIS_URL=redis://localhost:6379
DATABASE_URL=postgres://user:password@localhost:5432/ai_gateway
```

Rules:

- `cooldown` có thể lưu memory trong MVP.
- `disabled` do 401/403 nên được persist nếu có state backend.
- Không ghi credential/token vào usage log hoặc account state log.
- Nếu MVP dùng memory, restart gateway sẽ reset cooldown/disabled state.
- Admin API không được expose access token, refresh token, session cookie hoặc raw credential.

---

## 21. Token & Session Management

Vì gateway chạy native provider mode, mỗi provider cần có cơ chế quản lý token/session riêng.

Mỗi provider adapter nên có session manager riêng nếu cần:

```text
KiroSessionManager
WindsurfSessionManager
OpenAIKeyManager
CustomHTTPSessionManager
```

Responsibilities:

- Load credential ban đầu từ secrets file hoặc secret manager.
- Attach token/cookie/API key vào request upstream.
- Detect token/session expired.
- Refresh token/session nếu provider hỗ trợ.
- Tránh nhiều request refresh cùng lúc cho cùng một account.
- Nếu refresh thành công, retry request ban đầu nếu request chưa stream response.
- Nếu refresh thất bại do auth error, mark account `disabled`.
- Nếu refresh thất bại do network/5xx/timeout, mark account `cooldown` ngắn.
- Không log access token, refresh token, session cookie hoặc raw credential.

Interface:

```ts
export interface SessionManager {
  getAuthHeaders(accountId: string): Promise<Record<string, string>>;
  refreshSession(accountId: string): Promise<void>;
  markSessionInvalid(accountId: string, reason: string): Promise<void>;
}
```

Refresh lock requirement:

```text
Nếu nhiều request cùng phát hiện token expired cho cùng một account,
chỉ một request được refresh token/session.
Các request khác phải chờ kết quả refresh hoặc chọn account khác.
```

---

## 22. Error Classification

Provider errors cần được normalize thành error type chung.

```ts
export type ProviderErrorType =
  | "auth_error"
  | "rate_limit_error"
  | "timeout_error"
  | "network_error"
  | "provider_5xx_error"
  | "invalid_request_error"
  | "provider_unavailable"
  | "unsupported_capability"
  | "gateway_overloaded"
  | "unknown_error";
```

Status code handling:

```text
401 / 403  → try refresh session if possible; if still fails, mark account disabled
429        → mark account cooldown
5xx        → retry another account, short cooldown current account
network    → retry another account
timeout    → retry another account
4xx khác   → usually no retry, return client error
```

---

## 23. Retry & Failover

Mỗi request cần retry qua nhiều account nếu account đầu lỗi.

MVP rule:

```text
max retries per provider instance: 3
max provider fallback: based on routing profile candidates
```

Example:

```text
Request model=coding
↓
Resolve routing profile coding
↓
Try local-qwen account 1
↓ timeout
Try local-qwen account 2
↓ still failed
Fallback kiro-sonnet account 1
↓ 429
Kiro account 1 cooldown
↓
Try kiro-sonnet account 2
```

Important rule:

```text
Retry/failover chỉ được thực hiện trước khi response stream bắt đầu.
Sau khi đã gửi chunk streaming đầu tiên cho client, gateway không được retry sang account/provider khác.
```

---

## 24. Circuit Breaker

Mỗi provider instance nên có circuit breaker.

States:

```text
closed     → provider hoạt động bình thường
open       → provider tạm thời bị bỏ qua
half_open  → cho phép một số request thử lại
```

Config:

```env
PROVIDER_CIRCUIT_BREAKER_FAILURE_THRESHOLD=10
PROVIDER_CIRCUIT_BREAKER_COOLDOWN_MS=60000
PROVIDER_CIRCUIT_BREAKER_HALF_OPEN_MAX_REQUESTS=3
```

Rules:

- Nếu provider có quá nhiều lỗi liên tiếp trong một khoảng thời gian, chuyển sang `open`.
- Trong trạng thái `open`, routing profile bỏ qua provider đó nếu còn candidate khác.
- Nếu client gọi model bắt buộc thuộc provider đang open, trả `503 provider_unavailable`.
- Sau cooldown, chuyển sang `half_open` để thử lại.
- Nếu half-open success, chuyển về `closed`.
- Nếu half-open fail, quay lại `open`.

---

## 25. Error Response Format

Gateway cần trả error tương thích với API mode tương ứng.

### 25.1 OpenAI-compatible error

```json
{
  "error": {
    "message": "All provider accounts are unavailable",
    "type": "provider_unavailable",
    "code": "provider_unavailable"
  }
}
```

### 25.2 Anthropic-compatible error

```json
{
  "type": "error",
  "error": {
    "type": "overloaded_error",
    "message": "All provider accounts are unavailable"
  }
}
```

### 25.3 HTTP status mapping

```text
Invalid internal API key      → 401
Internal rate limit exceeded  → 429
Internal quota exceeded       → 429
Model not found               → 404
Unsupported capability        → 400
Invalid request body          → 400
Request body too large        → 413
No active account             → 503
Gateway overloaded            → 503
Provider circuit open         → 503
All retries failed            → 502
Provider timeout              → 504
Unexpected gateway error      → 500
```

---

## 26. Request Validation

Gateway phải validate request body trước khi route tới provider.

Nên dùng `zod` hoặc `typebox`.

Validate tối thiểu:

- `model` is required.
- `messages` is array.
- `stream` is boolean if provided.
- `temperature` is number if provided.
- `top_p` is number if provided.
- `max_tokens` is positive integer if provided.
- Request body size không vượt giới hạn.
- Tool/function fields phải được nhận diện để check capability.

Config:

```env
MAX_REQUEST_BODY_SIZE=2mb
```

Nếu vượt body size:

```text
413 Payload Too Large
```

Example:

```ts
const OpenAIChatCompletionSchema = z.object({
  model: z.string(),
  messages: z.array(z.any()),
  stream: z.boolean().optional(),
  temperature: z.number().min(0).max(2).optional(),
  top_p: z.number().min(0).max(1).optional(),
  max_tokens: z.number().int().positive().optional(),
  tools: z.array(z.any()).optional(),
  tool_choice: z.any().optional(),
  response_format: z.any().optional()
}).passthrough();
```

Unsupported fields có thể pass-through nếu provider hỗ trợ, nhưng không được làm gateway crash.

---

## 27. Response Normalization

Provider adapter không được trả raw upstream response trực tiếp nếu response đó không tương thích client.

Gateway phải normalize response về format tương ứng với endpoint public.

### 27.1 OpenAI-compatible `/v1/chat/completions`

Response tối thiểu:

```json
{
  "id": "chatcmpl-...",
  "object": "chat.completion",
  "created": 1710000000,
  "model": "kiro-sonnet",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "..."
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 100,
    "completion_tokens": 50,
    "total_tokens": 150
  }
}
```

### 27.2 Anthropic-compatible `/v1/messages`

Response tối thiểu:

```json
{
  "id": "msg_...",
  "type": "message",
  "role": "assistant",
  "model": "kiro-sonnet",
  "content": [
    {
      "type": "text",
      "text": "..."
    }
  ],
  "stop_reason": "end_turn",
  "usage": {
    "input_tokens": 100,
    "output_tokens": 50
  }
}
```

Nếu upstream không trả usage, gateway phải estimate usage.

---

## 28. Streaming

Gateway phải support streaming SSE.

Nếu request có:

```json
{
  "stream": true
}
```

Yêu cầu:

- Không buffer toàn bộ response.
- Forward chunk ngay khi nhận được.
- Giữ connection sống.
- Handle client disconnect bằng `AbortController`.
- Nếu upstream lỗi trước chunk đầu tiên, trả normal JSON error.
- Nếu upstream lỗi sau khi stream đã bắt đầu, emit provider-compatible error event nếu có thể, sau đó close stream.
- Không log prompt/completion.
- Không retry/failover sau khi đã gửi chunk đầu tiên.

### 28.1 OpenAI SSE

```text
data: {"id":"chatcmpl-...","object":"chat.completion.chunk",...}

data: [DONE]
```

### 28.2 Anthropic SSE

Anthropic-compatible endpoint cần trả stream dạng Anthropic Messages API.

Nếu provider format khác, provider adapter phải transform về format tương thích.

### 28.3 Stream timeout

```env
REQUEST_TIMEOUT_MS=120000
STREAM_IDLE_TIMEOUT_MS=30000
PROVIDER_CONNECT_TIMEOUT_MS=10000
HEALTH_CHECK_TIMEOUT_MS=5000
```

Rules:

```text
Non-streaming request timeout: 120s
Streaming idle timeout: 30s without chunk
Provider connect timeout: 10s
Health check timeout: 5s
```

---

## 29. Logging & Redaction

Gateway chỉ được log metadata.

Allowed logs:

```text
request_id
user_api_key_hash
team_id
provider_instance_id
provider_type
account_id
public_model
resolved_model
upstream_model
status_code
latency_ms
stream
error_type
timestamp
retry_count
fallback_used
circuit_breaker_state
capability_flags
```

Forbidden logs:

```text
prompt
messages content
source code người dùng
completion text
secret token
raw authorization header
cookie
session token
access token
refresh token
provider raw credential
```

Redaction logger example:

```ts
redact: [
  "req.headers.authorization",
  "req.headers.cookie",
  "res.headers['set-cookie']",
  "body.messages",
  "body.prompt",
  "body.input",
  "body.content",
  "body.completion",
  "body.tools",
  "body.tool_choice",
  "*.access_token",
  "*.refresh_token",
  "*.sessionCookie",
  "*.encryptedPayload"
]
```

---

## 30. Usage Tracking & Cost/Pricing

MVP có thể estimate token bằng tokenizer hoặc đo gần đúng bằng độ dài text.

Metadata cần lưu:

```text
request count
estimated input tokens
estimated output tokens
provider instance
provider type
account
model
routing profile
latency
success/failure
error_type
team/api key
```

Nếu upstream trả usage chuẩn thì dùng usage upstream.

Nếu không có usage:

```text
estimated_tokens ≈ text_length / 4
```

Không lưu nội dung prompt hoặc completion để tính usage lâu dài.

### 30.1 Pricing

Khi thêm provider trả tiền theo token, nên có pricing table.

```ts
export interface ModelPricing {
  id: string;
  modelMappingId: string;
  inputCostPer1MTokens?: number;
  outputCostPer1MTokens?: number;
  currency: "USD";
  effectiveFrom: Date;
}
```

Dashboard hiển thị:

```text
Cost today
Cost by API key
Cost by team
Cost by provider
Cost by model
```

Với provider kiểu Windsurf/Kiro nếu không biết cost, để `estimatedCost = unknown` hoặc tính theo quota nội bộ.

---

## 31. Health Checker & Auto Recovery

Cần có background health checker.

MVP behavior:

- Chạy mỗi 1-5 phút.
- Kiểm tra account cooldown đã hết hạn chưa.
- Nếu hết cooldown, chuyển account về `active`.
- Có thể chạy lightweight health check nếu provider hỗ trợ.
- Không gửi prompt thật hoặc source code thật để test health.

Config:

```env
HEALTH_CHECK_INTERVAL_MS=60000
```

---

## 32. Dashboard Design

Dashboard là control plane nội bộ của gateway.

### 32.1 Main Pages

```text
Overview
Provider Catalog
Provider Instances
Accounts
Model Registry
Routing Profiles
API Keys
Teams / Workspaces
CLI Tools
Usage
Costs / Pricing
Request Logs
Audit Logs
Metrics / Health
Evaluations
Playground
Settings
Config Revisions
```

### 32.2 Overview

Hiển thị:

- Gateway status.
- Provider status.
- Account active/cooldown/disabled.
- Request count.
- Success/error rate.
- Average latency.
- Active streams.
- Queue size.
- Top models.
- Top teams/API keys.
- Recent errors.

### 32.3 Provider Catalog

Hiển thị provider type mà hệ thống support:

```text
Kiro
Windsurf
OpenAI
Anthropic
OpenRouter
Gemini
Azure OpenAI
AWS Bedrock
Local OpenAI-compatible
Custom HTTP
```

Mỗi provider type có nút `Connect`.

Dashboard mở form động dựa trên `configSchema` và `credentialSchema`.

### 32.4 Provider Instances

Quản lý provider instance:

- Add provider instance.
- Enable/disable provider.
- Test provider.
- Reset circuit breaker.
- Configure max retries.
- Configure timeout.
- Configure cooldown.
- Configure max concurrency.
- Configure account selection strategy.
- View provider logs.
- View provider usage.

### 32.5 Accounts

Quản lý account pool:

- Add account.
- Edit account metadata.
- Enable account.
- Disable account.
- Put account into cooldown.
- Clear cooldown.
- Test account.
- Refresh session/token.
- Rotate credential.
- Delete account.

Account list columns:

```text
Account ID
Provider instance
Provider type
Display name
Status
Weight
Priority
Max concurrency
Current active requests
Total requests
Failed requests
Success rate
Last used at
Last error
Cooldown until
Credential status
Session/token expiry if known
```

Không bao giờ hiển thị raw token, refresh token, session cookie hoặc authorization header sau khi đã lưu.

### 32.6 Add Account Wizard

Wizard 3 bước:

```text
Step 1: Basic info
- Provider instance
- Display name
- Tags
- Enabled after save
- Weight
- Max concurrency

Step 2: Credential
- Credential type
- API key / bearer token / refresh token / session cookie / custom JSON

Step 3: Test & save
- Test connection
- Fetch available models if supported
- Save account
```

### 32.7 Model Registry

Quản lý fixed model mapping:

```text
publicModel → providerInstance → upstreamModel
```

Fields:

- Public model name.
- Provider instance.
- Upstream model name.
- Enabled.
- Description.
- Capabilities.
- Max input tokens.
- Max output tokens.
- Default params.
- Pricing ref.
- Priority.

### 32.8 Routing Profiles

Quản lý combo/fallback chain:

- `auto`
- `coding`
- `fast`
- `balanced`
- `strong`

Fields:

- Profile name.
- Strategy.
- Candidate models.
- Fallback enabled.
- Constraints.
- Test profile.

### 32.9 API Keys

Quản lý internal API keys:

- Create key.
- Disable key.
- Delete key.
- Set owner/team.
- Set allowed models.
- Set allowed providers.
- Set RPM limit.
- Set daily/monthly limit.

Raw API key chỉ hiển thị một lần khi tạo. Sau đó chỉ lưu hash.

### 32.10 CLI Tools

Trang copy-paste config cho:

- Cursor.
- Cline.
- Aider.
- Claude Code.
- Continue.
- Roo Code.
- Custom OpenAI-compatible client.

Example:

```text
Provider: OpenAI Compatible
Base URL: http://localhost:8080/v1
API Key: <generated internal key>
Model: coding
```

Claude Code:

```bash
export ANTHROPIC_BASE_URL=http://localhost:8080
export ANTHROPIC_API_KEY=<generated internal key>
claude
```

### 32.11 Usage

Hiển thị usage theo:

- Provider.
- Account.
- Model.
- Routing profile.
- API key.
- Team.
- Time range.

Không hiển thị prompt, source code hoặc completion.

### 32.12 Request Logs

Chỉ hiển thị metadata:

```text
request_id
api_key_hash
team_id
provider_instance_id
provider_type
account_id
public_model
resolved_model
upstream_model
status_code
latency_ms
stream
error_type
timestamp
```

### 32.13 Audit Logs

Ghi lại mọi hành động admin:

- Thêm/sửa/xóa account.
- Enable/disable account.
- Sửa provider config.
- Sửa model mapping.
- Sửa routing profile.
- Tạo/xóa API key.
- Reset circuit breaker.
- Publish/rollback config.

Audit record:

```ts
export interface AuditLog {
  id: string;
  actor: string;
  action: string;
  targetType: string;
  targetId: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  ipAddress?: string;
  createdAt: Date;
}
```

### 32.14 Playground

Playground nội bộ để test model:

- OpenAI mode.
- Anthropic mode.
- Model/routing profile selector.
- Stream true/false.
- Temperature/max_tokens.
- Show selected provider/account/upstream model.
- Show latency/token usage.

Mặc định không lưu prompt/completion. Chỉ lưu metadata.

### 32.15 Evaluations

Roadmap page để benchmark provider/model:

- Chạy test prompt cố định.
- So sánh latency.
- So sánh error rate.
- So sánh output quality bằng manual rating.
- So sánh tool-call compatibility.
- So sánh cost.

### 32.16 Settings

Cấu hình:

- Default model.
- Default provider order.
- Request timeout.
- Body size limit.
- Logging level.
- Retention days.
- CORS allowlist.
- IP allowlist.
- Admin session timeout.
- Secret encryption status.
- Config rollout mode.

---

## 33. Config Versioning, Safe Rollout & Rollback

Dashboard cho phép sửa provider/account/model/routing. Vì vậy cần có config versioning.

### 33.1 Config Revision

```ts
export interface ConfigRevision {
  id: string;
  version: number;
  actor: string;
  changeSummary: string;
  snapshot: Record<string, unknown>;
  createdAt: Date;
}
```

### 33.2 Draft/Test/Publish Flow

Không nên sửa config là ảnh hưởng production ngay.

Flow:

```text
Draft config
  ↓
Validate
  ↓
Test
  ↓
Publish
  ↓
Create revision snapshot
```

### 33.3 Rollback

Dashboard phải cho phép rollback về revision trước nếu config mới gây lỗi.

---

## 34. Secret Management & Encryption

MVP có thể dùng file secret local.

Production nên dùng secret manager.

Config:

```env
SECRET_ENCRYPTION_PROVIDER=local
SECRET_ENCRYPTION_KEY=REPLACE_ME
```

Future:

```text
HashiCorp Vault
AWS KMS
GCP KMS
Azure Key Vault
1Password Connect
```

Rules:

- Secret phải encryption at rest.
- Không log secret.
- Không trả raw secret qua Admin API.
- Hỗ trợ key rotation.
- Backup secret phải được mã hóa.

---

## 35. Backup & Disaster Recovery

Dashboard quản lý dữ liệu quan trọng:

```text
provider config
account metadata
model mapping
routing profiles
API keys
audit logs
usage logs
settings
```

Production cần:

- Export backup.
- Restore backup.
- Scheduled backup.
- Backup encryption.
- Backup retention policy.
- Disaster recovery runbook.

---

## 36. Retention Policy

Metadata cũng cần retention.

Config:

```env
REQUEST_LOG_RETENTION_DAYS=30
USAGE_RETENTION_DAYS=180
AUDIT_LOG_RETENTION_DAYS=365
METRICS_RETENTION_DAYS=30
```

Audit log nên giữ lâu hơn request log.

---

## 37. Admin OpenAPI Docs

Admin API nên có OpenAPI spec:

```text
GET /admin/v1/openapi.json
```

Lợi ích:

- Dashboard frontend dễ gọi API.
- Dev dễ test.
- Có thể generate client SDK.
- AI coding agent dễ hiểu contract.

---

## 38. Config

MVP config qua `.env`.

Example:

```env
PORT=8080
NODE_ENV=development
LOG_LEVEL=info

INTERNAL_API_KEYS=dev-key-1,dev-key-2
ADMIN_API_KEYS=admin-key-1

DEFAULT_KEY_RPM=60
DEFAULT_KEY_DAILY_LIMIT=1000
MAX_CONCURRENT_REQUESTS=100
MAX_CONCURRENT_REQUESTS_PER_PROVIDER=50
MAX_CONCURRENT_REQUESTS_PER_ACCOUNT=3
MAX_REQUEST_BODY_SIZE=2mb

REQUEST_QUEUE_ENABLED=false
REQUEST_QUEUE_MAX_SIZE=100
REQUEST_QUEUE_TIMEOUT_MS=10000

ACCOUNT_STATE_BACKEND=memory
CONFIG_STORE_BACKEND=file
SECRET_ENCRYPTION_PROVIDER=local
SECRET_ENCRYPTION_KEY=replace-me

DEFAULT_MODEL=coding
REQUEST_TIMEOUT_MS=120000
STREAM_IDLE_TIMEOUT_MS=30000
PROVIDER_CONNECT_TIMEOUT_MS=10000
HEALTH_CHECK_TIMEOUT_MS=5000
HEALTH_CHECK_INTERVAL_MS=60000

PROVIDER_CIRCUIT_BREAKER_FAILURE_THRESHOLD=10
PROVIDER_CIRCUIT_BREAKER_COOLDOWN_MS=60000
PROVIDER_CIRCUIT_BREAKER_HALF_OPEN_MAX_REQUESTS=3

REQUEST_LOG_RETENTION_DAYS=30
USAGE_RETENTION_DAYS=180
AUDIT_LOG_RETENTION_DAYS=365
METRICS_RETENTION_DAYS=30
```

`.env` không được commit.

Bắt buộc tạo file example:

```text
.env.example
secrets/provider-accounts.example.json
```

---

## 39. Account Secrets

Credential provider nên để trong file riêng nằm ngoài git trong MVP.

```text
secrets/
  provider-accounts.json
  provider-accounts.example.json
```

`.gitignore` bắt buộc có:

```gitignore
.env
.env.*
!.env.example
secrets/*.json
!secrets/*.example.json
```

Example `secrets/provider-accounts.example.json`:

```json
[
  {
    "id": "kiro-1",
    "providerInstanceId": "provider_kiro_main",
    "displayName": "Kiro Account 1",
    "owner": "team-a",
    "credentialType": "refresh_token",
    "credentialPayload": {
      "accessToken": "REPLACE_ME",
      "refreshToken": "REPLACE_ME"
    }
  },
  {
    "id": "ws-1",
    "providerInstanceId": "provider_windsurf_main",
    "displayName": "Windsurf Account 1",
    "owner": "team-a",
    "credentialType": "refresh_token",
    "credentialPayload": {
      "accessToken": "REPLACE_ME",
      "refreshToken": "REPLACE_ME"
    }
  }
]
```

Production nên dùng secret manager thay vì JSON file.

---

## 40. Storage Backends

MVP:

```text
Config store: file/json
Runtime state: memory
Usage/logs: file/sqlite optional
Secrets: local encrypted file
```

Production:

```text
Redis:
- rate limit counters
- account cooldown state
- round-robin pointer
- account active request counters
- distributed lock
- request queue

Postgres:
- provider instances
- account metadata
- model mappings
- routing profiles
- API keys
- teams
- usage records
- request logs metadata
- audit logs
- config revisions

Secret Manager:
- provider credentials
- encryption keys
```

---

## 41. Project Structure

Recommended monorepo:

```text
apps/
  gateway/
    src/
      server.ts
      app.ts
      config.ts

      routes/
        healthz.ts
        readyz.ts
        metrics.ts
        models.ts
        openai.ts
        anthropic.ts

      admin/
        adminRoutes.ts
        adminAuth.ts
        adminAudit.ts
        openapi.ts

      middleware/
        auth.ts
        adminAuth.ts
        rateLimit.ts
        quota.ts
        concurrencyLimit.ts
        logger.ts
        errorHandler.ts
        requestId.ts
        requestValidation.ts

      router/
        ProviderRouter.ts
        ModelResolver.ts
        ModelRegistry.ts
        RoutingProfileRegistry.ts
        CapabilityMatcher.ts
        RoutingPolicy.ts

      providers/
        registry/
          ProviderAdapterRegistry.ts
          ProviderTypeDefinition.ts

        base/
          AIProviderAdapter.ts
          ProviderAccount.ts
          ProviderInstance.ts
          ProviderCapabilities.ts
          ProviderClient.ts
          SessionManager.ts
          ProviderErrors.ts
          types.ts

        adapters/
          kiro/
            KiroProviderAdapter.ts
            KiroClient.ts
            KiroSessionManager.ts
            kiroTypes.ts

          windsurf/
            WindsurfProviderAdapter.ts
            WindsurfClient.ts
            WindsurfSessionManager.ts
            windsurfTypes.ts

          openai-compatible/
            OpenAICompatibleProviderAdapter.ts

          anthropic-compatible/
            AnthropicCompatibleProviderAdapter.ts

          custom-http/
            CustomHTTPProviderAdapter.ts

      account-pool/
        AccountPool.ts
        RoundRobinStrategy.ts
        WeightedRoundRobinStrategy.ts
        LeastBusyStrategy.ts

      services/
        HealthChecker.ts
        UsageTracker.ts
        RequestLogger.ts
        AuditLogger.ts
        RateLimiter.ts
        QuotaService.ts
        MetricsService.ts
        CircuitBreaker.ts
        ConfigRevisionService.ts
        SecretService.ts
        BackupService.ts

      utils/
        sse.ts
        tokenEstimate.ts
        requestId.ts
        hash.ts
        timeout.ts
        redaction.ts
        mutex.ts

      validation/
        openaiSchemas.ts
        anthropicSchemas.ts
        adminSchemas.ts

  dashboard/
    src/
      App.tsx
      pages/
        OverviewPage.tsx
        ProviderCatalogPage.tsx
        ProviderInstancesPage.tsx
        AccountsPage.tsx
        ModelRegistryPage.tsx
        RoutingProfilesPage.tsx
        ApiKeysPage.tsx
        TeamsPage.tsx
        CliToolsPage.tsx
        UsagePage.tsx
        PricingPage.tsx
        RequestLogsPage.tsx
        AuditLogsPage.tsx
        MetricsPage.tsx
        EvaluationsPage.tsx
        PlaygroundPage.tsx
        SettingsPage.tsx
        ConfigRevisionsPage.tsx

      components/
        StatusBadge.tsx
        ProviderCard.tsx
        AccountTable.tsx
        ModelMappingTable.tsx
        RoutingProfileEditor.tsx
        SecretInput.tsx
        CopyConfigBlock.tsx

packages/
  shared/
    src/
      types/
      schemas/
      constants/
```

Alternative: dùng Next.js full-stack giống 9Router:

```text
apps/web/
  src/app/
    api/v1/chat/completions/route.ts
    api/v1/messages/route.ts
    api/v1/models/route.ts
    api/admin/v1/*
    dashboard/*
```

Nếu mục tiêu là giống 9Router nhất, Next.js full-stack là lựa chọn tốt. Nếu ưu tiên backend rõ ràng và worker/streaming ổn định, dùng Fastify/NestJS + React/Vite dashboard cũng phù hợp.

---

## 42. Docker Compose

MVP chỉ chạy service gateway/dashboard.

Không chạy `kiro-api` hoặc `windsurf-api` như service phụ.

```yaml
services:
  gateway:
    build: ./apps/gateway
    ports:
      - "8080:8080"
    env_file:
      - .env
    volumes:
      - ./secrets:/app/secrets:ro
      - ./data:/app/data
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:8080/healthz"]
      interval: 30s
      timeout: 5s
      retries: 3

  dashboard:
    build: ./apps/dashboard
    ports:
      - "3000:3000"
    env_file:
      - .env
    depends_on:
      - gateway
    restart: unless-stopped
```

Nếu dùng Next.js full-stack, có thể chỉ cần một service `web`.

Dockerfile requirements:

- Không copy `.env` vào image.
- Không copy secrets vào image.
- Chạy bằng non-root user nếu có thể.
- Có healthcheck dùng `/healthz`.

---

## 43. CLI Tool Configuration

### 43.1 Cursor / Cline / Aider / Continue / Roo Code

```text
Provider: OpenAI Compatible
Base URL: http://localhost:8080/v1
API Key: <internal-api-key>
Model: coding
```

Model cụ thể:

```text
Model: kiro-sonnet
Model: windsurf-sonnet
Model: auto
Model: coding
Model: strong
```

### 43.2 Claude Code

```bash
export ANTHROPIC_BASE_URL=http://localhost:8080
export ANTHROPIC_API_KEY=<internal-api-key>
claude
```

Dashboard `CLI Tools` page cần có copy button cho từng tool.

---

## 44. Onboarding Wizard

Dashboard nên có onboarding wizard giống 9Router để người dùng setup nhanh.

Steps:

```text
Step 1: Create admin key or login admin
Step 2: Connect first provider instance
Step 3: Add first provider account
Step 4: Test account
Step 5: Create first model mapping
Step 6: Create routing profile "coding"
Step 7: Create internal API key
Step 8: Copy Cursor/Cline/Claude Code config
Step 9: Send test request
```

---

## 45. Development Plan

Không làm tất cả một lần. Implement từng phase nhỏ.

### Phase 1: Gateway Skeleton

- Node.js + TypeScript.
- `server.ts`, `app.ts`, `config.ts`.
- `/healthz`.
- `/v1/models` hardcode.
- Auth middleware.
- Request ID middleware.
- Redacted logger.
- Body size limit.
- Error handler.
- Basic test setup.

Acceptance:

- `npm run dev` chạy được.
- `/healthz` trả OK.
- `/v1/models` trả model alias hardcode.
- Request thiếu API key bị reject.
- Authorization header không bị log.
- Request body quá lớn trả 413.

### Phase 2: Provider Adapter Core

- `AIProviderAdapter` interface.
- `ProviderAdapterRegistry`.
- `ProviderTypeDefinition`.
- `ProviderInstance` schema.
- `ProviderCapabilities`.
- Error types.
- Mock provider adapter.

Acceptance:

- Register được mock provider.
- List provider types.
- Validate provider config.
- Mock provider trả response normalized.

### Phase 3: Model Registry & Routing Profiles

- `ModelRegistry`.
- `RoutingProfileRegistry`.
- `ModelResolver`.
- `CapabilityMatcher`.
- Resolve fixed model.
- Resolve routing profile.

Acceptance:

- Resolve được `kiro-sonnet`, `windsurf-sonnet`, `auto`, `coding`.
- Unknown model trả 404.
- Unsupported capability trả lỗi chuẩn.

### Phase 4: AccountPool Base

- Generic `ProviderAccount`.
- `ProviderAccountSecret`.
- `AccountPool` base.
- Round-robin.
- Cooldown.
- Disabled account.
- Active request counter.
- Unit tests.

Acceptance:

- Round-robin đúng.
- Cooldown account bị skip.
- Disabled account bị skip.
- Account vượt concurrency limit bị skip.
- Cooldown hết hạn tự active lại.

### Phase 5: Session/Secret Base

- `SessionManager` interface.
- Secret loader.
- Local encryption service.
- Refresh lock/mutex theo account.
- Redaction rules.

Acceptance:

- Credential load được từ secrets file.
- Không log token/cookie.
- Refresh lock hoạt động.

### Phase 6: Kiro Provider Adapter Non-streaming

- `KiroProviderAdapter`.
- `KiroClient`.
- `KiroSessionManager`.
- Kiro account loading.
- Non-streaming `/v1/chat/completions`.
- Response normalization.
- Error classification.
- Retry account khác.

Acceptance:

- `model=kiro-sonnet` route sang Kiro adapter.
- Account được chọn bằng round-robin.
- 429 đưa account vào cooldown.
- 401/403 refresh session nếu có thể, nếu vẫn lỗi thì disable account.
- Response OpenAI-compatible.

### Phase 7: Windsurf Provider Adapter Non-streaming

- `WindsurfProviderAdapter`.
- `WindsurfClient`.
- `WindsurfSessionManager`.
- Windsurf account loading.
- Non-streaming `/v1/chat/completions`.
- Response normalization.
- Error classification.

Acceptance:

- `model=windsurf-sonnet` route sang Windsurf adapter.
- Account pool hoạt động.
- Error handling giống Kiro.
- Response OpenAI-compatible.

### Phase 8: Provider Fallback & Circuit Breaker

- Routing profile fallback.
- Circuit breaker.
- Concurrency guard.
- Request queue optional.

Acceptance:

- `model=auto` fallback đúng.
- `model=coding` chạy theo candidate order.
- Provider circuit open thì bỏ qua nếu còn fallback.
- Fallback được log metadata.

### Phase 9: Streaming

- OpenAI SSE.
- Provider stream adapter.
- Client disconnect abort.
- Stream idle timeout.
- No retry after first chunk.

Acceptance:

- `stream: true` hoạt động với `/v1/chat/completions`.
- `[DONE]` đúng format.
- Không buffer toàn bộ response.
- Client disconnect abort upstream.

### Phase 10: Anthropic Messages API

- `/v1/messages` validation.
- Request transform nếu cần.
- Response normalization.
- Anthropic streaming nếu provider hỗ trợ.

Acceptance:

- `/v1/messages` hoạt động.
- Error format Anthropic-compatible.
- Response Anthropic-compatible.

### Phase 11: Admin API MVP

- `/admin/v1/provider-types`.
- `/admin/v1/provider-instances`.
- `/admin/v1/accounts`.
- `/admin/v1/model-mappings`.
- `/admin/v1/routing-profiles`.
- `/admin/v1/api-keys`.
- `/admin/v1/usage`.
- `/admin/v1/request-logs`.
- `/admin/v1/audit-logs`.

Acceptance:

- Admin key required.
- Admin API không trả raw secret.
- Audit log ghi hành động admin.

### Phase 12: Dashboard MVP

Pages:

- Overview.
- Provider Catalog.
- Provider Instances.
- Accounts.
- Model Registry.
- Routing Profiles.
- API Keys.
- CLI Tools.
- Usage.
- Request Logs.
- Audit Logs.
- Settings.

Acceptance:

- Add provider instance qua dashboard.
- Add account qua dashboard.
- Add model mapping.
- Add routing profile.
- Create API key.
- Copy CLI config.
- View usage/log metadata.

### Phase 13: Metrics, Health, Config Versioning

- `/readyz`.
- `/metrics`.
- Health checker.
- Usage tracking.
- Config revisions.
- Validate/test/publish config.
- Rollback config.

Acceptance:

- `/readyz` authenticated.
- `/metrics` internal/admin.
- Config publish tạo revision.
- Rollback hoạt động.

### Phase 14: Docker, Docs & Hardening

- Dockerfile.
- docker-compose.yml.
- `.env.example`.
- secrets example.
- Security checklist.
- Integration tests.
- Provider contract tests.

Docker and hardening docs:

- `docker-compose.yml`
- `apps/gateway/Dockerfile`
- `apps/dashboard/Dockerfile`
- `DOCKER.md`
- `SECURITY_CHECKLIST.md`

Acceptance:

- `docker compose up` chạy được.
- Không copy secret vào image.
- Test suite pass.

---

## 46. Test Plan

### 46.1 Unit tests

- Auth middleware accepts valid key.
- Auth middleware rejects invalid key.
- Auth middleware does not log raw key.
- Admin auth rejects normal internal API key.
- ProviderAdapterRegistry registers provider.
- ModelRegistry resolves fixed model.
- RoutingProfileRegistry resolves profile.
- CapabilityMatcher rejects unsupported capability.
- AccountPool round-robin works.
- Cooldown account is skipped.
- Disabled account is skipped.
- Account over concurrency limit is skipped.
- Expired cooldown returns to active.
- Error classifier maps 401/403/429/5xx/network correctly.
- Circuit breaker transitions closed → open → half_open → closed.
- Session refresh lock prevents duplicate refresh.
- Redaction removes secrets.

### 46.2 Provider Adapter Contract Tests

Mỗi provider adapter phải pass cùng một bộ test:

- `listModels` works.
- Non-stream chat works.
- Stream chat works if capability says streaming true.
- Auth error classified correctly.
- Rate limit classified correctly.
- Timeout classified correctly.
- Network error classified correctly.
- Usage normalized correctly.
- Response normalized correctly.
- No secret leaked in errors/logs.

### 46.3 Mock Provider Tests

Nên có `MockProviderAdapter` để test gateway không cần tài khoản thật.

Mock modes:

```text
mock-fast
mock-slow
mock-error-429
mock-error-500
mock-auth-error
mock-timeout
mock-stream
mock-bad-json
```

### 46.4 Integration tests

- `/healthz` returns minimal status.
- `/readyz` requires auth and returns provider status.
- `/metrics` requires admin/private access.
- `/v1/models` returns model registry and routing profiles.
- Fixed model routes correctly.
- Routing profile fallback works.
- 429 marks account cooldown.
- 401/403 refreshes session or disables account.
- Network error retries another account.
- Timeout retries another account.
- Provider circuit breaker opens after repeated failures.
- Streaming forwards SSE chunks.
- Client disconnect aborts upstream.
- OpenAI response normalization works.
- Anthropic response normalization works.
- Admin API rejects non-admin key.
- Audit log records admin action.

### 46.5 Security tests

- Prompt is not logged.
- Completion is not logged.
- Authorization header is not logged.
- Cookie is not logged.
- Provider token is not logged.
- Tool payload content is not logged.
- `.env` is not committed.
- `secrets/*.json` is not committed.
- Example secret files do not contain real token.
- Admin API does not return raw secret.

---

## 47. Security Notes

Dự án này chỉ dùng nội bộ.

Không public gateway/dashboard ra internet nếu chưa có:

- HTTPS/TLS.
- Strong internal API keys.
- Admin auth riêng.
- RBAC.
- Rate limit.
- Quota.
- Concurrency limit.
- IP allowlist.
- CORS allowlist.
- Audit log.
- Secret encryption.
- Secret manager.
- Request body size limit.
- Monitoring/alerting.
- Dependency vulnerability scanning.
- Backup/restore.

Không hardcode token vào source code.

Không commit `.env`.

Không commit `secrets/*.json`.

Không log prompt hoặc source code người dùng.

---

## 48. Graceful Shutdown

Khi nhận `SIGTERM` hoặc `SIGINT`:

- Stop accepting new requests.
- Allow active non-streaming requests to finish within grace period.
- Close active streams after grace period.
- Abort upstream requests nếu cần.
- Release account active request counters.
- Flush logs/metrics.
- Stop health checker.
- Stop request queue worker.

Example:

```ts
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
```

---

## 49. Runtime Limitations

MVP limitations:

- AccountPool in-memory chỉ phù hợp single gateway instance.
- Rate limit in-memory chỉ phù hợp single gateway instance.
- Usage tracking có thể lưu file hoặc memory trong MVP, chưa bền vững.
- Disabled account state do 401/403 sẽ reset sau restart nếu chưa có state backend.
- Không retry/failover sau khi streaming đã bắt đầu.
- Tool/function calling chỉ best effort hoặc phase later.
- Provider behavior có thể thay đổi, cần adapter tách riêng để dễ sửa.

Production recommendations:

```text
Redis:
- rate limit counters
- account cooldown state
- round-robin pointer
- account active request counters
- distributed lock
- request queue

Postgres:
- provider instances
- account metadata
- API keys
- teams
- model mappings
- routing profiles
- usage records
- audit logs
- config revisions

Secret Manager:
- provider credentials
- encryption keys
```

---

## 50. MVP Acceptance Criteria

MVP được coi là hoàn thành khi:

- Chạy được `npm run dev`.
- `/healthz` trả OK không lộ provider/account detail.
- `/readyz` cần auth và trả provider/account readiness.
- `/v1/models` trả model registry và routing profiles public.
- Internal API key auth hoạt động.
- Invalid API key bị reject.
- Rate limit cơ bản hoạt động.
- Request body quá lớn trả 413.
- Có `ProviderAdapterRegistry`.
- Có mock provider adapter để test.
- Có `ModelRegistry` provider-agnostic.
- Có `RoutingProfileRegistry`.
- Có `CapabilityMatcher`.
- Gọi `/v1/chat/completions` với `model=kiro-sonnet` route sang Kiro adapter.
- Gọi `/v1/chat/completions` với `model=windsurf-sonnet` route sang Windsurf adapter.
- Gọi `/v1/chat/completions` với `model=auto` có fallback.
- Có generic AccountPool.
- Có concurrency limit theo account/provider/global.
- Account bị 429 được đưa vào cooldown.
- Account bị 401/403 được refresh session nếu có thể, nếu vẫn lỗi thì disabled.
- Request lỗi có retry account khác.
- Circuit breaker hoạt động ở mức provider instance.
- Response non-streaming trả OpenAI-compatible format.
- Streaming `/v1/chat/completions` hoạt động.
- Client disconnect abort upstream request.
- Có Admin API MVP.
- Có Dashboard MVP với Providers, Accounts, Model Registry, Routing Profiles, API Keys, Usage, Logs.
- Có Docker Compose chạy được gateway/dashboard.
- Không cần chạy `kiro-gateway` hoặc `WindsurfAPI` như service phụ.
- Có `.env.example` và secret example files.
- Không log prompt.
- Không log completion.
- Không log source code.
- Không log raw authorization header.
- Không log provider token/cookie/session.

Anthropic `/v1/messages` có thể nằm ở phase sau nếu team muốn MVP core tập trung OpenAI-compatible trước. Nếu yêu cầu MVP bao gồm Anthropic, phải thêm `/v1/messages` vào acceptance bắt buộc.

---

## 51. AI Coding Execution Rules

AI coding agents must implement this project phase by phase.

For Phase 1, use:

- Node.js 20+.
- TypeScript.
- Fastify.
- Vitest.
- pino.
- zod.
- npm.

Source code, config files and documentation must be UTF-8.

Code identifiers, comments and logs should use English. User-facing documentation may use Vietnamese.

Phase 1 must only implement:

- Gateway project skeleton.
- Config loading.
- Auth middleware.
- Request ID middleware.
- Redacted logger middleware.
- Body size limit.
- Error handler.
- `GET /healthz`.
- `GET /v1/models` with hardcoded models.
- Basic test setup.

Phase 1 must not implement:

- Provider adapters.
- Account pool.
- Kiro or Windsurf clients.
- Streaming.
- Dashboard.
- Admin API.
- Metrics.
- Docker.
- Runtime dependency on reference repositories.

Initial provider implementation scope:

- Kiro and Windsurf are the first real provider adapters.
- Phase 2 may introduce provider-core interfaces, registry and mock provider only.
- Kiro adapter implementation starts in Phase 6.
- Windsurf adapter implementation starts in Phase 7.
- OpenAI, Anthropic, OpenRouter, Gemini, Azure OpenAI, Bedrock, local LLM and custom HTTP providers are later-phase providers unless explicitly pulled forward.
- Even while only Kiro and Windsurf are implemented, the core architecture must remain multi-provider and provider-agnostic.

Use this monorepo direction:

```text
apps/gateway       Backend gateway service.
apps/dashboard     Dashboard app, added in later phases.
packages/shared    Shared types/schemas, added only when needed.
```

Phase 1 file structure:

```text
apps/
  gateway/
    src/
      server.ts
      app.ts
      config.ts
      routes/
        healthz.ts
        models.ts
      middleware/
        auth.ts
        requestId.ts
        logger.ts
        errorHandler.ts
      utils/
        hash.ts
        redaction.ts
      test/
        healthz.test.ts
        models.test.ts
        auth.test.ts
        bodyLimit.test.ts
```

Phase 1 response contracts:

```json
{
  "status": "ok"
}
```

`GET /v1/models`:

```json
{
  "object": "list",
  "data": [
    {
      "id": "kiro-sonnet",
      "object": "model",
      "owned_by": "internal-ai-gateway"
    },
    {
      "id": "windsurf-sonnet",
      "object": "model",
      "owned_by": "internal-ai-gateway"
    },
    {
      "id": "auto",
      "object": "model",
      "owned_by": "internal-ai-gateway"
    },
    {
      "id": "coding",
      "object": "model",
      "owned_by": "internal-ai-gateway"
    }
  ]
}
```

Common error format:

```json
{
  "error": {
    "type": "authentication_error",
    "message": "Missing or invalid API key",
    "code": "invalid_api_key"
  }
}
```

Phase 1 auth behavior:

- `GET /healthz` does not require auth.
- `GET /v1/models` requires `Authorization: Bearer <key>`.
- Valid internal keys are loaded from `INTERNAL_API_KEYS`.
- Admin keys from `ADMIN_API_KEYS` must not grant normal API access unless a later phase explicitly changes this.
- `Authorization`, cookies, provider tokens and session values must never be logged raw.

Phase 1 `.env.example`:

```env
NODE_ENV=development
PORT=8080
HOST=0.0.0.0
INTERNAL_API_KEYS=dev-key-1,dev-key-2
ADMIN_API_KEYS=admin-key-1
REQUEST_BODY_LIMIT=1mb
LOG_LEVEL=info
```

Phase 1 is accepted only when:

- `npm install` succeeds.
- `npm run typecheck` passes.
- `npm test` passes.
- `npm run dev` starts the gateway.
- `GET /healthz` returns `200` without auth.
- `GET /v1/models` returns `401` without auth.
- `GET /v1/models` returns `401` with invalid internal key.
- `GET /v1/models` returns `200` with valid internal key.
- Oversized request body returns `413`.
- Tests prove `Authorization` is redacted from logs.

---

## 52. Important Implementation Instructions

Do not generate one giant file.

Implement step by step.

Historical note: the instruction below was for the first implementation pass.
The repository has already progressed beyond Phase 1. For current work, follow
`PLAN.md` and `docs/AI_AGENT_HANDOFF.md`.

Original Phase 1 starting scope:

1. Project skeleton.
2. Config.
3. Auth middleware.
4. Redacted logger middleware.
5. Request ID middleware.
6. Body size limit.
7. Error handler.
8. `/healthz`.
9. `/v1/models` hardcoded.
10. Basic test setup.

After Phase 1 works, continue Phase 2.

Do not attempt to implement full providers, account pools, streaming, dashboard, admin API, metrics and config rollback in the first pass.

Correct long-term architecture:

```text
Gateway Core
  ↓
ModelResolver / RoutingProfileResolver
  ↓
ProviderRouter
  ↓
ProviderAdapterRegistry
  ↓
AIProviderAdapter
  ↓
ProviderInstance
  ↓
AccountPool
  ↓
SessionManager
  ↓
Provider Client
```

Reference repos are only references.

Do not use them as runtime dependencies.

Do not run them as sidecar services in MVP.
