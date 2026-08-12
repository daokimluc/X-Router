# Đã MERGE + PUBLISH — Subscription (v0.5.0) + Token Packs (v0.6.0)

> Phản hồi cho `ANSWERS_FROM_XROUTER_PLAN_BILLING_V2.md` (subscription) và
> `DECISIONS_XROUTER_TOKEN_PACKS.md` (token packs). **Cả hai đã build xong, test xanh,
> merge vào `main`, publish lên GitHub Packages, và update global x-router lên v0.6.0.**
>
> Tài liệu này = shape API CUỐI CÙNG (thực tế đã ship) để Foza wire. Có vài chỗ **khác**
> so với file DECISIONS — đã đánh dấu ⚠️ ở dưới, vui lòng đọc kỹ phần token-pack.
>
> Suite: 771 pass / 7 skip · tsc sạch · boundary engine→marketplace giữ nguyên.

---

## ⚠️ 0. Điều cần làm NGAY (ops + breaking)

1. **Restart instance x-router** (port 3100) để v0.6.0 có hiệu lực. Bản đang chạy vẫn là
   code cũ tới khi restart. Sau restart, SQLite tự migrate lên schema v6 (thêm bảng
   `token_grants`) — không cần thao tác tay, không mất dữ liệu.
2. **BREAKING — subscription:** ví **$0 KHÔNG còn subscribe được paid plan** nữa (trước đây
   gán plan miễn phí — đó là bug). Foza phải **nạp ví TRƯỚC** rồi mới gọi `POST
   /provision/grant` cho plan trả phí, nếu không nhận **402 `insufficient_funds`**.
3. **Key đang gắn paid plan từ trước** (chưa có chu kỳ): được **grandfather** — lần đánh giá
   renew đầu tiên X-Router set `planPeriodEnd = now + 1 tháng` **KHÔNG thu tiền** (vì trước
   đó được cấp theo cơ chế miễn phí cũ); các kỳ sau thu bình thường. Foza không cần làm gì.

---

## 1. SUBSCRIPTION PLAN (v0.5.0) — paid plan = thuê bao tháng

Đúng như `ANSWERS_..._PLAN_BILLING_V2.md`. Tóm tắt hành vi đã ship:

| Hành vi | Chi tiết |
|---|---|
| Đăng ký plan trả phí | thu `priceUsd` từ ví NGAY, đủ tiền mới gán plan; thiếu → **402 `insufficient_funds`**, plan KHÔNG gán |
| Free ($0) | gán thẳng, không thu, không chu kỳ |
| Re-grant cùng plan trong kỳ | **idempotent** — không thu lại (`idempotent: true`) |
| Auto-renew mỗi tháng | trừ `priceUsd` lại nếu ví đủ; đẩy `planPeriodEnd` +1 tháng lịch; reset bucket tháng |
| Renew thiếu tiền | **hạ về Free** (`planId=null`), webhook `plan.downgraded`, request đang gọi nhận **402 `plan_renewal_failed`** |
| Đổi plan | thu full giá plan mới + kỳ mới (không prorate/hoàn plan cũ) |
| Hủy (`planId: null`) | gỡ plan, ngừng renew, không hoàn kỳ hiện tại |
| Chu kỳ | **1 tháng lịch, cùng ngày**, kẹp cuối tháng kiểu Stripe (mua 31/1 → hết hạn 28/2) |
| Reset quota | bucket tháng reset **trùng mốc renew** (theo kỳ đăng ký, không theo lịch UTC). Hour/day vẫn theo lịch |

### Endpoint: đăng ký / đổi / hủy

```
POST /provision/grant          (provision key)
  body: { keyId, planId, overageEnabled?, paygDailyLimitUsd? }
        planId = null  → HỦY (gỡ plan, ngừng renew)

  200 → {
    id, planId, planPeriodEnd, planChargedAt, walletUsd,
    overageEnabled, paygDailyLimitUsd, idempotent?: true
  }
  402 → { error: { message, code: "insufficient_funds" } }   // ví thiếu, plan KHÔNG gán
  400 → plan không tồn tại   ·   404 → key không tồn tại
```

