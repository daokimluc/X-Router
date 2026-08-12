# Trả lời câu hỏi tích hợp Foza ↔ X-Router

> Người trả lời: team X-Router. Mỗi câu đánh dấu **[Đã xác minh trong code]** (sự
> thật về hành vi hiện tại) hoặc **[Quyết định thiết kế]** (chủ trương — cần chủ
> sản phẩm chốt; kèm khuyến nghị).
>
> Ngữ cảnh quan trọng đặt lên đầu: X-Router cố ý là engine **không cô lập tenant**.
> Nó không biết "user" là gì. Mọi `keyId`/`sellerId` truyền vào đều được thực thi.
> Vì vậy ranh giới mặc định là: **Foza giữ identity + mapping user↔{keyId,sellerId};
> X-Router giữ tiền + state marketplace.** Nhiều câu dưới đây xoay quanh ranh giới này.

---

## A. Seller ↔ user

**A1. [Quyết định thiết kế — ĐÃ LÀM]** Đúng quan sát: `Seller` trước KHÔNG có
`owner`. Chủ trương: **website tự giữ mapping `user → sellerId`** (X-Router không cô
lập tenant; `owner`/`externalRef` chỉ là tiện ích lọc, KHÔNG phân quyền). **Đã bổ
sung field `externalRef`** cho seller (Phase 34d): `POST /provision/seller` nhận
`externalRef`, và `GET /provision/sellers?externalRef=<x>` (cả admin) lọc theo nó —
đối xứng với `owner` của key. Foza đặt `externalRef = userId` để đối soát "user A có
seller nào" không cần giữ mapping cứng. Vẫn khuyến nghị Foza giữ mapping riêng để
không phụ thuộc uptime, nhưng giờ có đường hỏi live.

**A2. [Quyết định thiết kế]** ĐỪNG nhét userId vào `payoutRef`. `payoutRef` có nghĩa
"tham chiếu tài khoản nhận tiền" và xuất hiện trong payout record/đối soát; lạm dụng
nó làm khóa định danh sẽ rối khi sau này cần payoutRef thật. Nếu cần một định danh
external trên seller, hãy chờ field `externalRef` ở A1 (hoặc giữ mapping ở Foza).

---

## B. Một buyer nhiều key & ý nghĩa `owner`

**B1. [Quyết định thiết kế]** X-Router KHÔNG áp đặt 1-user-1-key — model là
**1 user = N key tùy website**. `owner` là một string tự do, không phải khóa user.
Hiện chỉ có MỘT field (`owner`), không có field "label hiển thị" riêng. Hai lựa chọn
cho Foza:
- (khuyến nghị) Đặt `owner = userId/email` để gom key theo user qua
  `GET /provision/keys?owner=`, và **Foza tự giữ tên hiển thị** do user đặt (Foza đã
  có DB user rồi, thêm cột `display_name` cho key là rẻ).
- Hoặc đặt `owner = display_name` và Foza tự map ngược — nhưng khi đó không gom được
  theo user qua API.
Vì Foza vốn phải giữ mapping `user→keyId` (lý do ở phần đầu), giữ luôn label hiển thị
ở Foza là nhất quán nhất. Nếu bạn thấy cần label hiển thị tách bạch trên X-Router,
nói tôi — đây cũng là một field nhỏ dễ thêm.

**B2. [ĐÃ LÀM]** Trước đây `GET /provision/keys` chỉ trả
`{id, owner, enabled, expiresAt, planId}`. **Đã bổ sung `walletUsd` + `provisioned`**
(Phase 34d) ngay trong response — hết N+1 cho màn "danh sách key của user". Giờ trả
`{id, owner, enabled, expiresAt, planId, walletUsd, provisioned}`. (`createdAt` vẫn
chưa có — nói nếu cần.)

---

## C. Provision key vs admin key

**C1. [Đã xác minh trong code]** Bảng của bạn **đúng toàn bộ**. Xác nhận thêm:
- provision CHỈ có `approve`/`suspend` seller — KHÔNG có `reject` (reject chỉ ở admin).
- provision có `grant` (gán plan), `wallet/topup`, `key` (create + disable/enable/
  delete/rotate + keys list), `listing` (create/enable/delete — KHÔNG re-price),
  `markup` PUT (set, KHÔNG xóa override), `earnings/:id/mark-paid`, `webhook`.
