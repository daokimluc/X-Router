# Câu hỏi cho X-Router — thu phí khi đăng ký plan (paid plan charge)

> Bối cảnh: Foza phát hiện user **ví 0 USD vẫn đăng ký được plan trả phí** (vd "Claude
> $10"). Đào code thì việc grant plan KHÔNG thu tiền — đây là lỗ hổng business logic, và
> phần thu tiền nằm ở X-Router (Foza không tự trừ ví được). Mô tả mô hình mong muốn +
> câu hỏi cách implement bên dưới.

## Mô hình Foza muốn (chốt với chủ sản phẩm)

- **Plan là gói TRẢ PHÍ** (trừ Free = $0). Đăng ký "Claude $10" → **thu $10 từ ví ngay**.
- Sau khi trả, buyer được dùng **đúng quota công bố của gói** (bucket giờ/ngày/tháng).
- **Vượt quota → trừ ví** theo PAYG (chính là `overageEnabled` đã có).
- Ví không đủ tiền gói → **đăng ký bị từ chối** (không cho lấy quota miễn phí).

## Hiện trạng đã verify trong code (vì sao 0 USD vẫn đăng ký được)

- `POST /provision/grant` (`marketplace/routes/provision.ts`) chỉ
  `apiKeyService.update({ planId, overageEnabled, paygDailyLimitUsd })` — **KHÔNG
  charge/debit/reserve gì**. Grep trong handler: không có chữ charge/debit/wallet/priceUsd.
- `plan.priceUsd` ($10/$20 — `PlanService.ts:39-41`) chỉ là **metadata hiển thị**, không
  được dùng để thu tiền ở bất kỳ đâu.
- Provision API chỉ có 3 lệnh ví/plan: `POST /provision/grant`, `POST /provision/wallet/topup`
  (NẠP), `GET /provision/wallet/:keyId` (đọc). **KHÔNG có lệnh TRỪ ví** → Foza không thể
  tự thu $10. Phải làm ở X-Router.
- WalletService có sẵn `debitUsd`, `hasFundsUsd`, `reserveUsd` (`marketplace/services/WalletService.ts`)
  — building block để thu phí đã có, chỉ chưa được nối vào luồng grant.

→ Hệ quả hiện tại: grant với ví 0 USD **thành công**, nhưng lúc GỌI model thật sẽ bị chặn
ở `reserveUsd`/`hasFundsUsd` (402). User "có plan" mà không gọi được gì — và quan trọng:
**chưa trả tiền gói mà vẫn được gán quota**.

## Câu hỏi / đề xuất

**1. X-Router thêm bước thu phí khi grant plan trả phí được không?** Đề xuất: `/provision/grant`
   (hoặc một lệnh mới `/provision/grant-paid`) khi `plan.priceUsd > 0`:
   - Check `hasFundsUsd(keyId, plan.priceUsd)` — không đủ → trả `402 insufficient_funds`
     (KHÔNG gán plan).
   - Đủ → `debitUsd(keyId, plan.priceUsd)` (ghi ledger lý do `plan_purchase`) RỒI mới
     `update({planId})`. Atomic: nếu debit fail thì không gán; nếu gán fail thì refund.
   - `plan.priceUsd === 0` (Free) → giữ nguyên hành vi cũ (gán không thu tiền).

**2. Chu kỳ thu phí — một lần hay hàng tháng?** Foza muốn rõ: $10 là phí **một lần lúc
   đăng ký**, hay **định kỳ hàng tháng** (subscription renew)? Nếu định kỳ thì X-Router
   cần cron/scheduler trừ ví mỗi kỳ + xử lý ví không đủ lúc renew (hạ về Free? tạm khóa
   plan?). Foza nghiêng: **giai đoạn đầu thu MỘT LẦN lúc đăng ký cho đơn giản**, renew để
   sau. Bạn thấy sao?

**3. Quan hệ `priceUsd` vs `buckets` (đang lệch — cần làm rõ):** plan Claude `priceUsd: 10`
   nhưng `buckets.monthUsd: 20` (`PlanService.ts:39`). Nghĩa là trả $10 được tiêu tới $20
   token/tháng? Hay $10 chỉ là phí "mở khóa" còn token vẫn trừ riêng? Foza cần hiểu đúng
   để hiển thị: "$10/tháng, gồm $X token, vượt thì trừ ví". Làm ơn xác nhận ý nghĩa
   chính xác của `priceUsd` so với `buckets`.

**4. Đổi plan (switch) tính tiền sao?** 1 key = 1 plan, đăng ký plan khác = ghi đè
   (`grant` overwrite). Nếu thu phí: đổi từ Claude $10 sang Pro $20 → thu thêm $20? Hoàn
   phần chưa dùng của plan cũ? Hay cấm đổi giữa kỳ? (Liên quan câu 2 — nếu thu một lần thì
   đổi = thu phí plan mới.)

**5. Hoàn tiền khi hủy?** `cancelPlan` (Foza đã có, gọi `setKeyPlan(null)`) — hủy giữa kỳ
   có hoàn phần chưa dùng không, hay mất? Đề xuất giai đoạn đầu: **không hoàn** (giữ tới
   hết kỳ / mất), cho đơn giản.

## Foza sẽ làm gì khi có

- Trước khi mở modal đăng ký: hiển thị "Phí: $10 — Số dư ví: $X". Nếu thiếu → nút "Nạp
  tiền" thay vì "Đăng ký".
- Bắt lỗi `402 insufficient_funds` từ grant → báo "Ví không đủ, vui lòng nạp $Y".
- Hiển thị rõ "$10/tháng" đúng nghĩa sau khi câu 3 được chốt.
- (Tiền nạp ví đi qua luồng top-up — hiện đang pending chờ cổng thanh toán thật, xem
  `vexa-webhook-admin-wallet-audit`.)

> Đây là tính năng money-path ở X-Router (charge lúc grant + có thể renew). Foza không tự
> làm được vì không có lệnh trừ ví qua provision. Cho biết hướng (một lần vs định kỳ) + ý
> nghĩa priceUsd/buckets, Foza wire phần UI + xử lý lỗi 402.

---

## Phụ lục — file:line

- Grant không thu tiền: `marketplace/routes/provision.ts` (`POST /provision/grant` → `apiKeyService.update`)
- priceUsd chỉ là metadata: `marketplace/services/PlanService.ts:22,38-41` (free=0, claude/codex=10, pro=20)
- Wallet building blocks (đã có, chưa nối): `marketplace/services/WalletService.ts` (`debitUsd`, `hasFundsUsd`, `reserveUsd`)
- Provision wallet/grant routes hiện có: `POST /provision/grant`, `POST /provision/wallet/topup`, `GET /provision/wallet/:keyId` (KHÔNG có debit)
