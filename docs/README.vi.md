<p align="center">
  <img src="images/image.png" alt="X-Router" width="100%" />
</p>

<h1 align="center">X-Router</h1>

<p align="center">
  <strong>Một endpoint cho mọi nhà cung cấp AI.</strong><br/>
  AI gateway tự host với pool nhiều tài khoản, auto-fallback, hạn mức chi tiêu,
  cache phản hồi, và dashboard quản trị đầy đủ.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@daokimluc/x-router"><img src="https://img.shields.io/npm/v/@daokimluc/x-router.svg?label=npm" alt="npm" /></a>
  <a href="../LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License" /></a>
  <img src="https://img.shields.io/badge/node-%3E%3D22-brightgreen.svg" alt="Node >=22" />
</p>

<p align="center">
  Kết nối <strong>Claude Code, Cursor, Cline, Codex, Kiro, Windsurf, Aider</strong> và mọi
  công cụ tương thích OpenAI hoặc Anthropic tới <strong>50+ nhà cung cấp</strong> qua một URL local duy nhất.
</p>

<p align="center">
  <a href="../README.md">English</a> · <strong>Tiếng Việt</strong>
</p>

---

## Tại sao chọn X-Router?

Dùng nhiều công cụ AI qua nhiều provider rất rối: mỗi công cụ đòi một API key
riêng, subscription dính rate limit, tài khoản nằm không, và bạn chẳng biết tiền
chảy đi đâu. X-Router đặt một proxy thông minh duy nhất đứng trước tất cả.

- **Một endpoint, mọi công cụ** — trỏ Cursor, Cline, Claude Code, Codex về cùng một URL.
- **Pool nhiều tài khoản** — round-robin qua N tài khoản mỗi provider để nhân throughput.
- **Auto-fallback** — provider lỗi hoặc bị rate limit? Ứng viên kế tiếp được thử ngay lập tức.
- **Kiểm soát chi tiêu** — hạn mức USD cứng theo ngày/tháng cho từng key và team, chặn trước khi gọi.
- **Tiết kiệm token** — Token Saver nén tool output trước khi gửi tới provider.
- **Cache phản hồi** — request trùng trả về tức thì, chi phí token bằng 0 (tuỳ chọn bật).
- **Giám sát đầy đủ** — latency p50/p95/p99, biểu đồ usage, request log, Prometheus `/metrics`.
- **Dashboard web** — quản lý provider, account, key, route, team, pricing ngay trên trình duyệt.

---

## Bắt đầu nhanh

### Foza — control plane mở cho nguồn cung AI

> **Public beta · Đang phát triển · Đã có một nhóm nhỏ người dùng nội bộ sử dụng**

X-Router không chỉ là một proxy. Đây là nền tảng mã nguồn mở giúp việc sử dụng AI giữa
nhiều provider trở nên ổn định, linh hoạt và có thể kiểm soát. Repository này gồm hai
lớp được tách biệt rõ ràng:

| Lớp | Trách nhiệm |
| --- | --- |
| **X-Router core** | Gateway tương thích OpenAI/Anthropic, provider account, routing, pooling, fallback, quota, spend control, usage, catalog, provisioning và settlement API. |
| **Foza** | Marketplace và control plane cho buyer, provider và maintainer: identity, API key, plan, wallet, token pack, seller workflow, admin operation, signed webhook và money mirror cục bộ. |

#### Bài toán

Developer AI ngày càng phụ thuộc vào nhiều provider, model family, coding tool,
subscription và API key. Với maintainer open source, bài toán khó không chỉ là chuyển
tiếp request mà là giữ toàn bộ hệ thống nhất quán:

- provider gặp sự cố không được làm ứng dụng dừng theo;
- team cần kiểm soát chi phí trước khi gọi upstream;
- buyer cần usage, plan, wallet và prepaid capacity minh bạch;
- provider cần cách publish nguồn cung an toàn, không truy cập được dữ liệu seller khác;
- money event phải idempotent, audit được và có thể khôi phục sau khi lỡ webhook; và
- maintainer cần một hệ thống nhỏ, self-host được thay vì một nền tảng đóng, khó kiểm tra.

#### Giải pháp

