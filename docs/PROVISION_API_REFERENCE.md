# Provision API Reference (website ↔ x-router)

> Đặc tả đầy đủ bề mặt **`/provision/*`** + **webhook** — đây là TOÀN BỘ những gì
> website cần để đấu nối. Website KHÔNG dùng `/admin/*` (đó là dashboard operator).
> Trích trực tiếp từ code (`marketplace/routes/provision.ts`), khớp 1-1 với hành vi
> thật.
>
> - Base URL: `http(s)://<x-router-host>:<port>` (mặc định cổng 3100)
> - Auth: **mọi** request `/provision/*` cần header
>   `Authorization: Bearer <PROVISION_KEY>`. Thiếu/sai → `401 invalid_provision_api_key`.
> - Tiền: luôn là **USD** (number). Nội bộ lưu micro-USD, API phơi ra USD.
> - Lỗi: `{ "error": { "message": string, "code": string } }` + HTTP 400/401/404/409/429.
> - Content-Type: `application/json`.

## Bảng tổng hợp endpoint

| Method | Path | Rate-limited¹ | Mục đích |
|---|---|---|---|
| POST | `/provision/key` | ✅ | Tạo client key cho buyer |
| POST | `/provision/key/:id/disable` | | Tạm dừng key |
| POST | `/provision/key/:id/enable` | | Bật lại key |
| PATCH | `/provision/key/:id` | | Đổi enabled / expiresAt |
| DELETE | `/provision/key/:id` | | Thu hồi (soft) key |
| POST | `/provision/key/:id/rotate` | ✅ | Đổi secret (giữ id/gói/ví) |
| GET | `/provision/keys` | | Liệt kê key đã cấp |
| POST | `/provision/grant` | ✅ | Gán/đổi gói cho key |
| POST | `/provision/wallet/topup` | ✅ | Nạp USD vào ví |
| GET | `/provision/wallet/:keyId` | | Đọc số dư ví |
| POST | `/provision/seller` | | Đăng ký seller |
| POST | `/provision/seller/:id/approve` | | Duyệt seller |
| POST | `/provision/seller/:id/suspend` | | Đình chỉ seller |
| GET | `/provision/sellers` | | Liệt kê seller |
| POST | `/provision/listing` | | Tạo listing (supply) |
| PATCH | `/provision/listing/:id` | | Bật/tắt listing |
| DELETE | `/provision/listing/:id` | | Xoá listing |
| GET | `/provision/listings` | | Liệt kê listing |
| POST | `/provision/earnings/:sellerId/mark-paid` | ✅ | Báo đã trả tiền seller |
| GET | `/provision/earnings/:sellerId` | | Doanh thu 1 seller |
| GET | `/provision/earnings/platform` | | Platform margin |
| PUT | `/provision/markup` | | Đặt markup |
| GET | `/provision/markup` | | Đọc markup |
| GET | `/provision/plans` | | Liệt kê gói (cho UI) |
| GET | `/provision/usage` | | Đối soát usage (token/cost) |
| GET | `/provision/settlements` | | Đối soát settlement per-record (tiền chính xác) |
| GET | `/provision/webhook` | | Đọc cấu hình webhook |
| PUT | `/provision/webhook` | | Đặt cấu hình webhook |

¹ Route đánh dấu ✅ bị giới hạn `PROVISION_RATE_LIMIT_PER_MINUTE`/phút/key (mặc
định 120; 0 = tắt). Vượt → `429 provision_rate_limit_exceeded` + header
`retry-after: 60`. Các route đọc không bị giới hạn.

<!-- SEC_KEY -->

---

## 1. Buyer key

### POST /provision/key  — tạo client key
Body:
```json
{ "label": "user_42", "planId": "plan_claude" }   // cả hai optional
```
- `label` → lưu thành `owner` của key (dùng để lọc ở `GET /provision/keys?owner=`).
- `planId` nếu truyền phải tồn tại, không thì `400 validation_error`.

200:
```json
{ "id": "internal_key_3", "key": "igw_xxx", "planId": "plan_claude" }
```
> `key` (plaintext) **chỉ trả về một lần** — đưa cho buyer, x-router chỉ giữ hash.
> `id` là `keyId` website lưu để gọi các lệnh sau.

### POST /provision/key/:id/disable  | /enable
Body: rỗng. 200: `{ "id": "internal_key_3", "enabled": false }` (disable) hoặc
`true` (enable). Key không tồn tại → `404 not_found`.

