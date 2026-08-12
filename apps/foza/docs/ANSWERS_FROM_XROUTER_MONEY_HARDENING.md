# Money-path hardening — thay đổi Foza cần biết (v0.6.1 + v0.6.2)

> Sau khi ship subscription (v0.5.0) + token-packs (v0.6.0), tôi đã audit sâu toàn bộ
> luồng tiền và sửa qua 2 đợt: **v0.6.1** (2 lỗi nghiêm trọng + 4 lỗi cao) và **v0.6.2**
> (nhóm còn lại). Hầu hết là sửa nội bộ KHÔNG ảnh hưởng Foza. Tài liệu này chỉ liệt kê
> những thứ **chạm tới API Foza gọi** hoặc **đổi hành vi Foza cần xử lý**.
>
> Phần lớn là **validation mới** (thêm vài mã lỗi 400/402 cần bắt). Không đổi shape phản
> hồi thành công. Đọc §1 (action items) là đủ; §2 là chi tiết.

---

## ⚠️ §1. Việc Foza cần làm

### 1.1 Bắt thêm các mã lỗi mới (đều là HTTP 400/402, body `{ error: { message, code } }`)

| Endpoint | Tình huống mới bị chặn | HTTP | `code` |
|---|---|---|---|
| `POST /provision/wallet/topup` | `amount` > trần nạp (mặc định **$100,000**/lần) | 400 | `amount_too_large` |
| `POST /provision/token-pack` | `tokens` > trần (mặc định **10,000,000,000**) | 400 | `amount_too_large` |
| `POST /provision/token-pack` | `expiresAt` quá xa (> **2 năm** kể từ now) | 400 | `validation_error` |
| `POST /provision/token-pack` | `expiresAt` <= hiện tại (đã có từ v0.6.0) | 400 | `validation_error` |
| `POST /provision/earnings/:sellerId/mark-paid` | `amount` > số `unpaid` của seller | 400 | `amount_exceeds_unpaid` |
| `POST /provision/grant` | ví không đủ trả `priceUsd` (đã có từ v0.5.0) | 402 | `insufficient_funds` |

→ Các trần đều **rất rộng**, traffic thật gần như không chạm. Chỉ cần Foza hiển thị
message lỗi thay vì coi là 500. Nếu cần trần khác, đổi qua env (xem §2.4) — không cần tôi
sửa code.

### 1.2 `mark-paid` giờ idempotent + có trần — Foza nên gửi `payoutRef`

- **Idempotent:** gọi lại `mark-paid` cùng `payoutRef` → chỉ ghi 1 payout, `unpaid` chỉ
  trừ 1 lần. Webhook thanh toán retry KHÔNG còn double-pay. → Foza **nên luôn gửi
  `payoutRef`** (id giao dịch chi trả) để được bảo vệ idempotent.
- **Trần:** không chi nhiều hơn `unpaid` (400 `amount_exceeds_unpaid`). Foza đọc `unpaid`
  từ snapshot trước khi mark-paid, hoặc bắt lỗi 400 này.

### 1.3 Hoàn tiền ví (nếu Foza gọi route admin refund) nên gửi `idempotencyKey`

- `POST /admin/v1/api-keys/:id/wallet/refund` nhận thêm field tùy chọn **`idempotencyKey`**.
  Gửi nó (gắn với giao dịch hoàn tiền) → retry chỉ cộng ví 1 lần. Không gửi → vẫn hoạt
  động như cũ (không idempotent). (Đây là route admin, không phải provision — chỉ liên
  quan nếu Foza dùng admin key để hoàn tiền.)

### 1.4 Một thay đổi hành vi billing cần biết: key gắn paid plan PHẢI có tiền

- Trước đây (bug cũ) một số đường tạo key gắn sẵn paid plan được "tháng đầu miễn phí".
  Giờ: key gắn paid plan **tạo sau 2026-06-01** sẽ bị **thu tiền ngay lần request đầu**
  (hoặc hạ về Free nếu ví thiếu → request đó nhận **402 `plan_renewal_failed`**).
- → Quy trình đúng của Foza vẫn như cũ: **nạp ví trước**, rồi mới gắn plan qua
  `POST /provision/grant` (route này đã thu tiền đúng từ v0.5.0). Key tạo trước mốc trên
  vẫn được grandfather (không thu hồi tố).

