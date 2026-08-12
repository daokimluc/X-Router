# Câu hỏi cho X-Router — gói token cố định trả trước (prepaid token pack)

> Bối cảnh: trên Marketplace, buyer hiện chỉ có 2 cách trả tiền cho việc gọi model:
> (1) **plan** — phí/tháng, quota tính bằng **USD bucket** (giờ/ngày/tháng); (2) **ví
> PAYG** — nạp **USD**, mỗi request trừ theo token thật. Cả hai đều quy ra USD.
>
> Có user hỏi mua **cố định một lượng token** (vd "mua 5M / 10M token cho model X")
> rồi dùng dần. Tôi đã đọc code marketplace X-Router và xác nhận **hiện chưa có** khái
> niệm này — đây là câu hỏi liệu X-Router có thể/nên thêm, và nếu có thì shape thế nào.

## Hiện trạng đã verify trong code

- Mỗi request tính tiền per-token, không có "gói token":
  `MarketPricingService.sellCostForRequest(baseModel, cost, prompt, completion, cached)`
  = `sellPrice × tokens`.
- Settlement chọn 1 trong 2 track (`marketplace/policy/settlementHook.ts:101`):
  `const billTrack: "plan" | "payg" = payg ? "payg" : "plan"`. plan → trừ
  `spendLedgerService.settle(planRes.id, actualSellCost)` (USD bucket); payg → trừ ví.
- Ví **hoàn toàn theo USD** (`marketplace/services/WalletService.ts`): `getUsd`,
  `topupUsd`, `debitUsd`, `reserveUsd`, `settleUsd` — KHÔNG có số dư tính bằng token,
  KHÔNG có khái niệm "credits / token pack / prepaid units".
- Listing subscribe phía website chỉ là gắn model vào key để hiển thị; KHÔNG bind hợp
  đồng/giá. Buyer có key + có quyền (plan/ví) là gọi được — giá theo model.

→ "Mua 5M token" theo nghĩa **trả trước một lượng token cố định** chưa tồn tại. Gần nhất
là nạp ví USD ~ tương đương, nhưng USD đó dùng cho MỌI model (không khóa vào 5M token
của 1 model cụ thể) và đơn vị hiển thị là USD, không phải token.

## Câu hỏi / đề xuất

**1. X-Router có muốn hỗ trợ "prepaid token pack" không?** Tức buyer mua trước N token
   cho một model (hoặc một nhóm), trả tiền ngay, rồi tiêu dần — số dư hiển thị bằng
   **token** chứ không phải USD. Đây là mô hình nhiều LLM platform có (vd "10M tokens").

**2. Nếu có — đặt ở đâu trong kiến trúc hiện tại?** Vài hướng, tùy bạn thấy hợp:

   **(a) Token-grant gắn trên key** (song song với plan/wallet): thêm track thứ 3
   `billTrack: "tokenpack"`. Buyer mua → key có `{ baseModel (hoặc group), tokensRemaining }`.
   Settlement: nếu request khớp model của pack và còn token → trừ `promptTokens+completionTokens`
   khỏi `tokensRemaining` (KHÔNG đụng ví/plan); hết → rơi về plan/payg như cũ. Câu hỏi:
   - Giá lúc MUA tính sao? Cố định theo `sellPrice × N` tại thời điểm mua (lock giá), hay
     theo giá hiện hành lúc tiêu? (Prepaid thường lock giá lúc mua.)
   - Token tính gộp prompt+completion hay tách (completion thường đắt hơn)? Pack nên là
     "tổng token" hay 2 quota riêng?

   **(b) Wallet theo token thay vì USD**: thêm số dư token per (key, model). Nhưng ví hiện
   thuần USD nên đây là thay đổi lớn hơn (a).

   **(c) Coi pack là một "plan" đặc biệt**: plan có bucket tính bằng token thay vì USD,
   one-time thay vì hàng tháng. Tái dùng `spendLedgerService` nhưng đơn vị token.

   → Foza nghiêng về **(a)** vì cô lập rõ (không đụng money path ví/plan đang chạy), và
   "pack theo model + lock giá lúc mua" đúng kỳ vọng user nhất. Nhưng tùy bạn đánh giá.

**3. Pack theo model cụ thể hay theo group?** User hỏi "5M token cho model X" → nghiêng
   theo **baseModel cụ thể** (giá mỗi model khác nhau nên pack phải gắn model để định giá).
   Có cần hỗ trợ pack cho nhiều model/nhóm trong một lần mua không, hay 1 pack = 1 model?

**4. Hết hạn?** Token pack có TTL (vd hết hạn sau 12 tháng) hay vĩnh viễn? Ảnh hưởng
   schema + cách hiển thị "còn N token, hết hạn DD/MM".

**5. Tương tác với plan + ví:** thứ tự ưu tiên khi key có cả pack lẫn plan lẫn ví? Đề
   xuất: pack (khớp model) → plan bucket → ví PAYG. Có hợp lý không?

**6. Endpoint provision để mua + đọc số dư:** lý tưởng có
   `POST /provision/token-pack` (mua) + số dư token lộ ra ở `GET /provision/keys` hoặc
   endpoint riêng, để website hiển thị "còn 3.2M / 5M token".

## Foza sẽ làm gì khi có

- UI mua token pack trên card listing (chọn model → chọn 5M/10M → trả tiền).
- Hiển thị số dư token còn lại trên trang keys/wallet.
- Tiền (mua pack) đi qua luồng thanh toán đã có (hiện đang ở trạng thái pending chờ cổng
  thanh toán thật — xem `vexa-webhook-admin-wallet-audit`), idempotent.

> Đây là tính năng mới ở phía X-Router (enforcement + settlement + persistence), Foza
> không tự làm được vì money path nằm ở gateway. Nếu thấy nên làm, cho biết hướng (a/b/c)
> + shape endpoint, Foza wire phần UI. Nếu chưa ưu tiên, cũng OK — user vẫn dùng được
> ví PAYG (nạp USD) như hiện tại.

---

## Phụ lục — file:line

- Pricing per-token: `marketplace/services/MarketPricingService.ts` (`sellCostForRequest`)
- Billing track plan/payg: `marketplace/policy/settlementHook.ts:101` (`billTrack`)
- Wallet thuần USD (không token): `marketplace/services/WalletService.ts` (getUsd/topupUsd/debitUsd/reserveUsd/settleUsd)
- Plan bucket settle: `settlementHook.ts:136` (`spendLedgerService.settle`)