- Mọi thứ "đụng tiền ra / sửa catalog / sửa kinh tế seller" (plan CRUD, re-price,
  commission/payoutRef, reverse/adjust, reverse settlement, xóa markup override,
  canonical add/remove, reject seller) = **admin-only**.

**C2. [Quyết định thiết kế — đúng tinh thần]** Trực giác của bạn đúng:
**end-user-tự-phục-vụ → provision; admin-thao-tác → admin.** Cụ thể:
- Gán plan: nếu là user tự đổi gói trong luồng tự phục vụ → `provision/grant`. Nếu là
  admin chỉnh tay → `/admin/v1/keys/:id/plan`. Hai cái ghi cùng chỗ (đều gọi
  `apiKeyService.update`), khác nhau ở **kênh + audit log** (`provision.grant` vs
  `api_key.assign_plan`). Chọn theo "ai khởi tạo hành động".
- Duyệt seller: nếu Foza cho seller tự đăng ký và một admin-của-Foza bấm duyệt trong
  UI Foza → đằng nào cũng là "thao tác quản trị", dùng key nào cũng được; tôi nghiêng
  về **provision** nếu nó nằm trong luồng tự động hóa của website, **admin** nếu là
  thao tác vận hành thủ công. Quan trọng là nhất quán để đọc audit log.

**C3. [Quyết định thiết kế]** Hiện admin key là **bắt buộc** cho re-price / reverse /
plan-CRUD / canonical / sửa seller-terms / xóa markup. Lý do tách: đây là các thao
tác **đổi kinh tế nền tảng** (giá, hoa hồng, đảo tiền) — cố ý đặt sau admin key như
một lớp phân tách đặc quyền, để một provision key bị lộ KHÔNG thể đổi giá hay đảo
settlement (xem mô hình mối đe dọa trong `MARKETPLACE_INTEGRATION.md §7`).

Về "1 key cho tất cả": tôi **không khuyến nghị** gộp, vì như vậy mất lớp phân tách đó.
Nếu Foza muốn admin làm mọi thứ trong Foza, cứ giữ CẢ HAI key server-side (như bạn
định) — đó là cách đúng. Nếu bạn thật sự cần bản `/provision/*` cho vài thao tác admin
(ví dụ re-price tự động theo thuật toán của Foza), tôi có thể thêm chọn lọc — nói rõ
thao tác nào, tôi cân nhắc từng cái thay vì mở toàn bộ.

---

## D. Webhook & đối soát

**D1. [Đã xác minh trong code]** Đúng — `PUT /provision/webhook` và
`PUT /admin/v1/business-webhook` ghi vào **cùng một** `businessConfig`
(`app.webhookService`). Đặt một đường, GET đường kia ra cùng giá trị. Secret được mã
hóa khi lưu, GET luôn mask.

**D2. [Đã xác minh trong code]** Đúng cả hai:
- Foza map event về user bằng cách match `buyerKeyId` (event) với `keyId` Foza đã lưu.
  **KHÔNG cần tự hash gì** — `buyerKeyHash` chỉ là tiện ích đối chiếu, dùng `buyerKeyId`
  là đủ.
- `sellerId` trong `usage.recorded` **khớp 1-1** với `sellerId` từ
  `POST /provision/seller`. (`sellerId="house"` = supply nền tảng, không tích payout.)

**D3. [ĐÃ LÀM — quan trọng]** Trước đây chỉ có `/provision/usage` (token, không có
sellerCredit per-record) và không có replay. **Đã thêm `GET /provision/settlements`**
(Phase 34d) — đọc thẳng `settlement_log`, mỗi dòng mang
`collected / sellerCredit / platformMargin / billTrack / settlementId(id) / reversed`,
đều là **số đã ghi nhận** (không ước tính), với `collected = sellerCredit + platformMargin`.
Lọc theo `keyId` (buyer), `sellerId`, `since`, `limit`.

Quy trình đối soát khuyến nghị cho Foza:
- **Bill buyer / tích payout chính xác khi miss webhook:** replay
  `GET /provision/settlements?since=<lần đối soát trước>` → cộng theo `buyerKeyId` /
  `sellerId`, bỏ dòng `reversed:true`, bỏ `sellerId="house"` khi tính payable.