---

## §2. Chi tiết (tham khảo)

### 2.1 KHÔNG đổi shape phản hồi thành công
`POST /provision/grant`, `GET /provision/keys`, `GET /provision/wallet/:keyId`,
`POST /provision/token-pack`, `GET /provision/token-packs` — tất cả giữ nguyên shape đã
bàn giao ở doc trước (`ANSWERS_FROM_XROUTER_BILLING_SHIPPED.md`). Chỉ thêm nhánh lỗi 400.

### 2.2 Token-pack giờ bền hơn (nội bộ, Foza không phải làm gì)
- Token pack buyer đã trả tiền **không còn bị mất khi gateway restart/crash giữa request**
  (trước đây có rủi ro mất token đã reserve). Reservation giờ lưu bền + tự khôi phục lúc
  khởi động.
- Pack **sắp hết hạn được tiêu trước** (không để token gần hết hạn bị phí).
- Hoàn (reverse) một settlement của pack giờ **trả token về pack** (trước đây buyer mất
  trắng). Foza không cần thay đổi — chỉ là hành vi đúng hơn khi admin reverse.

### 2.3 Đối soát (reconcile) tách bạch ví và pack — endpoint admin
- `GET /admin/v1/marketplace/reconcile/platform` giờ trả thêm khối `packs`:
  `{ totalCollected, ..., packs: { totalPricePaid, recognizedValue, sellerCredit, ok } }`.
  - `totalCollected` (solvency ví) **không còn tính tiền pack** (vì tiền pack Foza thu
    off-platform, không vào ví). Nếu trước đây Foza đọc số này và thấy nó "phồng" vì pack
    → giờ nó chỉ phản ánh tiền ví thật (plan + PAYG).
  - `packs.ok=false` nghĩa là gateway đã ghi nhận giá trị pack vượt tổng `pricePaidUsd`
    Foza đã gửi — tín hiệu để Foza kiểm tra việc gửi `pricePaidUsd` lúc cấp pack.
- `GET /admin/v1/marketplace/reconcile/seller/:id` giờ có thêm field **`overPaidUsd`**:
  > 0 nghĩa là đã chi cho seller nhiều hơn số đang nợ (vd reverse một settlement sau khi
  đã trả tiền) — `ok=false`. Trước đây tình huống này bị giấu (luôn `ok=true`).

### 2.4 Cấu hình trần (env, nếu Foza/admin muốn đổi)
Đặt trong `~/.x-router/config.json` hoặc env của instance, đều có default rộng:
- `FALLBACK_COST_PER_1K_USD` (mặc định `0.001`) — giá sàn cho request route tới nguồn
  chưa có listing/giá, để không bao giờ phục vụ miễn phí.
- `MAX_TOPUP_USD` (mặc định `100000`), `MAX_PACK_TOKENS` (mặc định `1e10`),
  `MAX_PACK_HORIZON_MS` (mặc định ~2 năm).

### 2.5 Lưu ý kỹ thuật
- `idempotencyKey` của token-pack (`POST /provision/token-pack`) **vẫn như cũ** — đã
  idempotent từ v0.6.0. v0.6.2 chỉ thêm trần `tokens`/`expiresAt`.
- Lazy-renew (thu phí định kỳ) giờ **chỉ chạy trên request có model** (chat/completions),
  không chạy trên route metadata như `GET /v1/models` → gọi metadata không bao giờ vô tình
  kích hoạt thu tiền/hạ plan. Background monitor vẫn phủ key không có traffic.

---

## §3. Phiên bản
- Đã ship: **v0.6.1** (2 CRITICAL + 4 HIGH) + **v0.6.2** (nhóm còn lại). Tag `v0.6.1`,
  `v0.6.2` đã push; publish GitHub Packages; SQLite schema lên **v8** (tự migrate khi
  restart, additive — không mất data). `npx openspec list` = không còn change mở.
- Instance vận hành (port 3100) cần **restart** để áp dụng — admin (bạn) tự làm.

> Tóm lại cho Foza: **bắt thêm vài mã lỗi 400/402 ở §1.1, luôn gửi `payoutRef` khi
> mark-paid, nạp ví trước khi gắn paid plan.** Còn lại là sửa nội bộ. Báo nếu cần đổi trần
> hoặc cần thêm field nào trên reconcile.
