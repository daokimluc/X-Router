# Yêu cầu tích hợp Website ↔ x-router (Marketplace)

> Tài liệu này là **bản yêu cầu** cho team website (`XRouter.ai`) khi tích hợp với
> 5 change hardening của x-router (Phase 34b). Hợp đồng kỹ thuật chi tiết nằm ở
> `MARKETPLACE_INTEGRATION.md`; tài liệu này là checklist + đặc tả triển khai.
>
> Quy ước: x-router chỉ nói **USD** (lưu nội bộ dạng integer micro-USD). Website
> sở hữu danh tính buyer/seller, thanh toán VND/QR, quy đổi FX, payout. Website là
> **biên giới tin cậy** — x-router KHÔNG cô lập tenant.

---

## 0. Bối cảnh & phân vai

| Thành phần | Vai trò |
|---|---|
| **Website** (việc của bạn) | Control-plane: đăng nhập user, ví VND, thanh toán/QR, quy đổi USD, catalog gói (UI), đối soát payout cho seller, lưu mapping `user ↔ keyId/sellerId`, nhận + verify webhook. |
| **x-router** (đã xây xong) | Engine: ví USD, định tuyến + tính tiền request, phát webhook đã ký. Nhận lệnh qua `/provision/*`. |

**Nguyên tắc bất biến:** x-router hành động trên bất kỳ `keyId`/`sellerId` nào được
truyền vào. Website BẮT BUỘC tự kiểm tra mỗi `keyId`/`sellerId` thuộc đúng user đã
đăng nhập trước khi gọi.

---

## 1. Điều kiện tiên quyết

- [ ] x-router chạy với `MARKETPLACE_ENABLED=true`.
- [ ] Cấp **provision key** cho website: đặt `PROVISION_API_KEYS=<key>` (hỗ trợ
      nhiều key, phân tách bằng dấu phẩy — phục vụ xoay key).
- [ ] Provision key được giữ **chỉ ở backend website**, không bao giờ lộ ra
      browser/app/client.
- [ ] (Tùy chọn) Đặt `PROVISION_RATE_LIMIT_PER_MINUTE` (mặc định 120; đặt 0 để tắt
      nếu single-tenant tin cậy; nâng lên khi cần provisioning hàng loạt).
- [ ] Website có **admin key** riêng (`ADMIN_API_KEYS`) nếu muốn cấu hình webhook /
      tạo gói / duyệt seller bằng API thay vì dashboard.

<!-- SECTION_2 -->

## 2. Data model phía website (yêu cầu lưu trữ)

x-router KHÔNG biết user là ai. Website phải tự giữ các mapping + sổ sách sau:

**`buyers`** — user mua
- `userId` (PK, danh tính website)
- `keyId` (do `/provision/key` trả về — internal id của x-router)
- `clientKeyPlaintext` → **chỉ hiển thị 1 lần** cho user, KHÔNG lưu plaintext (chỉ
  lưu hash nếu cần đối chiếu; x-router cũng chỉ giữ hash)
- `planId`, trạng thái (active/disabled/revoked)

**`sellers`** — user bán
- `userId` (PK)
- `sellerId` (do `/provision/seller` trả về)
- `payoutAccount` (thông tin ngân hàng VND — của website; x-router chỉ giữ
  `payoutRef` mờ)
- `commissionPct`, trạng thái

**`wallet_topups`** — lịch sử nạp (đối soát VND↔USD)
- `userId`, `keyId`, `vndAmount`, `fxRate`, `usdAmount`, `gatewayTxId`, `status`

**`buyer_billing_ledger`** — sổ tính tiền buyer (dựng từ webhook `usage.recorded`)
- `eventId` (idempotency), `buyerKeyId`, `baseModel`, `tokens`, `actualSellCost`,
  `billTrack`, `timestamp`

**`seller_payable_ledger`** — sổ công nợ phải trả seller (dựng từ `usage.recorded`)
- `sellerId`, `sellerCredit` cộng dồn, `paidOut`, `unpaid` (đối soát với
  `GET /provision/earnings/:sellerId`)

**`webhook_events`** — log thô để idempotency + replay
- `eventId`/hash, `event`, `rawBody`, `signatureVerified`, `processedAt`

> **Quan trọng:** mọi event webhook phải được xử lý **idempotent** (dùng hash của
> raw body làm khoá) — giao hàng là best-effort, có thể trùng hoặc thiếu.