### PATCH /provision/key/:id  — đổi enabled / hạn dùng
Body (ít nhất một trong hai):
```json
{ "enabled": true, "expiresAt": "2026-12-31T23:59:59Z" }   // expiresAt=null xoá hạn
```
- Thiếu cả hai → `400 validation_error`. `expiresAt` phải là ISO-8601.
- Đặt `expiresAt` quá khứ → key bị từ chối với lý do hết hạn.

200: `{ "id": "internal_key_3", "enabled": true, "expiresAt": "2026-12-31T23:59:59.000Z" }`

### DELETE /provision/key/:id  — thu hồi (soft)
Body: rỗng. Thu hồi = disable (giữ lại để đối soát settlement-log).
200: `{ "id": "internal_key_3", "revoked": true }`. Không tồn tại → `404`.

### GET /provision/keys?owner=user_42  — liệt kê key đã cấp
`owner` optional (lọc theo label đã đặt lúc tạo). 200:
```json
{ "keys": [ { "id": "internal_key_3", "owner": "user_42",
              "enabled": true, "expiresAt": null, "planId": "plan_claude",
              "walletUsd": 12.5, "provisioned": true } ] }
```
> `walletUsd` + `provisioned` trả kèm (không cần N+1 `GET /provision/wallet/:id`).
> `provisioned:false` → key chưa từng mở ví (`walletUsd:0`). Key đã revoke vẫn xuất
> hiện ở đây với `enabled:false` — website tự lọc nếu muốn ẩn.

### POST /provision/key/:id/rotate  — đổi secret tại chỗ
Body: rỗng. Cấp secret mới, **giữ nguyên** id / gói / ví / mọi cấu hình; secret cũ
ngừng hoạt động ngay. Dùng khi buyer nghi key bị lộ.
200 (plaintext mới trả về **một lần**):
```json
{ "id": "internal_key_3", "key": "igw_yyy", "planId": "plan_claude" }
```
Không tồn tại → `404 not_found`.

### POST /provision/grant  — gán/đổi gói (idempotent)
Body:
```json
{ "keyId": "internal_key_3", "planId": "plan_pro",
  "overageEnabled": true, "paygDailyLimitUsd": 5 }     // 2 trường cuối optional
```
- `planId` phải tồn tại (`400`); `keyId` phải tồn tại (`404`).
- Gán lại đúng gói hiện tại + không đổi gì khác → trả thêm `"idempotent": true`.

200:
```json
{ "id": "internal_key_3", "planId": "plan_pro",
  "overageEnabled": true, "paygDailyLimitUsd": 5 }
```

<!-- SEC_WALLET -->

---

## 2. Wallet (ví USD)

### POST /provision/wallet/topup  — nạp tiền (sau khi website xác nhận VND/QR)
Body:
```json
{ "keyId": "internal_key_3", "usd": 7.5 }
```
- `usd` là field chuẩn (> 0). `amountUsd` được chấp nhận như **alias cũ** (deprecated).
- Thiếu cả hai → `400 validation_error`.

200: `{ "keyId": "internal_key_3", "walletUsd": 12.5 }`  (số dư sau khi nạp)

### GET /provision/wallet/:keyId  — đọc số dư
200: `{ "keyId": "internal_key_3", "walletUsd": 12.5, "provisioned": true }`
- `provisioned: false` + `walletUsd: 0` nghĩa là chưa từng mở ví cho key này.

<!-- SEC_SELLER -->

---

## 3. Seller + Listing (nguồn cung)

### POST /provision/seller  — đăng ký seller (→ pending)
Body:
```json
{ "displayName": "hoang", "payoutRef": "bank_acc_xyz", "commissionPct": 0.08,
  "externalRef": "user_42" }
```
- `payoutRef`, `commissionPct` (0..1), `externalRef` optional.
- `externalRef`: định danh tự do website sở hữu (vd userId). CHỈ là tiện ích
  lọc/đối soát — KHÔNG phân quyền (website vẫn tự scope sellerId). Đừng nhét userId
  vào `payoutRef`; dùng `externalRef`.

200:
```json
{ "seller": { "id": "seller_hoang_xxx", "displayName": "hoang",
              "status": "pending", "payoutRef": "bank_acc_xyz",
              "externalRef": "user_42",
              "commissionPct": 0.08, "createdAt": "2026-05-30T..." } }
```

### POST /provision/seller/:id/approve | /suspend
Body: rỗng. 200: `{ "seller": { ...status: "approved" | "suspended" } }`.
Không tồn tại → `404`. (Seller phải `approved` thì listing mới định tuyến được.)

