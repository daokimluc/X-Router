# Trả lời từ X-Router — prepaid token pack

> Người trả lời: X-Router engine. Bám code thật (file:line trong `apps/gateway/src`).
> Đây là **tính năng MỚI**, chưa tồn tại — câu trả lời là phân tích thiết kế + khuyến nghị,
> CHƯA build. Báo "build đi" + chốt vài quyết định bên dưới là tôi làm.

## TL;DR

- **Có nên làm: CÓ** — và kiến trúc hiện tại đỡ rất tốt. Settlement đã là máy
  reserve-at-enforce → settle-post-request với discriminant `billTrack`, thêm track thứ 3
  là khớp tự nhiên.
- **Hướng: (a)** — token-grant gắn trên key, `billTrack: "tokenpack"`. Đồng ý với Foza.
  KHÔNG đụng ví USD/plan đang chạy. (b) và (c) đều tệ hơn — giải thích bên dưới.
- **Pack = 1 model cụ thể, lock giá lúc mua** (token đã trả tiền rồi → settle chỉ là trừ
  token, không tính USD). **1 quota gộp prompt+completion** (đơn giản, đúng kỳ vọng user).
- **Ưu tiên: tokenpack (khớp model) → plan bucket → ví PAYG.** Đúng như Foza đề xuất.
- Effort: 1 bảng SQLite mới + 1 service + 1 track ở enforce/settle + 2 endpoint. Cô lập
  trong `marketplace/`, không đụng engine.

## 1. Có nên hỗ trợ?

Có. Mô hình "mua N token tiêu dần" phổ biến + user đang hỏi. Quan trọng: nó **không phá**
gì đang chạy nếu làm đúng hướng (a) — pack là một track song song, request nào không có
pack khớp thì rơi về plan/payg y như cũ.

## 2. Hướng nào — (a), rõ ràng nhất

Kiến trúc settlement hiện tại (`settlementHook.ts`) đã là:
> enforce: reserve một khoản vào track đã chọn (`request.planReservation` HOẶC
> `request.payg`) → settle sau request: trừ thật, refund phần thừa.

`billTrack: "plan" | "payg"` (`settlementHook.ts:101`) là discriminant. Thêm
`"tokenpack"` là mở rộng đúng pattern, không viết lại money path.

**Vì sao KHÔNG chọn (b) "ví theo token":** ví hiện thuần USD (`WalletService`:
getUsd/topupUsd/debitUsd/reserveUsd/settleUsd, bảng `wallets.balance_micro`). Đổi ví sang
token nghĩa là đập vào money path đang vận hành + mọi reconciliation USD. Rủi ro cao,
lợi ích bằng (a).

**Vì sao KHÔNG chọn (c) "pack là plan token-bucket":** `spendLedgerService` reserve/settle
theo `estimateUsd` (số thực USD) với rollover giờ/ngày/tháng. Token pack là one-time +
đơn vị token + không rollover → nhồi vào ledger USD sẽ phải "giả" đơn vị, dễ lẫn với spend
thật. Tách hẳn sạch hơn.

→ **(a): bảng `token_grants` riêng + service riêng + track riêng.** Cô lập, dễ test, dễ
reverse, không đụng cái đang chạy.

## 3. Pack theo model cụ thể + lock giá lúc mua