<!-- SECTION_3 -->

## 3. Các luồng nghiệp vụ (website phải triển khai)

### 3.1 Onboard buyer + gán gói
```
POST /provision/key      { label, planId? }   → { id: keyId, key, planId }
POST /provision/grant    { keyId, planId, overageEnabled?, paygDailyLimitUsd? }
```
- Lưu `userId ↔ keyId`. Trả `key` (plaintext) cho buyer **một lần** để họ dùng làm
  client key gọi `/v1/*`.
- `/provision/grant` idempotent: gán lại cùng gói, không đổi gì khác → trả thêm
  `"idempotent": true`.

### 3.2 Nạp ví (điểm quy đổi VND→USD — của website)
```
buyer thanh toán VND/QR → website xác nhận đã nhận tiền
→ website tự quy đổi sang USD theo tỷ giá của mình
POST /provision/wallet/topup   { keyId, usd }   → { keyId, walletUsd }
```
- x-router chỉ biết USD. Tỷ giá, phí, đối soát thanh toán là việc của website.
- Field chuẩn là `usd`. (`amountUsd` vẫn được chấp nhận nhưng là alias cũ — dùng
  `usd`.)

### 3.3 Onboard seller + listing
```
POST /provision/seller             { displayName, payoutRef?, commissionPct? }
POST /provision/seller/:id/approve     (hoặc /suspend)
POST /provision/listing            { sellerId, baseModel, costPrice{inputPerM,outputPerM,cachedInputPerM?},
                                     providerInstanceId, providerAccountId }
```
- `baseModel` phải nằm trong danh sách **canonical** (xem §5). Listing đăng ký cả
  tên direct `<seller>/<baseModel>` lẫn pooled `<baseModel>`.
- Seller đặt **giá vốn (cost)**; nền tảng đặt **giá bán** = `cost × (1 + markup)`.

### 3.4 Vòng đời sau khi buyer chạy AI (tự động qua webhook)
```
buyer gọi /v1/*  →  x-router settle  →  POST webhook usage.recorded → website
website: verify HMAC → ghi buyer_billing_ledger + cộng seller_payable_ledger
```

### 3.5 Trả tiền seller (off-platform) + đối soát
```
website chuyển khoản VND cho seller (ngoài hệ thống)
POST /provision/earnings/:sellerId/mark-paid   { usd, payoutRef? }
→ { sellerId, day, month, lifetime, unpaid }   // unpaid giảm
```
- `payoutRef` được lưu trên payout record của x-router (đối soát hai chiều).

### 3.6 Wind-down (hủy/đình chỉ buyer — change #3 marketplace-lifecycle)
Khi buyer hủy gói / hết hạn / gian lận, website tự động gọi:
```
POST   /provision/key/:id/disable     → tạm dừng (có thể bật lại)
POST   /provision/key/:id/enable      → bật lại
DELETE /provision/key/:id             → thu hồi (soft: disable, giữ để đối soát)
PATCH  /provision/key/:id             { enabled?, expiresAt? }   // expiresAt=null xoá hạn
GET    /provision/keys?owner=<label>  → liệt kê key đã cấp (đối soát)
```

<!-- SECTION_4 -->

## 4. Webhook (x-router → website) — BẮT BUỘC