### GET /provision/sellers?status=pending&externalRef=user_42  — liệt kê
`status` (`pending`|`approved`|`suspended`) + `externalRef` đều optional (lọc).
200: `{ "sellers": [ { id, displayName, status, payoutRef?, externalRef?, commissionPct?, createdAt } ] }`

### POST /provision/listing  — tạo listing (seller bán model ở giá vốn)
Body:
```json
{ "sellerId": "seller_hoang_xxx", "baseModel": "gpt-5.5",
  "costPrice": { "inputPerM": 2.4, "outputPerM": 7.0, "cachedInputPerM": 1.2 },
  "providerInstanceId": "openai_1", "providerAccountId": "acc_1" }
```
- `baseModel` PHẢI là canonical model (nếu không → `400 listing_rejected`). Seller
  phải `approved`. `cachedInputPerM` optional.
- Đăng ký đồng thời tên **direct** `<seller>/<baseModel>` và **pooled** `<baseModel>`.

200:
```json
{ "listing": { "id": "listing_xxx", "sellerId": "seller_hoang_xxx",
   "baseModel": "gpt-5.5", "namespacedModel": "hoang/gpt-5.5",
   "costPrice": { "inputPerM": 2.4, "outputPerM": 7.0, "cachedInputPerM": 1.2 },
   "providerInstanceId": "openai_1", "providerAccountId": "acc_1",
   "enabled": true, "createdAt": "..." } }
```

### PATCH /provision/listing/:id  — bật/tắt
Body: `{ "enabled": false }`. 200: `{ "listing": {...} }`. Không tồn tại → `404`.
> Đổi giá (re-price) là thao tác **admin** (`PATCH /admin/v1/listings/:id` với
> `costPrice`), không có trên provision.

### DELETE /provision/listing/:id
200: `{ "deleted": "listing_xxx" }`. Không tồn tại → `404`.

<!-- SEC_EARNINGS -->

---

## 4. Earnings & payout

### POST /provision/earnings/:sellerId/mark-paid  — báo đã trả tiền seller
Body:
```json
{ "usd": 5, "payoutRef": "wire_abc" }
```
- `usd` chuẩn (> 0); `amountUsd` alias cũ. `payoutRef` optional, được **lưu** trên
  payout record (đối soát).

200 (snapshot sau khi giảm `unpaid`):
```json
{ "sellerId": "seller_hoang_xxx", "day": 3.2, "month": 40.5,
  "lifetime": 120.0, "unpaid": 15.0 }
```

### GET /provision/earnings/:sellerId  — doanh thu 1 seller
200: cùng shape snapshot ở trên (`day`/`month`/`lifetime`/`unpaid`, đơn vị USD).

### GET /provision/earnings/platform  — biên nền tảng tích luỹ
200: `{ "platformMarginUsd": 87.65 }`

<!-- SEC_CATALOG -->

---

## 5. Markup, Plans, Usage

### PUT /provision/markup  — đặt markup (giá bán = giá vốn × (1 + markup))
Body (cả hai optional, >= 0):
```json
{ "defaultMarkup": 0.15, "perModel": { "gpt-5.5": 0.25 } }
```
200: `{ "defaultMarkup": 0.15, "perModel": { "gpt-5.5": 0.25 } }`
> Xoá một override (`perModel` = null) chỉ làm được qua **admin** `PUT /admin/v1/markup`.

### GET /provision/markup
200: `{ "defaultMarkup": 0.15, "perModel": { ... } }`

### GET /provision/plans  — liệt kê gói (render UI cho buyer chọn)
200:
```json
{ "plans": [ { "id": "plan_claude", "name": "Claude", "priceUsd": 10,
   "modelGroups": ["claude"],
   "buckets": { "hourUsd": 0.5, "dayUsd": 3, "monthUsd": 10 },
   "overageEnabled": false, "paygDailyLimitUsd": null } ] }
```

### GET /provision/usage  — đối soát (bù cho webhook lỡ)
Query (tất cả optional): `since` (ISO-8601), `keyId`, `limit` (1..1000, mặc định 100).
- `keyId` truyền nhưng không tồn tại → `{ "data": [], "total": 0 }` (không lộ usage key khác).