- **Theo `baseModel` cụ thể** (đồng ý Foza): giá mỗi model khác nhau → pack phải gắn model
  để định giá lúc mua. Đề xuất **1 pack = 1 baseModel** cho v1 (đơn giản, đúng "5M token
  cho model X"). Mua nhiều model = nhiều pack. Pack-theo-group để sau nếu cần.
- **Lock giá lúc mua, KHÔNG tính USD lúc tiêu.** Đây là điểm quan trọng: prepaid nghĩa là
  **tiền đã trả xong lúc mua** (qua luồng thanh toán Foza). Lúc settle, X-Router chỉ **trừ
  token** khỏi `tokensRemaining`, KHÔNG chạm ví/plan/USD. → không có "giá lúc tiêu", không
  rủi ro giá đổi giữa chừng. (Giá USD lúc MUA do Foza tính = `sellPrice × N` tại thời
  điểm đó; X-Router chỉ cần lưu N token + model + giá đã trả để audit.)
- **1 quota gộp prompt+completion** cho v1. Lý do: đơn giản, user nghĩ "5M token" là 1 con
  số. Tách 2 quota (completion đắt hơn) đúng về kinh tế nhưng làm UI + enforcement phức
  tạp gấp đôi, và pack đã lock giá lúc mua nên chênh lệch completion/prompt đã nằm trong
  giá rồi. Nếu sau muốn "công bằng theo chi phí" thì thêm `weightCompletion` sau.

## 4. Hết hạn

Đề xuất **có `expiresAt` optional** (null = vĩnh viễn). Schema rẻ (1 cột), và prepaid
thường có TTL (12 tháng) vì lý do kế toán + tránh nợ token vô hạn. Lúc settle: pack hết
hạn → coi như không còn pack → rơi về plan/payg. Hiển thị "còn N token, hết hạn DD/MM".
Foza quyết policy TTL; X-Router chỉ enforce cột `expiresAt`.

## 5. Thứ tự ưu tiên — đồng ý đề xuất Foza

**tokenpack (khớp model + còn token + chưa hết hạn) → plan bucket → ví PAYG.**

Hợp lý vì: pack là cái user trả tiền rõ ràng nhất cho model đó → tiêu trước. Hết pack →
plan (đã trả phí tháng) → cuối cùng ví PAYG (trả theo lần). Một điểm tinh tế cần chốt:
**nếu 1 request lớn hơn token còn lại trong pack thì sao?** Đề xuất v1: pack chỉ cover
request khi `tokensRemaining >= ước lượng`; thiếu → KHÔNG xé lẻ (không trừ một phần pack +
một phần plan), mà cả request rơi về plan/payg, pack giữ nguyên. Đơn giản, tránh kế toán
một-request-hai-track. (Settle dùng token THẬT sau khi xong; reserve dùng ước lượng như
plan đang làm.)

## 6. Endpoint provision

```
POST /provision/token-pack         # mua/cấp pack (privileged, sau khi Foza xác nhận thanh toán)
  body: { keyId, baseModel, tokens, pricePaidUsd?, expiresAt? }
  → { packId, keyId, baseModel, tokens, tokensRemaining, expiresAt }

GET  /provision/token-packs?keyId= # đọc pack + số dư
  → { packs: [{ packId, baseModel, tokens, tokensRemaining, expiresAt, exhausted }] }
```
- `POST` là privileged (giống `/provision/grant`, `/provision/wallet/topup`) +
  idempotent (Foza gửi kèm khóa thanh toán để không cấp 2 lần khi webhook retry).
- Số dư cũng có thể nhúng vào `GET /provision/keys` (mỗi key kèm `tokenPacks: [...]`) để
  Foza 1 call dựng trang keys — báo nếu muốn cách đó.

## Tôi sẽ build gì (nếu chốt)

1. **Database v6:** bảng `token_grants(id, key_id, base_model, tokens_total, tokens_remaining,
   price_paid_micro, expires_at, created_at)` + index `(key_id, base_model)`. (+ reservation
   tạm cho in-flight, hoặc reserve in-memory như spend ledger — quyết lúc build.)
2. **`TokenGrantService`** (marketplace): `grant`, `findUsable(keyId, baseModel)` (còn token
   + chưa hết hạn), `reserve(estimate)` / `settle(actualTokens)` / `release`, `listForKey`.
   SQLite transactional như WalletService.
3. **Enforce** (`marketplacePolicyCheck`): thêm bước token-pack TRƯỚC plan — nếu có pack
   usable đủ token → `request.tokenPack = { id, packId }`, bỏ qua plan/payg reserve.
4. **Settle** (`settlementHook`): `billTrack: "plan" | "payg" | "tokenpack"`; track tokenpack
   → trừ `promptTokens+completionTokens` thật khỏi pack, KHÔNG đụng ví/plan, seller credit
   vẫn ghi (từ giá vốn — pack vẫn là supply thật của seller). settlement_log thêm cột
   `bill_track` đã có sẵn → chỉ thêm giá trị.
5. **Endpoints** mục 6 + persistence (token_grants là money-state → SQLite, không JSON).
6. **Tests:** reserve/settle trừ token đúng; hết pack rơi về plan; hết hạn bỏ qua; request
   lớn hơn pack → không xé lẻ; idempotent grant; provision-scope auth.

OpenSpec change `marketplace-token-packs`, cô lập trong `marketplace/` (engine→marketplace
boundary giữ nguyên). KHÔNG đụng plan/wallet path hiện tại — chỉ thêm nhánh.

## Vài điều cần Foza chốt trước khi build

1. **Token gộp hay tách** prompt/completion? (đề xuất: gộp cho v1)
2. **TTL mặc định** bao lâu, hay để null (vĩnh viễn)? (X-Router enforce, Foza set policy)
3. **Request lớn hơn pack:** không xé lẻ (đề xuất) hay cho trừ một phần + phần còn lại
   sang plan/payg?
4. **Seller credit:** pack tiêu token của seller nào? Nếu pack gắn baseModel mà nhiều
   seller cùng bán → request route tới seller nào thì seller đó được credit (từ giá vốn),
   pack chỉ là "đơn vị buyer trả trước". Đúng không, hay pack khóa vào 1 seller cụ thể?

---

## Phụ lục — file:line tham chiếu

- Settlement track + reserve/settle: `marketplace/policy/settlementHook.ts:101,135,151`
- Enforce reserve flow (plan/payg quyết định): `marketplace/policy/marketplacePolicyCheck.ts:114,164`
- Wallet (USD-only, sẽ KHÔNG đụng): `marketplace/services/WalletService.ts:48-208`
- Spend ledger reserve/settle (USD bucket): `services/SpendLedgerService.ts`
- Money tables (sẽ thêm `token_grants`): `services/Database.ts:29-93` (v1) — bump v6
- ApiKey fields (planId/wallet/overage): `services/ApiKeyService.ts:19,37-43`
- Pricing per-token (lock giá lúc mua tham chiếu): `marketplace/services/MarketPricingService.ts` (`sellCostForRequest`)
- Provision privileged endpoints (mẫu cho POST token-pack): `marketplace/routes/provision.ts` (`/provision/grant`, `/provision/wallet/topup` — `privOpts`)
