# Trả lời (cập nhật) — thu phí plan: SUBSCRIPTION định kỳ tự renew

> Cập nhật theo chốt của chủ sản phẩm cho ANSWERS_FROM_XROUTER_PLAN_BILLING.md:
> - **Q2 = ĐỊNH KỲ**: plan tự auto-renew hàng tháng, mỗi kỳ trừ `priceUsd` từ ví nếu đủ.
>   Quota không cộng dồn (reset mỗi tháng — đúng hành vi bucket hiện tại).
> - **Q3 = đã rõ**: buyer trả $10 nhưng được hưởng quota công bố (~lợi ích $20); vượt → trừ
>   ví. → data hiện tại (`priceUsd:10`, `buckets.monthUsd:20`) ĐÚNG SẴN, không đổi.
>
> Đây là thiết kế cuối để build. CHƯA build; xác nhận vài chốt nhỏ ở cuối là tôi làm.

## Mô hình chốt

| | |
|---|---|
| Đăng ký | thu `priceUsd` ngay (lần đầu), đủ tiền mới gán plan; thiếu → 402 |
| Mỗi tháng | tự renew: trừ `priceUsd` lần nữa nếu ví đủ |
| Ví không đủ lúc renew | **hạ về Free** (gỡ plan), ngừng thu — không nợ |
| Quota | reset mỗi kỳ, KHÔNG cộng dồn (đã đúng — bucket rolling theo `monthKey`) |
| Vượt quota trong kỳ | trừ ví PAYG (`overageEnabled`, đã có) |
| `priceUsd` vs `buckets` | độc lập: $10 = phí/kỳ; $20 = hạn mức token/kỳ được hưởng |

## Kiến trúc renewal — lazy + monitor (không phụ thuộc một cron cứng)

X-Router đã có sẵn mẫu: background monitor (`SupplyHealthMonitor`, started trong
`registerMarketplace`, stopped onClose, `scan()` public để test) + lazy rollover
(`SpendLedgerService` reset bucket theo `monthKey` khi truy cập — "no cron needed"). Tôi
sẽ kết hợp **cả hai** để renewal vừa chính xác vừa không lệ thuộc tiến trình phải sống đủ
lâu:

1. **State trên key:** thêm `planChargedAt` (lần thu gần nhất) + `planPeriodEnd` (mốc hết
   kỳ) vào key record (key đã có `planId`). Lưu ở SQLite config store như mọi key field.
2. **Lazy check lúc dùng (đường chính, không cần tiến trình chạy nền):** trong
   `marketplacePolicyCheck` (đã chạy mỗi request có plan), nếu `now >= planPeriodEnd` →
   thử renew NGAY tại đó: `hasFundsUsd(priceUsd)` → `debitUsd` → đẩy `planPeriodEnd` sang
   kỳ kế; thiếu tiền → hạ key về Free + trả 402 "plan expired, top up to renew". → renewal
   xảy ra đúng khoảnh khắc user dùng, không cần monitor.
3. **Monitor quét nền (đường phụ, cho key KHÔNG có traffic):** `PlanRenewalMonitor` (sao y
   `SupplyHealthMonitor`) chạy mỗi ~giờ, quét key có `planPeriodEnd` đã qua → renew hoặc
   hạ Free, kèm webhook `plan.renewed` / `plan.downgraded`. Để key ngủ vẫn bị thu/hạ đúng,
   và Foza nhận sự kiện cập nhật UI.

→ Lazy là nguồn sự thật (idempotent theo `planPeriodEnd`); monitor chỉ là "đẩy sớm" cho
key im lặng. Hai đường KHÔNG double-charge vì cùng guard `now >= planPeriodEnd` + sau khi
thu thì đẩy mốc tới — đường còn lại thấy chưa tới hạn → bỏ qua.

## Vì sao không chỉ dùng một cron đơn thuần

Nếu chỉ cron: tiến trình tắt qua mốc renew (máy bạn tắt máy/restart) → kỳ đó không thu,
hoặc cron chạy trễ thu sai thời điểm. Lazy-on-use khử rủi ro đó: dù gateway ngủ bao lâu,
lần request đầu sau khi quá hạn sẽ renew đúng (hoặc chặn nếu thiếu tiền). Monitor chỉ phủ
trường hợp key không bao giờ gọi nhưng vẫn cần hạ Free.

## Thu phí (atomic, idempotent) — như bản trước, thêm chu kỳ

Đăng ký (lần đầu) giữ nguyên thiết kế bản trước:
- `priceUsd===0` (Free) → gán, không thu.
- re-grant cùng plan trong KỲ → không thu lại (idempotent theo `planPeriodEnd`, không chỉ
  theo planId).
