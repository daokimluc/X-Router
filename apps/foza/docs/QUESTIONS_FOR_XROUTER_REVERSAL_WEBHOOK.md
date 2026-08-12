# Câu hỏi cho X-Router — reversal không về được sổ tiền của Foza

> ✅ **ĐÃ GIẢI QUYẾT (X-Router v0.6.3).** Trả lời: `ANSWERS_FROM_XROUTER_TOPUP_REVERSAL.md`.
> X-Router làm CẢ webhook `settlement.reversed` LẪN query `?reversedSince=` (lọc theo
> `reversedAt`). Foza đã wire: webhook → `ledger.markReversed`; reconcile sweep dùng
> `reversedSince` + checkpoint `lastReversedAt` (đã bỏ hack lookback 7 ngày). Giữ file
> này làm lịch sử.

---

> Bối cảnh: audit money-path 2026-06-01 phát hiện một lỗ HIGH — khi X-Router
> **reverse** một settlement (hoàn tiền / clawback), Foza **không bao giờ biết**,
> nên sổ tiền Foza bị **thổi phồng**: buyer spend, seller payable, và platform
> margin đều cao hơn thực tế. Seller có thể bị trả tiền (markPaid) cho phần
> usage đã bị thu hồi.

## Hiện trạng đã verify trong code X-Router

1. **Reverse KHÔNG phát webhook.** `BUSINESS_EVENTS` (`marketplace/routes/provision.ts:517`)
   chỉ gồm: `usage.recorded`, `grant.exhausted`, `wallet.low`, `quota.blocked`,
   `supply.unhealthy`, `plan.renewed`, `plan.downgraded`. **Không có** sự kiện
   reversal. `SettlementLedger.reverseSettlement()`
   (`marketplace/services/SettlementLedger.ts:125`) chỉ set `reversed = 1` +
   unwind ví/earnings/margin nội bộ — không gọi webhookService.

2. **`GET /provision/settlements?since=` lọc theo `ts` GỐC.** Query dùng
   `WHERE ts >= ?` với `ts` = thời điểm settle ban đầu (`SettlementLedger.query()`
   `:334`). Một reversal **không đổi `ts`** (chỉ flip cờ `reversed`), nên một khi
   checkpoint reconcile của Foza đã vượt qua `ts` của settlement đó, lần reverse
   sau này nằm **vĩnh viễn ngoài cửa sổ** → `markReversed` của Foza không bao giờ
   chạy.

→ Hệ quả: settlement bị reverse sau khi reconcile đã đi qua nó = Foza giữ mãi
con số gross sai. Tiền bị thổi phồng cho tới khi có người sửa tay.

## Foza đã làm gì để giảm thiểu (chưa đủ)

- `reconcile.ts` giờ **re-scan lùi 7 ngày** trước checkpoint mỗi lần chạy
  (`REVERSAL_LOOKBACK_MS`). `upsertSettlement` đồng bộ lại cờ `reversed` trên
  hàng đã fold (idempotent), nên reversal **trong vòng 7 ngày** sẽ được bắt khi
  reconcile chạy.
- Nhưng đây chỉ là **chặn dưới**: reversal **cũ hơn 7 ngày**, hoặc nếu reconcile
  không được chạy định kỳ (hiện tại là **thủ công**, không có cron), vẫn lọt.

## Mong X-Router làm một trong hai (ưu tiên #1)

**Phương án 1 — phát webhook reversal (mong muốn nhất).**
Thêm event `settlement.reversed` (hoặc `usage.reversed`) vào `BUSINESS_EVENTS`,
phát trong `reverseSettlement()` sau khi commit, payload tối thiểu:

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
    "reason": "..."
  }
}
```

Foza sẽ thêm case `settlement.reversed` vào `api/webhooks/xrouter/route.ts` →
`ledger.markReversed(settlementId)` (đã có sẵn, idempotent). Đây là cách realtime,
sạch nhất.

**Phương án 2 — cho query theo thời điểm reversal.**
Nếu không muốn thêm webhook: thêm cột `reversedAt` (epoch-ms) và cho
`GET /provision/settlements` nhận `reversedSince=` (hoặc một flag
`includeReversedSince=`) lọc theo `reversedAt`. Khi đó reconnect của Foza có thể
quét riêng các reversal mới mà không phụ thuộc `ts` gốc, và lookback 7 ngày có
thể bỏ.

## Câu hỏi cụ thể

1. Chọn được phương án nào? (Foza nghiêng về #1 — webhook.)
2. Nếu #1: tên event chốt là gì (`settlement.reversed`?), payload có đủ
   `collected/sellerCredit/platformMargin` để Foza reconcile không, hay Foza chỉ
   cần `settlementId` rồi tự tra lại?
3. Reverse có idempotent ở phía X-Router không (reverse 2 lần cùng settlement)?
   Webhook có được phát lại khi retry không (để Foza dedupe theo `settlementId`)?
4. Có kế hoạch cho reconcile chạy tự động (cron) phía nào không — hay Foza tự lo?