X-Router đặt một gateway thông minh, self-hosted trước nhiều provider. Foza bổ sung lớp
sản phẩm và vận hành quanh gateway. Hai phần tạo thành luồng mở từ **nguồn cung model →
truy cập an toàn → usage → billing → settlement**, giúp tool, provider và maintainer
không phải tự xây lại cùng một hạ tầng.

#### Những gì đang hoạt động

**Marketplace và trải nghiệm buyer**

- Khi bật live integration, marketplace đọc listing, pricing, markup và metrics theo
  listing từ X-Router.
- Buyer có thể tạo, tắt, bật lại, thu hồi và xoay vòng API key; kết nối model vào key;
  đăng ký plan từ wallet; và xem usage theo key/model.
- Buyer có thể tạo top-up VietQR/SePay và mua gói 1M, 5M hoặc 10M token. Server tự tính
  lại giá từ listing và markup live, không tin giá do client gửi.

**Luồng provider, admin và money**

- Provider có thể đăng ký và tạo listing model kèm provider-account reference; mutation
  listing được giới hạn theo owner và kiểm tra lại ownership ở server.
- Admin/moderator có server-side gate cho seller moderation, catalog, markup, plan, role,
  webhook configuration và platform-owned listing.
- Foza lưu mapping identity, payment intent, webhook event, billing, payable, payout
  idempotency và reconciliation checkpoint trong SQLite.
- Ledger dùng micro-USD nguyên; signed X-Router webhook và reconciliation định kỳ là
  backstop cho usage, wallet, supply và reversal event.

#### Kiến trúc

```mermaid
flowchart LR
    U["Buyer · Provider · Maintainer"] --> F["Foza Web App\nNext.js + Auth.js"]
    F --> A["Foza adapter chỉ chạy server\nHTTP + typed contract"]
    A <--> X["X-Router core\nGateway · catalog · provisioning · settlement"]
    X --> P["Provider account\nvà nguồn cung model"]
    X --> W["X-Router webhook có chữ ký"]
    S["SePay payment webhook"] --> F
    W --> D["Foza SQLite\nidentity · payment · ledger · dedupe"]
    D --> R["Reconciliation backstop"]
    R --> X
```

Ranh giới này là có chủ đích: X-Router sở hữu gateway, catalog, provisioning và
settlement; Foza sở hữu web app, identity, console buyer/provider/admin, payment
coordination, webhook ingestion và SQLite mirror ledger. Foza gọi core qua HTTP bằng các
path server-only `/provision/*`, `/admin/v1/*` và `/v1/*`; Foza không chứa gateway runtime
thứ hai.

#### Vì sao dự án có ý nghĩa với open source

Dự án lấp khoảng trống giữa một gateway cấp thấp và một nền tảng mở có thể sử dụng thật.
Nó biến sự đa dạng của provider thành một public service có thể kết hợp, trong khi
deployment, pricing, routing và operational state vẫn có thể được maintainer kiểm tra.
Mục tiêu không phải che giấu độ phức tạp sau một hosted API, mà làm cho nó reviewable và
reusable bởi cộng đồng.

#### Trạng thái trung thực

Foza đang ở public beta và được phát triển tích cực, với một nhóm nhỏ người dùng nội bộ.
Implementation là thật và đã tích hợp, nhưng chưa được trình bày như một marketplace đã
hoàn thiện ở production scale:

- search/filter hiện mới là UI;
- provider earnings detail và một số admin surface cần hoàn thiện;
- seller approval synchronization và một số payment crash-state reconciliation còn nằm
  trong roadmap; và
- fixture, marketing card, capacity target và fallback data không phải production telemetry.

#### Ranh giới bảo mật

- Secret provision, admin, internal, webhook, payment và Auth.js chỉ được dùng ở server.
- Browser không import X-Router adapter và không nhận admin/provision secret.
- X-Router webhook dùng HMAC-SHA256 trên raw body và dedupe event bền vững.
- Callback SePay dùng authenticated header và constant-time comparison.
- Key, seller và listing ID do user gửi lên được kiểm tra ownership trước mutation.

#### Chạy toàn bộ stack

Khởi động X-Router trước, sau đó chạy Foza ở terminal thứ hai:

```bash
# Terminal 1 — X-Router core
npm install
npm run build:all
ADMIN_API_KEYS=admin npm start

# Terminal 2 — Foza control plane
cd apps/foza
npm install
copy .env.example .env.local   # PowerShell / Windows
npm run dev
```

