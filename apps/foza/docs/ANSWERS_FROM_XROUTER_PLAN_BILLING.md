# Trả lời từ X-Router — thu phí khi đăng ký plan

> Người trả lời: X-Router engine. Bám code thật. Đây là **bug business-logic có thật**
> (đã xác nhận) + thiết kế cách thu phí. Phần thu tiền PHẢI ở X-Router (Foza đúng — không
> có lệnh trừ ví qua provision). CHƯA build; báo chốt vài quyết định là tôi làm.

## TL;DR

- **Bug có thật, xác nhận:** `/provision/grant` chỉ `apiKeyService.update({planId})` —
  KHÔNG charge. `plan.priceUsd` chỉ là metadata hiển thị, không thu ở đâu cả. → ví $0 vẫn
  "đăng ký" được plan $10. Đúng như Foza đào ra.
- **Sẽ fix:** thêm bước charge atomic vào grant khi `priceUsd > 0` (check funds → debit →
  gán plan; thiếu tiền → 402, không gán). Free ($0) giữ nguyên.
- **Q3 (priceUsd vs buckets) — đây là điểm cốt lõi cần làm rõ:** hai cái **độc lập**.
  `priceUsd` = **phí mở khóa/kỳ**; `buckets.monthUsd` = **trần token-usage/tháng** (rolling,
  tự reset mỗi tháng). KHÔNG phải "trả $10 tiêu $20" theo kiểu trừ dần — xem chi tiết dưới.
- **Q2 (một lần vs định kỳ):** đề xuất **v1 thu MỘT LẦN lúc đăng ký** (đồng ý Foza). NHƯNG
  có một mâu thuẫn khái niệm với buckets reset hàng tháng — phải xử lý, nêu rõ bên dưới.

## 1. Thêm charge vào grant — được, atomic

Building block đã có: `WalletService.hasFundsUsd`, `debitUsd` (floor-at-zero, ok:false nếu
thiếu), và `tx()` transactional. Chỉ chưa nối vào grant.

Đề xuất: sửa thẳng `POST /provision/grant` (không cần lệnh mới — giữ 1 đường), khi
`plan.priceUsd > 0`:

```
1. plan.priceUsd === 0 (Free)        → gán plan, KHÔNG thu (như cũ).
2. Idempotent: key đã gắn đúng plan  → trả as-is, KHÔNG thu lại (tránh double-charge khi webhook retry).
3. priceUsd > 0:
   - !hasFundsUsd(keyId, priceUsd)    → 402 insufficient_funds, KHÔNG gán plan.
   - debitUsd(keyId, priceUsd)         → ghi wallet_ledger lý do "plan_purchase:<planId>"
   - rồi apiKeyService.update({planId})
   - bọc trong transaction: update fail → debit tự rollback (cùng tx). Không có cảnh "đã trừ tiền mà chưa gán".
```

Trả về kèm `charged: priceUsd, newBalanceUsd` để Foza hiển thị. settlement_log / wallet_ledger
có dòng `plan_purchase` để audit + reconcile.

**Idempotency quan trọng:** grant hiện đã idempotent khi cùng plan + không đổi gì
(`provision.ts:125`). Phải GIỮ: nếu Foza gọi lại grant cùng plan (webhook retry) thì
KHÔNG charge lần 2. Charge chỉ xảy ra khi planId THỰC SỰ đổi (hoặc lần đầu gán).

## 2. Một lần vs định kỳ — v1 một lần, nhưng phải khớp với buckets

Đồng ý **v1 thu một lần lúc đăng ký** cho đơn giản (renew/cron để sau). NHƯNG có mâu thuẫn
khái niệm phải xử lý, không né được:

`buckets.monthUsd` **tự reset mỗi tháng** (rolling, `SpendLedgerService` rollover theo
`monthKey`, không cron — `SpendLedgerService.ts:95`). Nghĩa là nếu thu phí MỘT LẦN nhưng
quota reset HÀNG THÁNG → user trả $10 một lần, rồi **mỗi tháng sau vẫn được full quota
miễn phí mãi mãi**. Đó là cho không.

→ Hai cách thoát, Foza chọn:
- **(A) v1 thực dụng:** thu một lần = "mở khóa plan", chấp nhận quota reset hàng tháng là
  "đặc tính giai đoạn đầu" (rộng rãi với user sớm). Đơn giản nhất, nhưng phải biết mình
  đang cho quota lặp lại miễn phí.
- **(B) đúng nghĩa subscription (khuyến nghị nếu plan thực sự là "/tháng"):** thu định kỳ.
  Cần thêm `planRenewsAt` trên key + một scheduler nhẹ (X-Router đã có cron primitive) trừ
  ví mỗi kỳ; ví không đủ lúc renew → hạ key về Free (hoặc disable plan). Phức tạp hơn nhưng
  khớp đúng "$10/tháng".

Foza nói nghiêng (A) cho giai đoạn đầu — OK, tôi build (A) trước, (B) là change riêng sau.
Nhưng UI phải nói đúng: nếu (A) thì đừng ghi "$10/tháng" (gây hiểu nhầm sẽ thu lại) — ghi
"$10 mở khóa, quota làm mới mỗi tháng" hoặc tương tự. Đây là lý do Q3 phải chốt trước Q2.

## 3. priceUsd vs buckets — ĐỘC LẬP (làm rõ)

Đây là hiểu lầm cần gỡ. Xác nhận từ code:

