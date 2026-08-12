# Foza chốt — token pack: BUILD ĐI + 4 quyết định

> Phản hồi cho `ANSWERS_FROM_XROUTER_TOKEN_PACKS.md`. Foza đồng ý toàn bộ thiết kế
> (hướng (a), track `tokenpack`, 1 pack = 1 baseModel, lock giá lúc mua, ưu tiên
> tokenpack → plan → ví). **Báo build đi.** Dưới đây chốt 4 điều X-Router cần.

## 4 quyết định (đã chốt)

**1. Đơn vị token: GỘP prompt + completion** — 1 con số (theo đề xuất v1 của X-Router).
   User mua "5M token" = 1 số duy nhất, settle trừ `promptTokens + completionTokens` khỏi
   `tokensRemaining`. Chênh lệch completion/prompt đã nằm trong giá lock lúc mua. (Để dành
   `weightCompletion` cho sau nếu cần, không làm v1.)

**2. TTL: 12 tháng kể từ lúc mua.** X-Router set `expiresAt = createdAt + 12 tháng` khi
   cấp pack (hoặc nhận `expiresAt` từ Foza — xem dưới). Pack hết hạn → coi như không còn
   pack → request rơi về plan/ví. Foza hiển thị "còn N token, hết hạn DD/MM".
   → Đề nghị: Foza gửi `expiresAt` trong body `POST /provision/token-pack` (Foza tính
   = now + 12 tháng theo policy), X-Router chỉ lưu + enforce cột đó. Vậy đổi policy TTL sau
   này không cần X-Router build lại. OK chứ?

**3. Request lớn hơn pack: KHÔNG xé lẻ** (theo đề xuất). Pack chỉ cover khi
   `tokensRemaining >= ước lượng`; thiếu → cả request rơi về plan/ví, pack giữ nguyên.
   Tránh kế toán 1-request-2-track.

**4. Seller credit: theo model, route tự do** (theo đề xuất). Pack gắn `baseModel`; request
   route tới seller nào thì seller đó được credit từ giá vốn. Pack chỉ là "đơn vị token
   buyer trả trước cho model X", KHÔNG khóa vào 1 seller. Lý do: linh hoạt, tận dụng được
   nhiều nguồn cung, và nếu 1 seller ngừng bán thì pack vẫn tiêu được qua seller khác.

## Xác nhận shape endpoint (Foza sẽ gọi)

```
POST /provision/token-pack    (privileged + idempotent theo khóa thanh toán)
  body: { keyId, baseModel, tokens, pricePaidUsd, expiresAt, idempotencyKey }
  → { packId, keyId, baseModel, tokens, tokensRemaining, expiresAt }

GET  /provision/token-packs?keyId=
  → { packs: [{ packId, baseModel, tokens, tokensRemaining, expiresAt, exhausted }] }
```
- **Idempotent:** Foza gửi `idempotencyKey` (gắn với giao dịch thanh toán) — webhook
  thanh toán retry KHÔNG được cấp pack 2 lần. Giống cách `claimPayout` Foza đang dùng.
- **Nhúng vào `GET /provision/keys`:** CÓ, làm ơn thêm `tokenPacks: [...]` vào mỗi key —
  Foza dựng trang keys 1 call (đỡ N+1). Endpoint `GET /provision/token-packs?keyId=` vẫn
  giữ cho trang chi tiết.
- `pricePaidUsd`: Foza tính = `sellPrice × tokens` lúc mua, gửi kèm để X-Router lưu audit
  (X-Router KHÔNG tính lại, KHÔNG trừ ví — tiền đã thu qua luồng thanh toán Foza).

## Quan trọng — thứ tự tiền & luồng thanh toán

- Tiền MUA pack đi qua **luồng thanh toán Foza** (hiện đang pending chờ cổng thanh toán
  thật — Foza chỉ gọi `POST /provision/token-pack` SAU khi đã xác nhận thu tiền). X-Router
  không cần biết về thu tiền, chỉ cấp token + lưu `pricePaidUsd` để đối soát.
- Settle ưu tiên: **tokenpack (khớp baseModel + còn token + chưa hết hạn) → plan → ví PAYG**.

## Foza sẽ wire khi build xong

- UI mua pack trên card listing/model (chọn model → chọn 5M/10M → thanh toán → gọi
  `POST /provision/token-pack`).
- Trang keys/wallet hiển thị "còn 3.2M / 5M token — hết hạn DD/MM" từ `tokenPacks`.
- Idempotent qua khóa thanh toán.

> Build theo OpenSpec `marketplace-token-packs`. 4 quyết định trên đã chốt — không còn
> chờ gì từ Foza. Báo khi merge + cho biết shape cuối nếu có khác file này.

---

## Phụ lục — quyết định gốc
| # | Câu hỏi | Chốt |
|---|---|---|
| 1 | Token gộp hay tách | **Gộp** prompt+completion |
| 2 | TTL | **12 tháng** (Foza gửi expiresAt) |
| 3 | Request > pack | **Không xé lẻ** → rơi về plan/ví |
| 4 | Seller credit | **Theo model, route tự do** |
