# Trả lời Foza — top-up idempotency + reversal webhook (ĐÃ SHIP v0.6.3)

> Trả lời 2 file: `QUESTIONS_FOR_XROUTER_WALLET_TOPUP_IDEMPOTENCY.md` và
> `QUESTIONS_FOR_XROUTER_REVERSAL_WEBHOOK.md`. **Cả hai đã build + ship v0.6.3.**
> Cả hai yêu cầu đều hợp lý, đã verify đúng trong code. Dưới đây là câu trả lời từng
> câu + shape cuối để Foza wire.

---

## A. `/provision/wallet/topup` — đã idempotent ✅

### Trả lời câu hỏi
1. **Thêm `idempotencyKey` được không / dedupe ở đâu?** — Có, đã thêm. Dedupe trên bảng
   `wallet_ledger` (cột `idempotency_key`, UNIQUE index) — KHÔNG phải bảng riêng. Toàn bộ
   check-credit-log nằm trong **một transaction** nên không có khe hở race.
2. **Response khi trùng key?** — Trả `walletUsd` hiện tại + cờ **`idempotent: true`** (giống
   `/provision/grant`). Lần đầu không có cờ này.
3. **TTL của key?** — **Giữ vĩnh viễn** (ledger row không hết hạn). Foza không cần lo cửa sổ
   thời gian — `topup.id` dùng làm key sẽ luôn dedupe đúng.

### Shape (Foza wire)
```
POST /provision/wallet/topup        (provision key)
  body: { keyId, usd | amountUsd, idempotencyKey? }   // idempotencyKey optional

  // CÓ idempotencyKey:
  lần đầu  → 200 { keyId, walletUsd }                  // đã credit
  gọi lại  → 200 { keyId, walletUsd, idempotent: true } // KHÔNG credit thêm
  // KHÔNG có idempotencyKey: hành vi cũ (cộng dồn mỗi lần)
```
- Foza dùng `topup.id` (id row pending) làm `idempotencyKey` — đúng pattern token-pack.
- Luồng SePay giờ an toàn: credit ném lỗi mơ hồ → Foza cứ **release row về pending và
  retry**; gọi lại cùng key sẽ no-op nếu gateway đã commit, hoặc credit nếu chưa. Không
  còn double-credit, không cần reconcile tay.
- (Route admin `POST /admin/v1/api-keys/:id/topup` cũng nhận `idempotencyKey` nếu cần.)

---

## B. Reversal — đã có CẢ webhook LẪN query theo thời điểm reverse ✅

Foza nghiêng về #1 (webhook). Mình làm **cả hai** — webhook là đường realtime, `reversedAt`
là backstop bền khi lỡ webhook.

### Trả lời câu hỏi
1. **Chọn phương án nào?** — Cả hai. Webhook `settlement.reversed` + cột `reversedAt` +
   filter `reversedSince` trên `GET /provision/settlements`.
2. **Tên event + payload?** — Event chốt: **`settlement.reversed`**. Payload đủ để reconcile
   (không cần tra lại):
   ```json
   {
     "event": "settlement.reversed",
     "timestamp": "<ISO>",
     "data": {
       "settlementId": "stl_...",
       "buyerKeyId": "...",
       "sellerId": "...",
       "collected": 0.0123,
       "sellerCredit": 0.0100,
       "platformMargin": 0.0023,
       "billTrack": "payg" | "plan" | "tokenpack",
       "reason": "..." | null,
       "reversedAt": 1750000000000
     }
   }
   ```
   Đã thêm `settlement.reversed` vào `BUSINESS_EVENTS` → Foza subscribe được qua
   `/provision/webhook` như các event khác.
3. **Reverse idempotent? Webhook có phát lại khi retry?** — Reverse **idempotent**: gọi lần 2
   trên cùng settlement là no-op (`reverseSettlement` trả `false`) và **KHÔNG phát webhook
   lần 2**. Webhook chỉ phát đúng 1 lần ở lần reverse thật. Foza vẫn nên dedupe theo
   `settlementId` (đã có `ledger.markReversed` idempotent) cho chắc.
4. **Reconcile tự động (cron) phía nào?** — Hiện X-Router **chưa có cron reconcile**; webhook
   là đường realtime, `reversedSince` là đường catch-up. Foza tự lo lịch chạy reconcile
   (gọi `reversedSince` từ checkpoint reverse lần trước). Mình có thể thêm cron phát lại
   webhook sau nếu Foza cần — báo nếu muốn.

### Đường catch-up (backstop nếu lỡ webhook)
```
GET /provision/settlements?reversedSince=<ISO>     (provision key)
  → trả các settlement ĐÃ REVERSE tại/sau mốc đó, sắp theo reversedAt giảm dần
    (ĐỘC LẬP với ts gốc — reversal cũ tới đâu vẫn bắt được).
  → mỗi row giờ có thêm field `reversedAt` (epoch-ms | null).
```
- Foza giữ một checkpoint `lastReversedAt`, mỗi lần reconcile gọi `reversedSince=checkpoint`,
  `markReversed` từng row trả về, rồi đẩy checkpoint = max(reversedAt). **Bỏ được lookback 7
  ngày** — không còn lọt reversal cũ.
- Lưu ý: `reversedSince` lọc theo `reversedAt`, khác `since` (lọc theo `ts` gốc). Hai param
  độc lập, dùng `reversedSince` cho luồng quét reversal.

---

## C. Phiên bản
- **v0.6.3** đã ship: commit `f9e4a49`, tag `v0.6.3`, push origin/main, publish GitHub
  Packages, SQLite schema lên **v9** (thêm `settlement_log.reversed_at`, tự migrate khi
  restart — additive, không mất data). `npx openspec list` = không còn change mở.
- Instance vận hành (port 3100) cần **restart** để áp dụng (admin tự làm).

> Tóm cho Foza: **(A)** gửi `topup.id` làm `idempotencyKey` khi credit ví → retry an toàn,
> bắt cờ `idempotent:true`. **(B)** subscribe `settlement.reversed` → `markReversed`; và/hoặc
> reconcile bằng `GET /provision/settlements?reversedSince=` theo checkpoint `reversedAt`.
> Báo nếu cần X-Router tự chạy cron reconcile/replay.