- `plan.priceUsd` ($10) = **phí** trả để có plan. HIỆN tại không thu ở đâu (đó là bug).
- `plan.buckets.{hourUsd,dayUsd,monthUsd}` = **trần USD-equivalent của token-usage** trong
  cửa sổ đó. Lúc gọi model, mỗi request `reserve` chi phí token ước lượng vào bucket
  (`marketplacePolicyCheck.ts:114`), `settle` chi phí thật sau khi xong. Bucket
  `monthUsd: 20` nghĩa là "được tiêu tới $20 giá-trị-token mỗi tháng trong quota gói".

→ Vậy "$10 tiêu $20 token" KHÔNG phải trừ-dần-từ-10. Đúng nghĩa là:
**"Trả $10 (phí gói) → được tiêu tới $20 giá-trị token/tháng trong hạn mức; vượt $20 →
trừ ví PAYG (nếu overageEnabled)."** $10 và $20 là hai con số khác vai trò: phí vs hạn mức.

(Vì sao buckets > priceUsd? Đó là chủ ý thương mại: bán gói $10 cho hạn mức $20 token =
khuyến mãi/bao cấp giá. X-Router không ép quan hệ giữa 2 số — admin tự đặt. Foza hiển thị:
"$10/kỳ · bao gồm tới $20 token/tháng · vượt: trừ ví".)

**Foza cần chốt cho UI:** xác nhận cách diễn đạt trên đúng ý chủ sản phẩm. Nếu chủ sản
phẩm muốn "$10 = tiêu đúng $10 token" thì chỉ cần set `buckets.monthUsd = 10` (đổi data,
không đổi code).

## 4. Đổi plan (switch)

1 key = 1 plan, grant ghi đè. Với charge (giả định v1 thu một lần):
- **Đề xuất v1:** đổi plan = **thu full phí plan mới**, KHÔNG hoàn phần plan cũ. Đơn giản,
  dễ hiểu, tránh tính prorate phức tạp giai đoạn đầu.
- Idempotent vẫn giữ: đổi sang ĐÚNG plan đang có → không thu.
- Cảnh báo Foza ở UI: "Đổi sang Pro $20 sẽ thu thêm $20, không hoàn phí gói hiện tại."

(Prorate/credit phần chưa dùng = change riêng sau, đi cùng (B) subscription nếu làm.)

## 5. Hoàn tiền khi hủy

`cancelPlan` (Foza gọi `setKeyPlan(null)`). Đề xuất **v1: KHÔNG hoàn** (giữ quyền tới khi
hủy, phí đã thu là mất) — đồng ý Foza, đơn giản. Hủy chỉ gỡ `planId`, không refund.
(Refund-on-cancel là change sau nếu cần.)

## Tôi sẽ build gì (nếu chốt)

1. **Charge-on-grant** trong `POST /provision/grant`: check `priceUsd`, idempotency-guard,
   `hasFundsUsd`→402, `debitUsd` lý do `plan_purchase:<planId>`, gán plan — tất cả trong 1
   transaction. Free + re-grant-cùng-plan không thu.
2. **Response** kèm `charged`, `newBalanceUsd`; `402 insufficient_funds` khi thiếu (kèm
   `requiredUsd`, `balanceUsd` để Foza hiện "nạp $Y").
3. **wallet_ledger** dòng `plan_purchase` (audit + reconcile qua `/provision/wallet/:keyId`
   ledger).
4. **Tests:** ví đủ → trừ đúng priceUsd + gán plan; ví thiếu → 402 + KHÔNG gán + KHÔNG trừ;
   Free → gán không thu; re-grant cùng plan → không thu lần 2 (idempotent); đổi plan → thu
   plan mới; debit+update atomic (giả lập update fail → tiền không mất).

OpenSpec change `marketplace-paid-plan-charge`, cô lập trong `marketplace/`, KHÔNG đụng
enforcement/settlement đang chạy — chỉ thêm bước charge ở grant. (Renew định kỳ = change
riêng nếu Foza chọn hướng B.)

## Cần Foza/chủ sản phẩm chốt trước khi build

1. **Q2:** v1 thu MỘT LẦN (hướng A) đúng chứ? — hay làm subscription định kỳ (B) luôn?
2. **Q3:** xác nhận `priceUsd` = phí mở khóa, `buckets.monthUsd` = hạn mức token/tháng
   (độc lập). Nếu chủ sản phẩm muốn "$10 = đúng $10 token" thì báo, tôi/bạn chỉ cần set
   `buckets.monthUsd=10` (đổi data).
3. **Q4:** đổi plan = thu full plan mới, không hoàn (đề xuất) — OK?
4. **Q5:** hủy không hoàn (đề xuất) — OK?

---

## Phụ lục — file:line

- Grant KHÔNG thu tiền (bug): `marketplace/routes/provision.ts:112-135` (`POST /provision/grant`)
- Idempotency hiện có (phải giữ khi thêm charge): `provision.ts:125`
- priceUsd metadata: `marketplace/services/PlanService.ts:22`; seed (free=0/claude=10/codex=10/pro=20): `PlanService.ts:38-41`
- Wallet building blocks (đã có): `marketplace/services/WalletService.ts:76` (`debitUsd`), `:90` (`hasFundsUsd`), `:64` (`topupUsd`), tx tại constructor
- Bucket reserve/settle khi gọi model: `marketplace/policy/marketplacePolicyCheck.ts:114`
- Bucket rolling reset theo tháng (không cron): `services/SpendLedgerService.ts:95`