200:
```json
{ "total": 1240,
  "data": [ { "id", "requestId", "ts": 1730000000000, "apiKeyHash", "model",
    "providerType", "protocol", "promptTokens", "completionTokens",
    "totalTokens", "cachedTokens", "estimatedCost" } ] }
```
> Đây là reconciliation-grade (token/model/cost/thời gian) đọc từ **usage log bền
> vững (SQLite)** — sống sót qua cap ring-buffer + restart. KHÔNG có
> sellerCredit/platformMargin per-record → dùng `/provision/settlements` (dưới) cho
> tiền chính xác.

### GET /provision/settlements  — đối soát settlement per-record (TIỀN CHÍNH XÁC)
Query (optional): `keyId` (lọc theo buyer key), `sellerId`, `since` (ISO-8601),
`limit` (1..1000, mặc định 100). `keyId` không tồn tại → `{data:[],total:0}`.
200:
```json
{ "total": 320,
  "data": [ { "id": "stl_...", "requestId": "req_...", "ts": 1730000000000,
    "buyerKeyId": "internal_key_3", "baseModel": "gpt-5.5", "sellerId": "hoang",
    "promptTokens": 1000, "completionTokens": 500,
    "collected": 0.006, "sellerCredit": 0.0048, "platformMargin": 0.0012,
    "billTrack": "payg", "reversed": false } ] }
```
> Mỗi dòng mang **số tiền ĐÃ GHI NHẬN** (không phải ước tính): `collected` =
> `sellerCredit + platformMargin`. `id` = `settlementId` (khớp khóa idempotent trong
> webhook). `requestId` = khóa nối sang `/provision/usage` (cùng request). Dùng để
> replay CHÍNH XÁC bill buyer + tích payout seller cho khoảng bị miss webhook.
> `reversed:true` = settlement đã bị đảo (đừng tính). `sellerId="house"` → không tích
> payout. Đây là nguồn thay thế đầy đủ cho `usage.recorded` bị lỡ.

<!-- SEC_WEBHOOK -->

---

## 6. Webhook config (provision-self-service)

### GET /provision/webhook
200: `{ "enabled": true, "url": "https://...", "events": [...], "secretSet": true, "secret": "••••••••" }`
(secret luôn bị mask)

