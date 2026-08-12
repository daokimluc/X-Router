# Trả lời Foza — §C đã DONE (v0.6.3), §D giải thích clawback

> Trả lời `REPLY_TO_XROUTER_MONEY_HARDENING.md`. Tin tốt: **2 việc ở §C (reversal
> webhook + topup idempotency) ĐÃ ĐƯỢC SHIP trong v0.6.3** — đúng sau khi các bạn
> verify trên v0.6.2. Foza verify đúng: trên v0.6.2 chúng CHƯA có; nhưng v0.6.3 (ra
> sau) đã có đủ. **Không cần Foza chờ thêm — chỉ cần trỏ tới gateway v0.6.3.** §D
> (clawback) trả lời ở dưới, không cần code mới.

---

## §C.1 — Reversal webhook: ĐÃ CÓ (v0.6.3) ✅

Đã verify live trong code v0.6.3:
- **Event `settlement.reversed`** đã nằm trong `BUSINESS_EVENTS` (`provision.ts`). Phát
  trong `reverseSettlement()` **sau khi commit**, payload:
  ```json
  { "event": "settlement.reversed", "timestamp": "<ISO>", "data": {
      "settlementId", "buyerKeyId", "sellerId",
      "collected", "sellerCredit", "platformMargin",
      "billTrack", "reason", "reversedAt" } }
  ```
  Idempotent: reverse lần 2 trên cùng settlement là no-op, **KHÔNG phát webhook lần 2**.
- **Thêm `reversedSince=` cho `/provision/settlements`** (làm CẢ hai phương án Foza nêu):
  trả các settlement đã reverse tại/sau mốc đó, sắp theo `reversed_at` — **độc lập `ts`
  gốc**, nên reversal cũ tới đâu vẫn bắt được, **bỏ được lookback 7 ngày**. Mỗi row giờ
  có thêm field `reversedAt` (epoch-ms | null). Cột mới `settlement_log.reversed_at`
  (Database v9, tự migrate).

→ Foza wire: subscribe `settlement.reversed` → `markReversed(settlementId)` (realtime); và/hoặc
reconcile bằng `GET /provision/settlements?reversedSince=<checkpoint>` rồi đẩy checkpoint =
max(`reversedAt`). Chi tiết đầy đủ: `ANSWERS_FROM_XROUTER_TOPUP_REVERSAL.md`.

## §C.2 — `wallet/topup` idempotencyKey: ĐÃ CÓ (v0.6.3) ✅

- `POST /provision/wallet/topup` nhận **`idempotencyKey` optional**. Có key → credit đúng
  1 lần (dedupe trên `wallet_ledger.idempotency_key` UNIQUE, trong 1 transaction); gọi lại
  cùng key → no-op, trả `{ keyId, walletUsd, idempotent: true }`. Không key → cộng dồn như
  cũ. TTL = **vĩnh viễn**.
- → Foza dùng `topup.id` làm `idempotencyKey` (đúng pattern token-pack). Luồng SePay giờ
  retry an toàn: lỗi mơ hồ → **thả row về pending + retry** thoải mái, gọi lại cùng key sẽ
  no-op nếu đã commit. Không còn double-credit, không cần reconcile tay.
- (Route admin `POST /admin/v1/api-keys/:id/topup` cũng nhận `idempotencyKey`.)

> **Lưu ý cho fix retry của Foza (§A.3):** giờ topup đã idempotent, nhánh "tạm thời +
> wallet topup → để `crediting` chờ reconcile tay" có thể nâng cấp thành "thả về pending +
> retry" giống token-pack. Lỗi **vĩnh viễn** (`amount_too_large` / `validation_error`) vẫn
> giữ logic chặn-vòng-lặp của Foza — đúng. Chỉ nhánh tạm-thời-topup là nới được.

---

## §D — Clawback / `amount_exceeds_unpaid` sau khi đã trả tiền

Câu hỏi rất đúng chỗ. Trả lời theo từng ý:

**1. Cap `amount_exceeds_unpaid` KHÔNG gây deadlock.** `unpaid` **không bao giờ âm** (floor
ở 0 mọi đường: `reverse`, `markPaid`, `adjust`). Khi seller kiếm credit mới, `unpaid` dương
lại và mark-paid khoản hợp lệ tiếp theo chạy bình thường. Cap chỉ chặn khi `unpaid = 0` —
đúng (không nên trả tiền khi đang không nợ ai).

**2. Tình huống "reverse sau khi đã payout" → `overPaidUsd > 0`.** Đây là khi platform đã
trả seller nhiều hơn số thực nợ (vd credit $10 → payout $10 → rồi reverse settlement $10).
`unpaid` floor ở 0 (không "đòi lại" được tiền đã wire), và `reconcileSeller` báo
**`ok=false` + `overPaidUsd=$10`** — cố ý KHÔNG giấu, để admin biết phải xử lý. X-Router
**không tự offset** khoản này (vì là quyết định nghiệp vụ: ăn lỗ hay trừ vào thu nhập sau).

**3. Đường "ghi nhận đã đòi lại / điều chỉnh" mà Foza hỏi — ĐÃ CÓ SẴN.** Endpoint:
```
POST /admin/v1/earnings/seller/:id/adjust   body: { deltaUsd, reason }
```
- `deltaUsd` âm → claw back thêm (ghi nhận "đã thu hồi khoản overpaid" — trừ vào lifetime +
  unpaid, floor 0, log `earnings_reversals kind=adjust`).
- `deltaUsd` dương → khôi phục unpaid (nếu cần trả bù).
- Ngoài ra: `POST /admin/v1/earnings/seller/:id/reverse` (clawback theo settlement) và
  `.../reverse-payout` (khôi phục unpaid khi wire bank fail) — bộ ba này phủ mọi hướng điều
  chỉnh thủ công.

**Khuyến nghị luồng clawback (v1, dùng công cụ sẵn có):**
- Reverse settlement → `overPaidUsd` hiện trên reconcile → admin quyết: **(a) ăn lỗ** (không
  làm gì, seller giữ khoản đã trả; reconcile vẫn flag để audit thấy), hoặc **(b) đòi lại**
  (thu tiền thật ngoài hệ thống rồi `adjust(deltaUsd âm)` để khử `overPaidUsd`, hoặc trừ vào
  payout kỳ sau bằng cách mark-paid ít hơn unpaid).
- X-Router cố ý để admin quyết — không tự trừ vào thu nhập tương lai của seller.

→ **Không cần code mới cho §D.** Nếu Foza muốn một semantic clawback chính thức hơn (vd một
"sổ nợ" tự offset thu nhập tương lai của seller, hoặc một endpoint `clawback` chuyên dụng
khác với `adjust`), báo — đó là tính năng mới, sẽ làm change riêng. Còn building blocks hiện
tại đã đủ cho luồng thủ công.

---

## §A / §B — đã ghi nhận
- §A.1/§A.2 (bắt lỗi theo `code`, mark-paid idempotent 2 lớp + luôn gửi `payoutRef`): chuẩn.
- §A.3 (sửa bug retry vòng lặp do phân biệt lỗi vĩnh viễn vs tạm thời): chính xác — xem lưu
  ý ở §C.2, nhánh topup giờ nới được sang retry.
- §B (không gắn planId lúc tạo key; cap nằm trong; chưa dùng reconcile admin): OK, không cần
  team làm gì.

---

## Phiên bản
- **v0.6.3** đã ship (commit `f9e4a49`, tag `v0.6.3`, push origin/main, publish GitHub
  Packages). SQLite schema **v9**. `npx openspec list` = không còn change mở.
- Instance vận hành (port 3100) cần **restart** để lên v0.6.3 (+ auto-migrate v9, additive).

> Tóm: **§C.1 + §C.2 = DONE ở v0.6.3** (Foza chỉ cần trỏ tới gateway v0.6.3 + wire theo
> `ANSWERS_FROM_XROUTER_TOPUP_REVERSAL.md`). **§D = dùng `adjust` endpoint sẵn có** cho
> clawback thủ công; báo nếu muốn semantic tự-offset chính thức (làm change riêng).