- **Chuẩn tổng để chốt payout:** vẫn `GET /provision/earnings/:sellerId` (snapshot
  X-Router tự cộng, là chân lý). Dùng settlements để dựng chi tiết, earnings để chốt số.
- `/provision/usage` giữ nguyên vai trò: đối soát token/cost (không phải tiền chia).

---

## E. Wallet & vòng đời

**E1. [Đã xác minh trong code]** Đúng: `provisioned` dựa trên "có row ví hay không",
KHÔNG dựa số dư. `topup`/`open` tạo row; `debit`/`settle` chỉ UPDATE `balance_micro`,
**không bao giờ xóa row**. Nên sau khi tiêu hết, `walletUsd:0` + `provisioned:true`.
Foza phân biệt được "chưa nạp" (`provisioned:false`) vs "đã nạp, tiêu hết"
(`provisioned:true, walletUsd:0`).

**E2. [Đã xác minh trong code]** `DELETE /provision/key/:id` = soft (disable + giữ
lại để settlement-log tham chiếu). **Hiện KHÔNG có xóa cứng** qua provision (cố ý —
để đối soát lịch sử không bị đứt FK). Key đã revoke **VẪN xuất hiện** trong
`GET /provision/keys` (với `enabled:false`) — `/provision/keys` chỉ lọc theo `owner`,
không lọc trạng thái. Foza muốn ẩn key revoke thì tự lọc `enabled === false` ở client.
(Nếu cần xóa cứng — ví dụ GDPR/xóa dữ liệu — nói tôi, đó là việc riêng cần cân nhắc
ảnh hưởng settlement-log.)

**E3. [Đã xác minh trong code]** `POST /provision/key/:id/rotate` là API **ổn định**,
dùng được cho "tạo lại key": đổi secret, giữ nguyên id/plan/ví/mọi cấu hình, trả
plaintext mới **một lần**, secret cũ chết ngay. (Doc trước thiếu — đã bổ sung vào
`PROVISION_API_REFERENCE.md`.) Đây đúng là API cho luồng "user nghi lộ key → tạo lại".

---

## F. Quy mô & vận hành

**F1. [Đã xác minh + lộ trình]** Đúng: tiền/đo đếm (wallet, seller_earnings,
settlement_log, usage_log) ở **SQLite**; còn config marketplace (seller, listing,
plan, markup, canonical) ở **JSON state file**. Đánh giá quy mô:
- JSON state KHÔNG nằm trên đường tiền và KHÔNG ghi mỗi request — nó chỉ ghi khi
  **config thay đổi** (tạo seller, đổi plan…), tần suất thấp. Vài nghìn user / vài
  chục nghìn request/ngày thì JSON state **không phải điểm nghẽn** vì request không
  chạm nó; tiền/usage đã ở SQLite.
- Điểm cần để mắt là **kích thước** state file (toàn bộ load vào RAM + ghi lại cả file
  mỗi lần save). Vài nghìn seller/listing thì vẫn nhỏ (KB–vài MB). Hàng trăm nghìn thì
  nên chuyển.
- Lộ trình: có, chuyển nốt config sang SQLite là bước kế tiếp tự nhiên (Database.ts đã
  sẵn). Chưa làm vì chưa phải nút thắt. → Nếu Foza dự kiến >~10k seller/listing, báo
  tôi để ưu tiên.

**F2. [Đã xác minh + khuyến nghị]** Mặc định 120/phút/key trên create-key/topup/grant/
mark-paid. Khuyến nghị:
- Production bình thường: 120 là đủ rộng cho luồng người-dùng-thật.
- Provisioning hàng loạt / migrate: **nâng config tạm** (ví dụ `PROVISION_RATE_LIMIT_PER_MINUTE=2000`)
  cho cửa sổ migrate, rồi hạ lại — đơn giản hơn là tự xếp hàng. Foza vẫn nên có
  retry-with-backoff khi gặp 429 như một lớp an toàn.