Để phát triển UI local, giữ `MARKETPLACE_ENABLED=false` và dùng typed mock fixture.
Để live integration, cấu hình các giá trị server-only sau trong `apps/foza/.env.local`:

```dotenv
MARKETPLACE_ENABLED=true
XROUTER_URL=http://localhost:3100
XROUTER_PROVISION_KEY=your-provision-key
XROUTER_ADMIN_KEY=your-admin-key
XROUTER_INTERNAL_KEY=your-internal-key
XROUTER_WEBHOOK_SECRET=your-webhook-secret
```

Không commit `.env.local`, credential thật, payment secret hoặc webhook secret.

Xem [README Foza tiếng Việt](../apps/foza/README.vi.md) để đọc implementation status,
limitations, script, hướng dẫn contribution và các path quan trọng.

### npm (nhanh nhất)

```bash
npm install -g @daokimluc/x-router
x-router
```

Xong. CLI sẽ:

1. Tạo admin key mặc định (`admin`) lần chạy đầu tiên.
2. Khởi động gateway tại `http://localhost:3100`.
3. Mở dashboard và hiện menu tương tác.

Đăng nhập dashboard bằng admin key, sau đó thêm provider và tạo client API key
trong tab **Endpoint & Keys**.

### Docker

```bash
docker run -p 3100:3100 \
  -e ADMIN_API_KEYS="khoa-admin-cua-ban" \
  ghcr.io/daokimluc/x-router:latest
```

Mở `http://localhost:3100/` và đăng nhập bằng admin key.

### Từ mã nguồn

```bash
git clone https://github.com/daokimluc/X-Router.git
cd X-Router
npm install
npm run build:all
ADMIN_API_KEYS=admin npm start
```


---

## Cách hoạt động

```
  Công cụ của bạn (Cursor · Cline · Claude Code · Codex · Aider · mọi SDK)
        │
        │  http://localhost:3100/v1   (tương thích OpenAI)
        │  http://localhost:3100      (tương thích Anthropic)
        ▼
  ┌───────────────────────────────────────────────────────────┐
  │                       X-Router                            │
  │                                                           │
  │   Auth ─▶ Kiểm tra ─▶ Tra ─▶ Resolve ─▶ Chọn tài khoản    │
  │   key     spend cap   cache   model      (pool)           │
  │                                            │              │
  │   Token Saver · Theo dõi latency · Ghi usage              │
  └────────────────────────────────────────────┼─────────────┘
                                                ▼
        ┌────────────────────┬────────────────────┬──────────────┐
        ▼                    ▼                    ▼              ▼
   OAuth sub           API giá rẻ            Free tier      Cloud
   (Claude Code,       (DeepSeek, GLM,       (Kiro,         (Vertex,
    Codex, Copilot)     MiniMax, Groq)        OpenCode)      Bedrock)
```

Một request đi vào, được xác thực bằng API key, kiểm tra hạn mức chi tiêu, tra
trong cache phản hồi, rồi resolve về một **channel** (provider instance phục vụ
một public model). Account pool chọn tài khoản ít bận nhất, request được chuyển
tiếp, và phản hồi stream trở lại — đồng thời ghi lại usage, latency, chi phí.
Nếu một channel lỗi hoặc bị rate limit, ứng viên kế tiếp cho cùng model được thử
tự động.

---

## Tính năng

### Định tuyến & độ tin cậy

- **Multi-channel routing** — cùng một tên public model (vd `claude-opus-4-7`) có thể được phục vụ bởi nhiều channel. Resolver gom tất cả, sắp theo priority, và fallback tự động.
- **Biến thể tên model** — client gửi `claude-opus-4-7`, `claude-opus-4.7`, `claude-opus-4-7-20250101`, hay tên kiểu Bedrock/Vertex đều được chuẩn hoá và format lại theo provider.
- **Account pooling** — chiến lược round-robin, least-busy, weighted, hoặc priority qua N tài khoản mỗi channel.
- **Circuit breaker** — tự tắt channel sau N lần lỗi liên tiếp, có probe half-open để phát hiện phục hồi.
- **Tự refresh auth** — credential OAuth/refresh-token được làm mới khi gặp `401` rồi retry, sau đó ghi lại để request sau dùng token mới.
- **Proxy theo tài khoản** — gắn từng tài khoản với proxy pool HTTP hoặc Vercel-relay.