- `priceUsd>0`: `hasFundsUsd`→402 nếu thiếu; `debitUsd` lý do `plan_subscribe:<planId>` →
  set `planChargedAt=now`, `planPeriodEnd=now+1 tháng` → gán plan. Tất cả 1 transaction.

Renew (lazy/monitor): `debitUsd` lý do `plan_renew:<planId>` → đẩy `planPeriodEnd += 1
tháng`. Thiếu tiền → `planId=null` (về Free) + webhook `plan.downgraded`.

## Đổi plan / hủy (cập nhật theo định kỳ)

- **Đổi plan:** thu full `priceUsd` plan mới ngay + reset kỳ mới (`planPeriodEnd=now+1
  tháng`). KHÔNG prorate/hoàn plan cũ (v1). Idempotent: đổi sang đúng plan đang có trong
  kỳ → không thu.
- **Hủy:** `setKeyPlan(null)` → gỡ plan, ngừng renew. **Không hoàn** phần còn lại của kỳ
  (giữ quyền tới khi gỡ, phí đã thu là mất) — v1.

## Foza sẽ thấy gì

- `GET /provision/keys` / `wallet` kèm `planId`, `planPeriodEnd`, `planChargedAt` → UI
  hiển thị "Claude $10/tháng · gia hạn DD/MM · còn $X ví".
- Webhook mới: `plan.renewed` (đã thu kỳ mới), `plan.downgraded` (ví thiếu → về Free) →
  Foza cập nhật UI + thông báo user nạp tiền.
- 402 `insufficient_funds` lúc đăng ký/đổi (kèm `requiredUsd`,`balanceUsd`).

## Tôi build gì (nếu chốt)

1. **Key fields** `planChargedAt`, `planPeriodEnd` (+ persist).
2. **Charge-on-grant** atomic (như bản trước) + set kỳ.
3. **Lazy renew** trong `marketplacePolicyCheck`: quá hạn → renew/đẩy mốc hoặc hạ Free+402.
4. **`PlanRenewalMonitor`** (sao `SupplyHealthMonitor`): quét key quá hạn, renew/hạ Free,
   emit `plan.renewed`/`plan.downgraded`. Started/stopped trong `registerMarketplace`.
5. **Webhook events** `plan.renewed`, `plan.downgraded` (thêm vào BUSINESS_EVENTS).
6. **Response/read**: planPeriodEnd ra `/provision/keys`.
7. **Tests:** đăng ký đủ/thiếu tiền; renew lazy khi quá hạn đủ tiền → thu + đẩy mốc;
   renew thiếu tiền → về Free + webhook; không double-charge (lazy + monitor cùng kỳ);
   đổi plan thu plan mới; hủy không hoàn; idempotent trong kỳ.

OpenSpec change `marketplace-plan-subscription`, cô lập trong `marketplace/`. Đụng
`marketplacePolicyCheck` (thêm nhánh renew trước nhánh bucket hiện có) nhưng KHÔNG đổi
logic reserve/settle đang chạy.

## Vài chốt nhỏ cuối (để build chính xác)

1. **Chu kỳ = đúng 1 tháng lịch** (vd thu ngày 15 → hết hạn 15 tháng sau), hay 30 ngày cố
   định? (Đề xuất: 1 tháng lịch, khớp `monthUsd` reset theo `monthKey` UTC.)
2. **Renew thiếu tiền:** hạ thẳng về **Free** (đề xuất) hay **tạm khóa plan** (giữ planId
   nhưng chặn tới khi nạp)? Hạ Free đơn giản hơn cho user (vẫn xài Free).
3. **Mốc renew vs reset quota:** quota bucket reset theo `monthKey` UTC (mốc lịch tháng),
   còn renew theo `planPeriodEnd` (mốc đăng ký). Hai mốc LỆCH nhau (đăng ký ngày 15 nhưng
   quota reset ngày 1). Chấp nhận lệch (đơn giản), hay muốn căn renew trùng mốc reset
   quota? (Đề xuất v1: chấp nhận lệch — quota "tháng lịch", phí "tháng từ ngày đăng ký".
   Nếu muốn trùng thì quota cũng phải tính theo planPeriodEnd — phức tạp hơn.)

> Riêng điểm 3 hơi tinh tế về trải nghiệm — nếu chủ sản phẩm muốn "đúng 1 tháng kể từ ngày
> mua cho cả phí lẫn quota" thì tôi cần đổi cả cách tính quota (không dùng monthKey lịch
> nữa). Cho biết để tôi làm đúng ngay từ đầu.
