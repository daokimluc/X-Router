# Foza xác nhận — §C đã wire xong, §D dùng `adjust` sẵn có

> Trả lời `ANSWERS_FROM_XROUTER_REPLY_FOLLOWUP.md`. Cảm ơn team. Foza đã verify cả 3 thay
> đổi trong **source v0.6.3** (không chỉ đọc doc) và wire xong. tsc + eslint sạch.

## §C.1 — Reversal: ĐÃ WIRE ✅
Verify trong v0.6.3: `settlement.reversed` ở `BUSINESS_EVENTS` (provision.ts:530), phát
1 lần post-commit (`SettlementLedger.ts:230-232`, payload đủ `reversedAt`+`billTrack`,
idempotent); `?reversedSince=` lọc theo `reversed_at` (query:404), row có `reversedAt`.

Foza đã wire:
- **Realtime:** webhook route bắt `settlement.reversed` → `ledger.markReversed(settlementId)`.
  Dedupe key namespace `reversed:<settlementId>` (nếu để trùng `settlementId` trần sẽ bị coi
  là duplicate của `usage.recorded` gốc → reversal bị bỏ — đã tránh).
- **Catch-up:** `reconcile.ts` BỎ hack lookback 7 ngày, thay bằng 2 sweep độc lập: forward
  (`since`=lastSettledAt) + reversal (`reversedSince`=checkpoint `lastReversedAt`, đẩy
  checkpoint = max(`reversedAt`)). Sweep reversal dùng upsert `reversed:true` để nếu Foza
  CHƯA fold settle gốc thì vẫn ghi nhận được reversal (không lọt).
- Admin webhook config: events list giờ đủ 8 (thêm cả `plan.renewed`/`plan.downgraded` —
  trước đó route đã xử lý nhưng config chưa subscribe, nay vá luôn).

## §C.2 — wallet/topup idempotency: ĐÃ WIRE ✅
Verify: `idempotencyKey` optional (provision.ts:195 → `topupUsdIdempotent`), trả
`idempotent:true` khi trùng. Foza gửi `topup.id` làm key. Luồng SePay retry đã **nới đúng
như team gợi ý**: cả 2 path giờ idempotent → lỗi **tạm thời** (5xx/network) thả về pending +
retry; chỉ lỗi **vĩnh viễn** (4xx `amount_too_large`/`validation_error`) mới park `crediting`
+ ghi dedupe (chặn vòng lặp). Hết cảnh "money in, wallet chưa cộng, chờ reconcile tay".

## §D — clawback: dùng `adjust` sẵn có, KHÔNG cần code mới
Đã verify bộ endpoint tồn tại trong v0.6.3 (`earningsAdmin.ts`): `.../adjust {deltaUsd,reason}`,
`.../reverse {usd,reason}`, `.../reverse-payout`, `POST /admin/v1/settlements/:logId/reverse`.
Hiểu đúng: `unpaid` floor 0 nên không deadlock; reverse-sau-payout → `overPaidUsd>0 / ok=false`
hiện trên reconcile (cố ý không giấu); X-Router không tự offset — admin quyết (ăn lỗ / đòi
lại bằng `adjust(deltaUsd âm)` / trừ payout kỳ sau).

→ Foza tạm thời **chưa gọi** các endpoint này (chưa có UI clawback cho admin). Hiện đủ cho
luồng thủ công. Khi nào cần "sổ nợ tự offset thu nhập tương lai của seller" chính thức thì
Foza sẽ báo để team làm change riêng — **chưa cần bây giờ**.

## Việc còn lại (phía vận hành, không phải code) — ĐÃ LÀM XONG ✅
1. **Restart instance port 3100 lên v0.6.3** — XONG. Process cũ (start 9:59am) đang chạy
   **dist cũ** (dist v0.6.3 ghi lúc 2:16pm → đúng lỗi stale-dist). Đã restart → PID mới,
   SQLite auto-migrate v9, verify live: `reversedSince` nhận OK; `wallet/topup` +
   `idempotencyKey` → gọi lại trả `idempotent:true` (không cộng đôi). ✅
2. **Lịch chạy reconcile** — XONG (phía Foza). Đã thêm `src/instrumentation.ts` (Next 16
   `register()` hook) → scheduler `setInterval` (mặc định 300s, env `RECONCILE_INTERVAL_MS`),
   singleton + chống chạy chồng + không-ném-lỗi. Verify live: Foza boot log
   `[reconcile-scheduler] started`, sweep đầu chạy sạch. Webhook vẫn là realtime; cái này
   chỉ là backstop. **Không cần X-Router làm gì.**

## ⚠️ Một caveat phát hiện khi verify (đáng thêm guard ở X-Router)
`POST /provision/wallet/topup` **tạo ví ngay cả khi `keyId` KHÔNG tồn tại** — route không có
`findById` guard như `token-pack` / admin `refund` / admin `debit`. Khi mình probe bằng một
keyId rác, gateway tạo luôn một ví "ma" $1 trong `wallet_ledger`+`wallets`, và **không có
route nào xoá được** (refund/debit đều đòi key tồn tại → 404). Phải xoá tay 2 hàng trong
`gateway.sqlite`. Đề xuất: thêm `findById` guard cho `wallet/topup` → 404 nếu key không tồn
tại, để khỏi sinh ví mồ côi làm lệch solvency. (Không gấp — chỉ là hardening.)

> Tóm: tất cả việc thuộc X-Router đã xong (v0.6.3); Foza đã wire + deploy + thêm cron
> reconcile. Không còn câu hỏi mở. Chỉ còn 1 đề xuất guard nhỏ cho `wallet/topup` ở trên.
> Cảm ơn team đã ship nhanh.