### PUT /provision/webhook  — đặt target nhận sự kiện
Body (tất cả optional):
```json
{ "enabled": true, "url": "https://your-site/api/x-router/hook",
  "secret": "shared-secret-mạnh",
  "events": ["usage.recorded", "wallet.low", "grant.exhausted",
             "quota.blocked", "supply.unhealthy"] }
```
- `url` phải là URL hợp lệ hoặc chuỗi rỗng. `events` rỗng/không set = nhận TẤT CẢ.
- Chỉ gửi `secret` khi đổi (đừng gửi lại giá trị mask). Secret được **mã hoá khi
  lưu** (change #5).
- (Tương đương `PUT /admin/v1/business-webhook` bằng admin key — chọn 1 đường.)

200: `{ "enabled", "url", "events", "secretSet" }`

---

## 7. Webhook IN (x-router → website)

Mỗi sự kiện = HTTP POST tới `url` đã cấu hình, body:
```json
{ "event": "<name>", "timestamp": "<ISO8601>", "data": { ... } }
```
Header `X-Provision-Signature: sha256=<hex>` = HMAC-SHA256 của **raw body bytes**
dưới `secret`. **Verify trước khi tin.** Giao hàng best-effort (timeout 5s, lỗi bị
nuốt, KHÔNG chặn request buyer) → website phải **idempotent** + có job đối soát.

### Verify (mẫu Node)
```js
import { createHmac, timingSafeEqual } from "node:crypto";
function verify(rawBody, sigHeader, secret) {
  const expected = "sha256=" + createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(sigHeader ?? ""), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);   // hash RAW body, đừng re-serialize
}
```

### `usage.recorded` (volume cao — nguồn để bill buyer + tích payout seller)
```json
{ "event": "usage.recorded", "timestamp": "...", "data": {
  "settlementId": "stl_...", "buyerKeyId": "internal_key_3", "buyerKeyHash": "…",
  "baseModel": "gpt-5.5", "sellerId": "seller_hoang_xxx",
  "promptTokens": 1000, "completionTokens": 500,
  "actualSellCost": 0.006037, "sellerCredit": 0.004830,
  "platformMargin": 0.001207, "billTrack": "plan" } }
```
- **`settlementId`** = id duy nhất + ổn định của lần settle này (chính là
  `settlement_log.id`). **Đây là KHÓA IDEMPOTENT**: khử trùng webhook theo nó, và nó
  khớp `id` trong `GET /provision/settlements` — một khóa dùng chung cho cả realtime
  lẫn đối soát. Webhook best-effort (có thể trùng/lỡ) → BẮT BUỘC idempotent theo khóa này.
- `actualSellCost` = số **thu thực tế** từ buyer (đã trừ trường hợp ví chạm đáy).
- `sellerCredit` = phần cộng dồn cho seller (bỏ qua khi `sellerId="house"`).
- `billTrack`: `"plan"` (trừ hạn mức gói) | `"payg"` (trừ ví).
- Luôn đúng: `actualSellCost = sellerCredit + platformMargin`.

### `quota.blocked`
`data: { keyId, httpStatus, reason, model }` — request bị chặn (429/402, không
boost/overage). Dùng để gợi ý buyer nâng gói / nạp tiền.

### `wallet.low`
`data: { keyId, balanceUsd, thresholdUsd }` — số dư sau settle dưới ngưỡng → nhắc nạp.

### `grant.exhausted`
`data: { keyId, planId, group, monthUsd }` — settle vừa vượt `monthUsd` của group
(phát 1 lần khi chuyển trạng thái).

### `supply.unhealthy`
`data: { sellerId, providerAccountId, reason }` — request tới seller (không phải
house) lỗi terminal → cảnh báo vận hành / hạ listing.

<!-- SEC_FLOW -->

---

## 8. Buyer dùng key để gọi AI (`/v1/*`)

Sau khi nhận `key` từ `POST /provision/key`, buyer gọi inference bằng **client key**
đó (KHÔNG phải provision key):
```
POST /v1/chat/completions        (OpenAI-compatible)   Authorization: Bearer <clientKey>
POST /v1/messages                (Anthropic-compatible)
GET  /v1/models
```
- Header tuỳ chọn `x-allow-boost: true` để cho phép vượt speed-limit qua PAYG.
- Model 2 tầng: `gpt-5.5` (pooled, chọn seller rẻ nhất + failover) hoặc
  `hoang/gpt-5.5` (direct, ghim seller).
- Khi chặn: `403 model_not_in_plan` | `429 spend_limit_exceeded` (+`Retry-After`) |
  `402` (hết tiền/PAYG limit). Các trường hợp này cũng phát webhook `quota.blocked`.

## 9. Mã lỗi thường gặp

| HTTP | code | Ý nghĩa |
|---|---|---|
| 400 | `validation_error` | body sai/thiếu trường |
| 400 | `listing_rejected` | baseModel không canonical / seller chưa approved |
| 401 | `invalid_provision_api_key` | thiếu/sai provision key |
| 404 | `not_found` | key/seller/listing không tồn tại |
| 429 | `provision_rate_limit_exceeded` | vượt rate limit provision (retry-after 60s) |
| 402/429/403 | (inference) | hết tiền / speed-limit / model ngoài gói |

## 10. Luồng end-to-end

```
1. Đăng ký buyer   POST /provision/key  →  lưu user↔keyId, đưa `key` cho buyer
2. Gán gói         POST /provision/grant
3. Nạp tiền        (xác nhận VND → quy đổi USD) POST /provision/wallet/topup
4. Buyer gọi AI    POST /v1/chat/completions (Bearer <clientKey>)
5. x-router settle →  POST webhook usage.recorded → website verify HMAC → ghi sổ
6. Onboard seller  POST /provision/seller (+approve) + POST /provision/listing
7. Trả seller      (chuyển khoản off-platform) POST /provision/earnings/:id/mark-paid
8. Hủy buyer       POST /provision/key/:id/disable  |  DELETE /provision/key/:id
```

## 11. Checklist tích hợp (rút gọn)

- [ ] Provision key giữ **server-side**; gọi `/provision/*` từ backend.
- [ ] Mapping `user ↔ keyId` và `seller ↔ sellerId` ở DB website.
- [ ] Quy đổi VND→USD trước khi `topup` (x-router chỉ biết USD).
- [ ] Endpoint nhận webhook + **verify HMAC** + xử lý **idempotent** (khoá theo
      hash body).
- [ ] Dựng sổ bill buyer + payable seller từ `usage.recorded`; đối soát định kỳ với
      `GET /provision/usage` + `GET /provision/earnings/:sellerId`.
- [ ] Retry-with-backoff khi gặp `429`.
- [ ] Quy trình xoay provision key (2 key song song trong `PROVISION_API_KEYS`).