### 4.1 Cấu hình target (dùng admin key, hoặc dashboard Marketplace → Webhook)
```
PUT /admin/v1/business-webhook
  { "enabled": true, "url": "https://your-site/api/x-router/hook",
    "secret": "<shared-secret-mạnh>", "events": ["usage.recorded", ...] }
```
- Secret được x-router **mã hoá khi lưu** (change #5). GET luôn trả mask `••••••••`.
- Chỉ gửi `secret` khi đổi (đừng gửi lại giá trị mask).
- Website cũng có thể tự cấu hình bằng **provision key** (không cần admin key):
  `GET /provision/webhook` và `PUT /provision/webhook` (cùng shape).

### 4.2 Verify chữ ký (KHÔNG được bỏ qua)
Mỗi POST kèm header `X-Provision-Signature: sha256=<hex>` = HMAC-SHA256 của
**raw body bytes** dưới shared secret.
```js
import { createHmac, timingSafeEqual } from "node:crypto";
function verify(rawBody, signatureHeader, secret) {
  const expected = "sha256=" + createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(signatureHeader ?? ""), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
// hash RAW body, KHÔNG re-serialize object.
```

### 4.3 Các sự kiện cần xử lý
| Event | Khi nào | Website làm gì |
|---|---|---|
| `usage.recorded` | mỗi request tính tiền xong (volume cao) | ghi sổ bill buyer + cộng payable seller (`sellerCredit`). `billTrack`=`plan`/`payg`; `sellerId="house"` = supply nền tảng, không trả ai. |
| `quota.blocked` | request bị chặn (429/402) | hiển thị lý do, gợi ý nâng gói / bật overage |
| `wallet.low` | số dư sau settle < ngưỡng | nhắc buyer nạp thêm |
| `grant.exhausted` | settle vượt `monthUsd` của group (1 lần) | thông báo hết hạn mức tháng |
| `supply.unhealthy` | request tới seller (không phải house) lỗi terminal | cảnh báo vận hành / hạ listing seller |

> `usage.recorded` là nguồn sự thật để **bill buyer** và **tích payout seller**.
> Đối soát định kỳ với `GET /provision/usage` (reconciliation-grade) và
> `GET /provision/earnings/:sellerId`.

<!-- SECTION_5 -->

## 5. Catalog: gói / markup / canonical model / seller-terms

Những thứ này **không nhất thiết phải build UI bên website** — change #4 đã thêm
**dashboard operator** trong x-router (`MARKETPLACE_ENABLED` mới hiện). Bạn chọn 1
trong 2:

- **Cách A (đơn giản):** operator dùng dashboard x-router (mục Marketplace) để tạo
  gói, duyệt seller, sửa markup, quản canonical model, cấu hình webhook. Website
  chỉ cần đọc danh sách gói để hiển thị cho buyer.
- **Cách B (tự động hoá):** website tự gọi API admin/provision tương ứng.

API liên quan (admin key trừ khi ghi rõ provision):
```
# Gói (buyer chọn lúc đăng ký)
GET    /provision/plans                         (provision — chỉ đọc, cho UI)
GET/POST/PATCH/DELETE /admin/v1/plans           (admin — CRUD gói)

# Markup
PUT    /provision/markup    { defaultMarkup?, perModel? }   (provision)
GET/PUT /admin/v1/markup                                     (admin; null xoá override)

# Canonical model (điều kiện để tạo listing)
GET    /admin/v1/canonical-models
POST   /admin/v1/canonical-models       { model }
DELETE /admin/v1/canonical-models/:model   (409 nếu còn listing bật dùng)

# Sửa điều khoản seller / re-price listing (change #3)
PATCH  /admin/v1/sellers/:id    { commissionPct?, payoutRef? }   (house không sửa được)
PATCH  /admin/v1/listings/:id   { enabled?, costPrice? }          (re-price giữ nguyên id)
```

**Mô hình gói (để hiển thị + giải thích cho buyer):**
- Gói seed: `plan_free`, `plan_claude` ($10, group claude), `plan_codex` ($10,
  codex), `plan_pro` ($20, tất cả). Mỗi gói = `{ modelGroups, buckets{hourUsd,
  dayUsd, monthUsd}, overageEnabled, paygDailyLimitUsd? }`.
- `monthUsd` = ngân sách tháng; `hourUsd`/`dayUsd` = **speed-limit** (giới hạn tốc
  độ, không phải hết tiền). Chạm hour/day → 429 `spend_limit_exceeded` +
  `Retry-After` (mặc định CHỜ).
- **Boost** (opt-in `x-allow-boost: true` hoặc cờ key) → vượt speed-limit qua PAYG,
  KHÔNG tiêu ngân sách tháng.
- Hết ngân sách tháng + overage bật → PAYG (trừ ví) ở giá bán, chặn bởi
  `paygDailyLimitUsd` user tự đặt. Overage tắt → chặn.
- Model ngoài group của gói → 403 `model_not_in_plan`.
- Tên model 2 tầng: pooled `gpt-5.5` (nền tảng chọn seller rẻ nhất, có failover) vs
  direct `hoang/gpt-5.5` (ghim seller).

<!-- SECTION_6 -->

## 6. Mô hình bảo mật (change #5 — BẮT BUỘC tuân thủ)

- **x-router KHÔNG cô lập tenant.** Website phải tự scope mọi `keyId`/`sellerId` về
  đúng user đã đăng nhập trước khi gọi `/provision/*`. Không bao giờ truyền `keyId`
  mà user không sở hữu.
- **Provision key = god-mode.** Một key bị lộ = mất toàn bộ mặt phẳng tiền + dữ
  liệu (mint ví bất kỳ key, đọc ví/usage mọi buyer, đọc earnings mọi seller, giả
  payout, đổi markup/listing, đổi webhook). Giữ **chỉ server-side**.
- **Verify HMAC** mọi webhook trước khi tin (xem §4.2).
- **Xoay provision key không downtime:** `PROVISION_API_KEYS=old,new` → đổi website
  sang `new` → bỏ `old`.
- **Rate limit:** route privileged (`/provision/key`, `/wallet/topup`, `/grant`,
  `/earnings/:id/mark-paid`) bị giới hạn ~`PROVISION_RATE_LIMIT_PER_MINUTE`/phút/key
  → có thể nhận **HTTP 429** `provision_rate_limit_exceeded`. Website cần retry có
  backoff khi provisioning hàng loạt (hoặc nâng cấu hình cho cửa sổ migration).
- x-router ghi **audit log** mọi mutation provision/admin (kèm hash key).

> Cảnh báo nghiệp vụ (không phải lỗi code): bán lại sub vendor có thể vi phạm ToS
> Claude/OpenAI → seller bị ban → house backstop; giữ float buyer + nợ payout seller
> có thể chạm luật money-transmitter; gian lận supply (inference giả lấy credit).
> Đây là rủi ro để bạn cân nhắc, x-router chỉ giảm thiểu một phần.

<!-- SECTION_7 -->

## 7. Checklist triển khai theo từng change

**#1 usd-wallet / persistence-sqlite (ví USD)**
- [ ] Lưu sổ `wallet_topups` quy đổi VND→USD; gọi `/provision/wallet/topup` sau khi
      xác nhận thanh toán.
- [ ] Hiển thị số dư từ `GET /provision/wallet/:keyId` (`{ walletUsd, provisioned }`).

**#2 money-correctness (tính tiền đúng)**
- [ ] Bill buyer theo `actualSellCost` trong `usage.recorded` (số đã **thu thực
      tế**, đã trừ trường hợp ví chạm đáy).
- [ ] Cộng payable seller theo `sellerCredit`; bỏ qua `sellerId="house"`.
- [ ] Đối soát định kỳ: tổng `usage.recorded` khớp `GET /provision/earnings/*`.

**#3 marketplace-lifecycle (vòng đời)**
- [ ] Tự động disable/revoke key khi buyer hủy (§3.6).
- [ ] Set `expiresAt` cho gói có thời hạn.
- [ ] (Nếu cách B) re-price listing / sửa commission seller qua admin API.

**#4 admin-marketplace-ui (dashboard operator)**
- [ ] Quyết định cách A (operator dùng dashboard x-router) hay cách B (website tự
      gọi admin API) cho việc quản gói/seller/markup/canonical/webhook.
- [ ] Nếu cách A: chỉ cần `GET /provision/plans` để render UI chọn gói.

**#5 provision-hardening (bảo mật)**
- [ ] Provision key chỉ server-side; bật verify HMAC webhook.
- [ ] Retry-with-backoff khi gặp 429 `provision_rate_limit_exceeded`.
- [ ] Quy trình xoay key (2 key song song).

---

## 8. Luồng tóm tắt (1 màn hình)

```
Đăng ký buyer   → POST /provision/key + /provision/grant         (lưu user↔keyId)
Nạp tiền        → xác nhận VND + quy đổi USD → /provision/wallet/topup
Buyer gọi AI    → /v1/* (client key) → x-router settle → webhook usage.recorded
Website nhận    → verify HMAC → bill buyer + cộng payable seller  (idempotent)
Onboard seller  → /provision/seller (+approve) + /provision/listing
Trả seller      → chuyển khoản off-platform → /provision/earnings/:id/mark-paid
Hủy buyer       → /provision/key/:id/disable | DELETE
```

## 9. Lưu ý nhanh khi code

- Tất cả số tiền gửi/nhận là **USD** (number). Nội bộ x-router là micro-USD nhưng
  API phơi ra USD.
- Mọi lỗi: `{ "error": { "message", "code" } }` + HTTP 400/401/404/409/429.
- Webhook là **best-effort** (timeout 5s, lỗi bị nuốt, không chặn request buyer) →
  website PHẢI idempotent + có job đối soát bù cho event lỡ.
- `key` plaintext từ `/provision/key` chỉ trả **một lần**.






