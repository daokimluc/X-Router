# Foza trả lời — money hardening v0.6.1/v0.6.2 + 2 câu hỏi CHƯA được trả lời

> Cảm ơn team. Đã đọc `ANSWERS_FROM_XROUTER_MONEY_HARDENING.md`. Foza đã wire xong
> phần action items (§1). Nhưng lưu ý: **doc này là đợt audit riêng của team, KHÔNG
> phải trả lời 2 câu hỏi Foza gửi trước đó** — cả 2 vẫn đang mở (mục §C bên dưới).
> Foza đã verify trực tiếp trong code v0.6.2 chứ không chỉ đọc doc.

## §A. Foza đã làm gì (xong, tsc + eslint sạch)

1. **Bắt mã lỗi theo `code`, không theo message.** Thêm `code?: string` vào
   `XRouterError` + đọc `body.error.code` trong client fetch. Giờ Foza branch theo
   `insufficient_funds` / `amount_too_large` / `amount_exceeds_unpaid` ổn định.

2. **mark-paid:** xử lý `amount_exceeds_unpaid` (400) → báo admin "vượt số đang nợ"
   thay vì lỗi chung. Giờ idempotent **hai lớp**: `claimPayout` của Foza + payoutRef
   của gateway. Foza **luôn gửi `payoutRef`** (đã làm từ trước).

3. **Sửa một BUG ở luồng SePay do chính các cap mới làm lộ ra.** Trước đó code SePay
   của Foza coi MỌI lỗi 4xx là "thả row về pending để retry". Nhưng `amount_too_large`
   / `validation_error` là lỗi **vĩnh viễn** — retry sẽ lặp vô hạn (SePay POST lại →
   cùng 400 → thả pending → POST lại…). Đã sửa: phân biệt
   - **vĩnh viễn (4xx):** ghi dedupe key + để row ở `crediting` cho reconcile tay (chặn vòng lặp);
   - **tạm thời + token-pack (idempotent):** thả về pending để retry an toàn;
   - **tạm thời + wallet topup (CHƯA idempotent):** để `crediting` chờ reconcile tay (xem §C.2).

## §B. Đã verify (không cần team làm gì thêm)

- §1.4 (key gắn paid plan phải có tiền): Foza **không bị ảnh hưởng** — không bao giờ
  gắn planId lúc tạo key (`createKey({label})` thôi), subscribe luôn qua
  `/provision/grant` (đã thu tiền đúng từ v0.5.0). OK.
- Các cap token-pack/topup: Foza clamp sẵn {1M,5M,10M} + TTL 12 tháng + MAX_TOPUP
  $10k — đều **nằm trong** cap của gateway, nên action thường không chạm. Chỉ giữ
  để hiển thị lỗi đẹp nếu có.
- Reconcile admin endpoints (`/admin/v1/marketplace/reconcile/*`): Foza **không gọi**
  — Foza có reconcile riêng trên `/provision/settlements`. Field `packs`/`overPaidUsd`
  mới ghi nhận, chưa dùng.

## §C. ⚠️ 2 câu hỏi Foza gửi trước — VẪN CHƯA được trả lời

Đã verify trong code v0.6.2:

**C.1 — Reversal webhook (HIGH).** `BUSINESS_EVENTS` (`provision.ts:520`) **vẫn** chỉ
có 7 event cũ, KHÔNG có `settlement.reversed`. `/provision/settlements` vẫn lọc theo
`ts` gốc (`SettlementLedger.query` `WHERE ts >= ?`), reversal không đổi `ts`.
→ Reversal một settlement sau khi reconnect của Foza đã đi qua nó vẫn **lọt vĩnh viễn**.
Foza đã vá tạm bằng lookback 7 ngày, nhưng reversal cũ hơn 7 ngày vẫn sai số.
**Chi tiết + đề xuất: `docs/QUESTIONS_FOR_XROUTER_REVERSAL_WEBHOOK.md`.** Xin team chọn:
thêm event `settlement.reversed` HOẶC cho query `reversedSince=`.

**C.2 — `wallet/topup` idempotencyKey (MEDIUM).** `provision.ts:194-202` đã thêm cap
`amount_too_large` nhưng **vẫn cộng dồn mỗi lần gọi**, KHÔNG có `idempotencyKey`
(khác hẳn token-pack đã idempotent). Hệ quả: khi credit ví lỗi mơ hồ (5xx/timeout —
có thể gateway đã commit nhưng mất response), Foza **không dám** auto-retry (sợ credit
2 lần) → phải để row `crediting` chờ reconcile tay. Tiền đã về bank mà ví chưa cộng.
**Chi tiết: `docs/QUESTIONS_FOR_XROUTER_WALLET_TOPUP_IDEMPOTENCY.md`.** Xin thêm
`idempotencyKey` optional cho `wallet/topup` (Foza sẽ dùng `topup.id`), dedupe giống
token-pack.

## §D. Một câu hỏi nhỏ mới

`amount_exceeds_unpaid` ở mark-paid là **chặn cứng**: nếu seller bị reverse một
settlement SAU khi đã được trả tiền (tình huống `overPaidUsd > 0` mà doc §2.3 nhắc),
thì `unpaid` có thể về 0 hoặc âm — admin sẽ không thể mark-paid khoản hợp lệ tiếp theo
cho tới khi nợ dương lại. Đây có phải hành vi mong muốn không, hay nên cho admin một
đường ghi nhận "đã đòi lại / điều chỉnh"? (Không gấp — chỉ muốn rõ luồng clawback.)

---
**Tóm lại:** Foza đã wire xong v0.6.1/v0.6.2 và sửa thêm 1 bug retry do cap mới lộ ra.
Còn **2 việc cần team x-router** (C.1 reversal webhook, C.2 wallet/topup idempotency)
vẫn đang chờ — đây là phần Foza KHÔNG tự làm được, phải sửa ở gateway.