- Con số production tôi đề xuất: **300–600/phút/key** nếu Foza là tenant tin cậy duy
  nhất giữ provision key server-side (vì rate limit ở đây là chống lạm dụng khi key
  lộ, không phải chống chính Foza). Đặt 0 để tắt hẳn nếu bạn tin tưởng hoàn toàn — khi
  đó dựa vào việc giữ key server-side làm lớp bảo vệ.

**F3. [Đã xác minh trong code]** Hai endpoint:
- `GET /healthz` — **không cần auth**, trả `{status:"ok"}`. Dùng cái này để poll
  liveness (X-Router còn sống).
- `GET /readyz` — **cần key** (internal HOẶC admin HOẶC một client key hợp lệ; provision
  key KHÔNG dùng được ở đây). Trả `{status:"ready"|"degraded", checks:{...}}` —
  "ready" khi có provider instance bật. Dùng cho readiness.
Hiện **không có** health riêng cho "lớp marketplace" — nếu `/healthz` ok thì
marketplace (đã load cùng tiến trình) cũng sống. Foza nên poll `/healthz` cho liveness;
`/readyz` (kèm admin key) nếu muốn biết có provider sẵn sàng phục vụ.

---

## G. Kiến trúc

**G1. [Quyết định thiết kế — câu quan trọng nhất]** Mô hình "Foza chỉ giữ identity +
mapping tối thiểu, MỌI state marketplace hỏi live từ X-Router" **khả thi một phần,
nhưng tôi KHÔNG khuyến nghị làm thuần như vậy cho phần tiền.** Phân tích thẳng:

- **State catalog (seller/listing/plan/markup)**: hỏi live X-Router là HỢP LÝ — đây là
  nguồn sự thật, ít thay đổi, không cần Foza giữ sổ riêng. ✅ Làm theo ý bạn.
- **Tiền (bill buyer + payable seller)**: KHÔNG nên hoàn toàn không-sổ. Webhook là
  best-effort (có thể miss), và X-Router có thể downtime. Nếu Foza không giữ sổ riêng,
  một event miss = lệch tiền âm thầm. **Khuyến nghị:** Foza GIỮ sổ riêng (bill ledger +
  payable ledger) dựng từ `usage.recorded`, idempotent, và **đối soát định kỳ** với
  `GET /provision/earnings/:sellerId` (chuẩn cho payout) + `GET /provision/usage`
  (chuẩn cho usage buyer). X-Router là nguồn sự thật, nhưng Foza giữ bản sao có đối
  soát — đây là pattern chuẩn cho hệ thống tiền phân tán (không phải lặp thừa, mà là
  chống lệch).

Tóm lại: **catalog hỏi live OK; tiền thì giữ sổ + đối soát.** Đó là ranh giới đúng.

**G2. [Cảnh báo — những lỗi hay gặp]**
1. **Quên rằng X-Router không cô lập tenant.** Foza PHẢI tự kiểm tra mỗi `keyId`/
   `sellerId` thuộc đúng user đăng nhập TRƯỚC khi gọi `/provision/*`. X-Router sẽ làm
   bất cứ gì được bảo. Đây là lỗi bảo mật nghiêm trọng nhất nếu sai.
2. **Verify HMAC webhook trên RAW body.** Đừng parse-rồi-re-serialize rồi mới hash —
   sẽ sai chữ ký. Hash đúng bytes thô.
3. **Không idempotent webhook.** Event có thể trùng (retry) hoặc miss. Phải khử trùng
   theo khóa event + có job đối soát bù.
4. **Coi `actualSellCost` là "giá niêm yết".** Nó là số THU THỰC TẾ (đã trừ flooring
   ví). Bill buyer theo nó, đừng tự tính lại từ giá × token rồi thắc mắc sao lệch.
5. **Nhầm `house` là một seller thật.** `sellerId="house"` = supply nền tảng, KHÔNG
   tích payout. Lọc nó ra khi tính payable.
6. **Giữ provision/admin key ở client.** Tuyệt đối server-side. Lộ = mất toàn bộ mặt
   phẳng tiền (xem threat table §7).
7. **Quên xoay key khi nghi lộ.** Có sẵn `--add/--remove-provision-key` (2 key song
   song, không downtime) cho provision, và `/provision/key/:id/rotate` cho client key.

---