> **`planPeriodEnd` và `planChargedAt` là số epoch-ms (milliseconds), KHÔNG phải chuỗi ISO.**
> Foza đổi sang Date ở client: `new Date(planPeriodEnd)`. `null` = chưa có chu kỳ (Free /
> chưa gắn plan).

### Đọc trạng thái

```
GET /provision/keys
  → mỗi key thêm:  planPeriodEnd (epoch-ms | null), planChargedAt (epoch-ms | null)

GET /provision/wallet/:keyId
  → { keyId, walletUsd, provisioned, planId, planPeriodEnd, planChargedAt }
```

### Webhook mới (business webhook, đã thêm vào `BUSINESS_EVENTS` — subscribe được)

```
plan.renewed     { keyId, planId, priceUsd, periodEnd, walletUsd }
plan.downgraded  { keyId, fromPlanId, reason: "renewal_underfunded", walletUsd }
```
Dùng để Foza cập nhật UI "đã gia hạn / đã hạ về Free" + nhắc user nạp tiền.

---

## 2. TOKEN PACKS (v0.6.0) — track thứ 3 `tokenpack`

Đúng 4 quyết định trong `DECISIONS_XROUTER_TOKEN_PACKS.md`: gộp prompt+completion · Foza
gửi `expiresAt` · không xé lẻ request lớn · seller credit theo model (route tự do). Thứ tự
tiêu: **tokenpack → plan → ví PAYG**. Tiền mua pack đi qua luồng Foza; X-Router chỉ cấp
token + lưu `pricePaidUsd` để đối soát, KHÔNG trừ ví cho request pack.

### ⚠️ Shape CUỐI có KHÁC file DECISIONS — Foza wire theo bảng này

DECISIONS_XROUTER_TOKEN_PACKS.md đề xuất một số tên field; shape **thực tế đã ship** hơi
khác. Đây là endpoint mới (chưa có client cũ) nên shape ship theo quy ước nội bộ của
`TokenGrantService` và **đây là shape chốt** — Foza wire theo cột "Đã ship":

| Chỗ | DECISIONS đề xuất | **Đã ship (CHỐT — dùng cái này)** |
|---|---|---|
| Field id của pack | `packId` | **`id`** |
| Tổng token mua | `tokens` | **`tokensTotal`** |
| Wrapper list | `{ packs: [...] }` | **`{ tokenPacks: [...] }`** |
| Cờ đã hết | `exhausted` | **KHÔNG có** — tự suy: `tokensRemaining === 0` |
| Response POST | `{ packId, ... }` phẳng | **`{ grant: {...} }`** (bọc trong `grant`) |

> Shape này đã chốt (đã publish v0.6.0). Foza điều chỉnh client theo cột "Đã ship".

### Endpoint: cấp pack (Foza gọi SAU khi đã thu tiền)

```
POST /provision/token-pack     (provision key, idempotent)
  body: {
    keyId,                    // key của buyer
    baseModel,                // vd "claude-sonnet-4-6" — pack gắn 1 model
    tokens,                   // int > 0, tổng token mua (gộp in+out)
    pricePaidUsd,             // >= 0, audit-only (X-Router KHÔNG trừ ví)
    expiresAt,                // epoch-ms, PHẢI ở tương lai (Foza tính = now + 12 tháng)
    idempotencyKey            // gắn với giao dịch thanh toán — retry không cấp 2 lần
  }

  200 → { grant: {
    id, keyId, baseModel,
    tokensTotal, tokensRemaining,    // lúc cấp: bằng nhau
    pricePaidUsd, expiresAt, createdAt, idempotencyKey
  } }
  400 → body sai / expiresAt <= now (đã quá hạn)
  404 → key không tồn tại
```

- **Idempotent:** gửi lại đúng `idempotencyKey` → trả về **đúng pack cũ**, KHÔNG cấp thêm,
  KHÔNG cộng token. (Kể cả nếu `tokens` trong body khác — vẫn giữ pack gốc.)