### Kiểm soát chi phí

- **Hạn mức chi tiêu** — giới hạn USD cứng theo ngày và tháng cho từng key và team, chặn *trước khi* gọi provider (hold-and-settle). Vượt sẽ trả `429 spend_limit_exceeded`.
- **Token Saver** — nén khối `tool_result` (và tuỳ chọn cả output LLM) trước khi chuyển tiếp, cắt 20–40% token cho vòng lặp agent nhiều tool.
- **Cache phản hồi** — tuỳ chọn bật theo request (`cache_control: { mode: "use" }`). Request trùng (model + messages + tham số) trả về cached, chi phí 0. LRU + TTL, giới hạn theo số entry và dung lượng.
- **Balance & quota theo key** — tuỳ chọn số dư credit, request/phút, request/ngày, token/ngày.

### Giám sát

- **Biểu đồ usage** — các view Trend / Proportion / Top theo thời gian, đổi giữa chi phí/token/request.
- **Theo dõi latency** — p50/p95/p99 theo (channel × model × account) trong cửa sổ trượt 5 phút.
- **Prometheus exporter** — `GET /metrics` với histogram request và latency cho Grafana/Datadog.
- **Request log & audit log** — luồng metadata của request cộng với log đầy đủ hoạt động control-plane.

### Quản lý

- **Dashboard web** — provider, account, channel, model, route, team, pricing, key — tất cả trên trình duyệt.
- **Wizard tạo nhanh channel** — tạo provider instance + N account + M model mapping + override trong một form.
- **Override theo channel** — `paramOverride` (ép tham số body), `headerOverride` (chèn header), `statusCodeMapping` (retry/disable/passthrough), `maxInputTokens`, `systemPromptOverride`.
- **Teams** — gom key, chia sẻ quota, giới hạn model/provider được phép.
- **Chính sách API key** — hết hạn, IP allowlist, model whitelist, group routing, cache mode, spend cap.


---

## Nhà cung cấp được hỗ trợ

Hơn 50 loại provider theo nhóm. Một số tiêu biểu:

| Nhóm | Provider |
|---|---|
| **OAuth subscription** | Claude Code, Codex, GitHub Copilot, Cursor, Gemini CLI, Qwen, iFlow |
| **Free tier** | Kiro, OpenCode Free |
| **API giá rẻ** | DeepSeek, GLM (Zhipu), MiniMax, Groq, Cerebras, Together, Fireworks, OpenRouter, SiliconFlow, Nebius, Hyperbolic, Chutes, Mistral, Cohere, Moonshot/Kimi, xAI/Grok, và nhiều hơn nữa |
| **API premium** | OpenAI, Anthropic, Gemini, Alibaba (Qwen), ByteDance/Volcengine, Perplexity |
| **Cloud platform** | Vertex AI, Azure OpenAI, Cloudflare AI |
| **Tuỳ chỉnh** | Mọi endpoint tương thích OpenAI (`custom_openai`) hoặc không cần auth |

Mỗi loại provider đi kèm cấu hình mặc định hợp lý (base URL, path, auth method).
Thêm tài khoản vào provider, và nó trở thành channel có thể định tuyến.

---

## Cấu hình Client

X-Router nói hai protocol trên cùng một port:

| Công cụ | Base URL | Auth |
|---|---|---|
| Tương thích OpenAI (Cline, Continue, LiteLLM, Aider, LangChain) | `http://localhost:3100/v1` | `Authorization: Bearer <client-key>` |
| Tương thích Anthropic (Claude Code, `@anthropic-ai/sdk`) | `http://localhost:3100` | `Authorization: Bearer <client-key>` hoặc `x-api-key` |

Ví dụ (OpenAI SDK):

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:3100/v1",
    api_key="client-key-cua-ban",   # tạo trong dashboard - Endpoint & Keys
)