## Tóm tắt việc cần X-Router quyết/làm thêm (nếu Foza muốn)

| Mục | Việc | Trạng thái |
|---|---|---|
| A1 | Thêm `externalRef` cho seller (lọc được) | ✅ ĐÃ LÀM (Phase 34d) |
| B2 | `/provision/keys` trả kèm walletUsd + provisioned | ✅ ĐÃ LÀM (Phase 34d) |
| D3 | `GET /provision/settlements` replay per-record (sellerCredit/platformMargin/id) | ✅ ĐÃ LÀM (Phase 34d) |
| F1 | Chuyển config marketplace JSON→SQLite | Khi >~10k seller/listing |
| E2 | Xóa cứng key (GDPR) | Khi có nhu cầu xóa dữ liệu |

3 mục A1/B2/D3 đã triển khai + test + cập nhật `PROVISION_API_REFERENCE.md`. Foza
bắt đầu tích hợp được ngay với hợp đồng đầy đủ. Hai mục còn lại (F1, E2) chỉ làm khi
chạm ngưỡng/nhu cầu.

---

# Đợt 2 — idempotency & khóa chung (Phase 34d.1, ĐÃ LÀM)

**1. settlementId trong webhook (BẮT BUỘC) — ✅ ĐÃ LÀM.**
Trước đây payload `usage.recorded` không có id duy nhất → không khử trùng an toàn
được. **Đã thêm `settlementId`** vào payload. Nó chính là `settlement_log.id` (dạng
`stl_...`), **ổn định + duy nhất mỗi lần settle**. Foza khử trùng webhook bằng
`settlementId`: nếu đã xử lý id này thì bỏ qua bản trùng. Đây là cách an toàn cho
"2 request giống hệt cùng giây" — mỗi lần settle có id riêng, không phụ thuộc nội
dung payload.

**2. (D3) sellerCredit/platformMargin/settlementId per-record — ✅ ĐÃ LÀM (theo đúng grain).**
Lưu ý kỹ thuật: `/provision/usage` đọc bảng `usage_log` (ghi tại lúc tính token,
TRƯỚC khi settle) còn tiền chia nằm ở `settlement_log` (ghi lúc settle) — hai bảng
khác thời điểm + khác grain (không phải request nào cũng có settlement marketplace).
Nhồi tiền vào `usage_log` sẽ sai bản chất. Thay vào đó:
- **`GET /provision/settlements`** (đã có) là nguồn per-record tiền chính xác:
  `id`(=settlementId) / `collected` / `sellerCredit` / `platformMargin` / `billTrack` /
  `reversed`. Đây là cái Foza dùng để đối soát tiền per-record.
- **Đã thêm `requestId`** vào CẢ `/provision/usage` LẪN `/provision/settlements` →
  Foza nối token-detail (usage) với money-detail (settlement) qua cùng `requestId`
  khi cần ghép. Tức là Foza có cả hai chiều: khử trùng theo `settlementId`, nối chi
  tiết theo `requestId`.

**3. settlementId có ổn định không? — ✅ CÓ, đúng như bạn mong.**
`settlement_log` sinh một id `stl_<uuid>` cho **mỗi lần settle**, ghi vào SQLite một
lần, không đổi. Giờ id đó được phơi ra **cả webhook (`settlementId`) lẫn
`/provision/settlements` (`id`)** — một khóa duy nhất dùng chung cho realtime +
đối soát, đúng ý bạn. (Ngoài ra `requestId` là khóa thứ hai để nối sang `/provision/usage`.)

**Khuyến nghị quy trình cho Foza:**
- Realtime: nhận `usage.recorded` → upsert theo `settlementId` (idempotent) → ghi sổ.
- Đối soát định kỳ: `GET /provision/settlements?since=<mốc>` → so khớp theo
  `settlementId`, bù những cái sổ Foza chưa có; chốt tổng payout bằng
  `GET /provision/earnings/:sellerId`.
- Bỏ `reversed:true` và `sellerId="house"` khi tính payable.

**Trạng thái:** gateway tsc clean, 635 pass + 7 skip, đã cập nhật
`PROVISION_API_REFERENCE.md`. Cả 3 câu đợt 2 đã đóng — không còn chờ gì để Foza dựng
sổ idempotent đúng.