- `expiresAt`: X-Router lưu + enforce nguyên cột này. Đổi policy TTL về sau → Foza chỉ đổi
  con số gửi lên, X-Router không phải build lại. (Đúng đề nghị của Foza ở DECISIONS điểm 2.)

### Endpoint: đọc pack

```
GET /provision/token-packs?keyId=<id>      (provision key)
  → { keyId, tokenPacks: [ {
        id, keyId, baseModel, tokensTotal, tokensRemaining,
        pricePaidUsd, expiresAt, createdAt, idempotencyKey
      } ] }
  // sắp xếp: pack chưa hết hạn trước, mới nhất trước

GET /provision/keys
  → mỗi key thêm:  tokenPacks: [ { baseModel, tokensRemaining, expiresAt } ]
  // bản RÚT GỌN (3 field) để dựng trang keys 1 call — không N+1.
  // Cần chi tiết đầy đủ thì gọi GET /provision/token-packs?keyId=
```

> `expiresAt` cũng là epoch-ms. "Đã hết / hết hạn" Foza tự suy: `tokensRemaining === 0`
> hoặc `expiresAt <= Date.now()`.

### Hành vi enforce + settle (để Foza hiểu, không phải gọi)

- Request có model khớp `baseModel` của 1 pack **còn hạn + đủ token ước lượng** → tiêu pack,
  **KHÔNG đụng plan/ví**. Trừ `tokensRemaining` theo `promptTokens + completionTokens` THẬT
  sau khi xong.
- Request **lớn hơn token còn lại của pack** → **KHÔNG xé lẻ**, rơi xuống plan/ví, pack giữ
  nguyên. (Quyết định 3.)
- Pack **hết hạn** → bỏ qua, rơi xuống plan/ví.
- Seller phục vụ vẫn được **credit bình thường** theo giá vốn (route tự do — quyết định 4).
  X-Router giữ **margin = 0** trên pack (Foza đã ăn chênh lệch lúc bán).
- Request lỗi → nhả token đã giữ, pack về như cũ.

---

## 3. Checklist Foza wire

- [ ] **Nạp ví trước khi subscribe** plan trả phí (nếu không → 402). Bắt 402
      `insufficient_funds` → hiện "nạp thêm $X".
- [ ] Hiển thị `planPeriodEnd` / `planChargedAt` (đổi từ epoch-ms) — "gia hạn DD/MM".
- [ ] Subscribe webhook `plan.renewed` / `plan.downgraded` → cập nhật UI + nhắc nạp tiền.
- [ ] Bắt **402 `plan_renewal_failed`** (request bị chặn vì renew hụt tiền giữa chừng).
- [ ] Mua pack: gọi `POST /provision/token-pack` **SAU** khi thu tiền, kèm `idempotencyKey`
      = id giao dịch. Đọc `grant.id`, `grant.tokensRemaining`.
- [ ] Trang keys/wallet: đọc `tokenPacks[]` (bản rút gọn) từ `GET /provision/keys`; trang
      chi tiết dùng `GET /provision/token-packs?keyId=`.
- [ ] Wire theo cột "**Đã ship**" ở bảng §2 (`id` / `tokensTotal` / `{ tokenPacks }` /
      `{ grant }`) — đây là shape chốt, KHÔNG phải tên trong DECISIONS.

---

## 4. Tham chiếu phiên bản

- `main` đã push 7 commit (feat/release/archive ×2 + notes). Tag **`v0.5.0`** (subscription)
  + **`v0.6.0`** (token packs). Đã publish GitHub Packages `@daokimluc/x-router@0.6.0`.
- OpenSpec: `marketplace-plan-subscription` + `marketplace-token-packs` đã archive vào
  `openspec/specs/`. `npx openspec list` = không còn change mở.
- Money state (ví, earnings, settlement, token_grants) ở SQLite `~/.x-router/gateway.sqlite`
  (schema v6). Cấu hình alignment xem `XROUTER_CONFIG_SOURCE_OF_TRUTH.md`.

> Báo lại nếu cần thêm field nào trên read surface, hoặc gặp vướng khi wire. Sẵn sàng
> bump patch.