resp = client.chat.completions.create(
    model="claude-opus-4-7",
    messages=[{"role": "user", "content": "Xin chào!"}],
)
print(resp.choices[0].message.content)
```

Bật cache phản hồi cho một request:

```jsonc
{
  "model": "claude-opus-4-7",
  "messages": [ /* ... */ ],
  "cache_control": { "mode": "use" }   // "skip" (mặc định) | "use" | "refresh"
}
```

---

## Biến môi trường

X-Router được cấu hình lúc chạy qua dashboard. Biến môi trường duy nhất bạn
thường cần đặt là admin key:

| Biến | Mặc định | Mục đích |
|---|---|---|
| `ADMIN_API_KEYS` | `admin` (dev) | Các key (phân tách bằng dấu phẩy) để đăng nhập dashboard và gọi `/admin/*`. Bắt buộc trong production. |
| `PORT` | `3100` | Port lắng nghe. |
| `HOST` | `0.0.0.0` | Host bind. |
| `DATA_FILE` | `data/gateway-state.json` | Nơi lưu state runtime (provider, key, usage). |
| `LOG_LEVEL` | `info` | `fatal`/`error`/`warn`/`info`/`debug`/`trace`/`silent`. |
| `METRICS_PUBLIC` | `false` | Khi `true`, `/metrics` truy cập được không cần auth. |

> Client API key **không** đặt qua biến môi trường. Đăng nhập dashboard bằng
> admin key và tạo chúng trong **Endpoint & Keys** — ở đó bạn có rate limit theo
> key, model whitelist, IP allowlist, hết hạn, spend cap, và cache mode.

### CLI

```bash
x-router --port 3100          # khởi động với menu tương tác
x-router --no-menu            # chế độ foreground (Docker/systemd), log ra stdout
x-router --print-keys         # in admin key rồi thoát
x-router --help
```

Cấu hình và log nằm ở `~/.x-router/` (`config.json`, `server.log`).

---

## Admin API

Mọi endpoint admin cần `Authorization: Bearer <admin-key>` và nằm dưới
`/admin/v1`. Tiêu biểu:

| Khu vực | Endpoint |
|---|---|
| Providers | `GET/POST /admin/v1/provider-instances`, `/channels/quick-create`, `/provider-instances/:id/test-model` |
| Accounts | `GET/POST /admin/v1/accounts`, `/accounts/:id/{enable,disable,test,reset-suspension}` |
| Models | `GET/POST/PATCH/DELETE /admin/v1/model-mappings`, `/sync-models/bulk` |
| API keys | `GET/POST/PATCH/DELETE /admin/v1/api-keys`, `/api-keys/:id/{reveal,enable,disable}` |
| Teams | `GET/POST/PATCH/DELETE /admin/v1/teams` |
| Spend | `GET /admin/v1/spend/{key,team}/:id` |
| Usage | `GET /admin/v1/usage`, `/usage/aggregate` |
| Metrics | `GET /admin/v1/metrics/latency`, `GET /metrics` (Prometheus) |
| Cache | `GET /admin/v1/cache/stats`, `DELETE /admin/v1/cache[/:prefix]` |
| Version | `GET /admin/v1/version` (hiện tại + mới nhất + kiểm tra cập nhật) |

---

## Phát triển

```bash
# Gateway (Fastify + TypeScript) - hot reload
cd apps/gateway && npm install && npm run dev

# Dashboard (React + Vite)
cd apps/dashboard && npm install && npm run dev

# Chạy bộ test (443 test)
cd apps/gateway && npx vitest run
```

Build mọi thứ để phân phối:

```bash
npm run build:all   # build dashboard-dist/ + dist/
```

---

## Công nghệ

- **Backend** — Node.js 22+, Fastify 5, TypeScript, Zod, undici, pino
- **Frontend** — React 19, Vite 7, Recharts, @xyflow/react, lucide-react
- **Lưu trữ** — file JSON state (không cần DB ngoài)

---

## Lời cảm ơn

Trong quá trình phát triển, X-Router đã tham khảo ý tưởng từ một số AI gateway
mã nguồn mở rất xuất sắc như [9Router](https://github.com/decolua/9router) và
[New API](https://github.com/QuantumNous/new-api). Xin chân thành cảm ơn các tác
giả và cộng đồng của họ.

X-Router được xây dựng trên codebase độc lập của riêng mình (backend Fastify +
TypeScript, dashboard React) và không sử dụng lại mã nguồn từ các dự án này.

---

## Giấy phép

MIT - Luc DK. Xem [LICENSE](../LICENSE).
