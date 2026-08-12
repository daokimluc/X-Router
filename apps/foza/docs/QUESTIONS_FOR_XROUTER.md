# Câu hỏi cho team X-Router — phục vụ tích hợp Foza

> Bối cảnh: Foza muốn theo kiến trúc **"Foza = lớp UI/UX, X-Router = nguồn sự thật
> duy nhất cho toàn bộ state marketplace"**. Admin quản trị mọi thứ (duyệt seller,
> tạo/sửa plan, re-price, reverse…) **ngay trong Foza** bằng cách gọi API X-Router;
> Foza cố gắng giữ state riêng tối thiểu nhất có thể.
>
> Tôi (phía Foza) đã đọc code: `marketplace/routes/{provision,planAdmin,sellerAdmin,earningsAdmin}.ts`,
> `middleware/{provisionAuth,adminAuth}.ts`, `services/{ApiKeyService,SellerService}.ts`,
> `config.ts`, `marketplace/index.ts`, `apps/dashboard/src/MarketplacePage.tsx`.
> Các câu hỏi dưới đây là những chỗ code CHƯA trả lời dứt khoát, hoặc cần xác nhận
> để khỏi xây sai.

---

## A. Seller ↔ user (vấn đề lớn nhất)

Quan sát từ code: `Seller = {id, displayName, status, payoutRef?, commissionPct?, createdAt}`
— **KHÔNG có owner/userId**. `GET /provision/sellers` chỉ lọc theo `status`, không
theo user. Trong khi đó `ApiKey` CÓ field `owner` (set qua `label`) và lọc được
`GET /provision/keys?owner=`.

Hệ quả: Foza tạo seller → nhận `sellerId`, nhưng phiên sau X-Router không cho Foza
hỏi lại "seller nào thuộc user A". Foza buộc phải tự lưu mapping `user → sellerId`.

**A1.** X-Router có dự định thêm trường tự do (kiểu `owner`/`externalRef`/`label`)
vào Seller, lọc được qua `GET /provision/sellers?owner=` — giống hệt cách key đang
làm — để Foza KHỎI phải giữ mapping seller riêng không? Hay chủ trương là **website
phải tự giữ mapping seller↔user** (X-Router cố ý không biết)?

**A2.** Nếu không thêm `owner` cho seller: dùng `payoutRef` để nhét một định danh
user (ví dụ email/userId của Foza) có phải là cách bạn khuyến nghị không, hay
`payoutRef` nên giữ đúng nghĩa "tham chiếu tài khoản nhận tiền" và đừng lạm dụng?

---

## B. Một buyer có nhiều key không? Ý nghĩa của `owner`

Quan sát: `POST /provision/key {label}` → `label` lưu thành `owner`. `GET
/provision/keys?owner=<label>` trả mọi key có cùng owner.

**B1.** Mô hình bạn hình dung là **1 user = 1 key** hay **1 user = nhiều key**? Foza
hiện cho user tạo nhiều key (mỗi key một label riêng). Nếu Foza đặt `owner = email`
cho TẤT CẢ key của một user, thì label hiển thị (tên key do user đặt) để vào đâu —
có field riêng cho label hiển thị, hay `owner` kiêm luôn? (Code chỉ thấy một field
`owner`.)

**B2.** `GET /provision/keys` trả `{id, owner, enabled, expiresAt, planId}` —
**không** có `walletUsd` hay `createdAt`. Đúng là phải gọi thêm
`GET /provision/wallet/:keyId` cho từng key để biết số dư chứ? Có endpoint nào trả
gộp (key + wallet + plan) trong 1 lần không, hay Foza phải N+1 call?

---

## C. Quyền của provision key vs admin key (ranh giới chính xác)

Foza dự định giữ CẢ HAI key (provision + admin) ở server-side để admin làm mọi thứ
trong Foza. Tôi đã lập bảng từ code, nhờ xác nhận đúng/sai:

| Thao tác | provision có? | admin có? | Foza nên dùng key nào |
|---|---|---|---|
| tạo/sửa/xóa **plan** | ❌ | ✅ `/admin/v1/plans` | admin |
| gán plan cho key | ✅ `/provision/grant` | ✅ `/admin/v1/keys/:id/plan` | ? |
| duyệt/đình chỉ seller | ✅ | ✅ | ? |
| **reject** seller | ❌ (chỉ approve/suspend) | ✅ `/admin/v1/sellers/:id/reject` | admin |
| sửa commission/payoutRef seller | ❌ | ✅ `PATCH /admin/v1/sellers/:id` | admin |
| **re-price** listing (costPrice) | ❌ (chỉ enabled) | ✅ `PATCH /admin/v1/listings/:id` | admin |
| reverse/adjust earnings | ❌ | ✅ `/admin/v1/earnings/...` | admin |
| reverse settlement | ❌ | ✅ `/admin/v1/settlements/:logId/reverse` | admin |
| **xóa** markup override | ❌ (chỉ set) | ✅ `PUT /admin/v1/markup` (null) | admin |
| canonical-model add/remove | ❌ | ✅ `/admin/v1/canonical-models` | admin |

**C1.** Bảng trên có đúng không? Có thao tác nào tôi gán nhầm key không?

**C2.** Với các việc làm được bằng CẢ HAI key (gán plan, duyệt seller) — bạn khuyến
nghị Foza dùng provision hay admin? (Tôi nghĩ: end-user-tự-phục-vụ → provision;
admin-thao-tác → admin. Đúng tinh thần không?)

**C3.** Có kế hoạch để **toàn bộ** thao tác admin marketplace đều có bản
`/provision/*` tương đương không (để website chỉ cần 1 key)? Hay admin key là bắt
buộc nếu muốn re-price / reverse / plan-CRUD / canonical?

---

## D. Webhook & đối soát

Quan sát: webhook config có thể đặt qua CẢ `PUT /provision/webhook` LẪN
`PUT /admin/v1/business-webhook`. `usage.recorded` là nguồn để bill buyer + tích
payout seller.

**D1.** Hai đường đặt webhook (`/provision/webhook` vs `/admin/v1/business-webhook`)
ghi vào **cùng một** config phải không? Đặt một đường, đường kia GET ra cùng giá
trị?

**D2.** `usage.recorded.data` có `buyerKeyId` + `buyerKeyHash`. Để Foza map event về
đúng user, Foza match `buyerKeyId` với keyId nó đã lưu — đúng chứ? (Foza KHÔNG cần
tự hash gì.) `sellerId` trong event có khớp 1-1 với `sellerId` từ
`POST /provision/seller` không?

**D3.** Giao hàng webhook là best-effort (timeout 5s, nuốt lỗi). Khi Foza miss event
và đối soát bằng `GET /provision/usage` — endpoint này trả "reconciliation-grade"
(token/model/cost), KHÔNG có `sellerCredit`/`platformMargin` per-record. Vậy nếu
Foza miss một `usage.recorded`, làm sao tính lại **chính xác** `sellerCredit` cho
khoảng bị miss? Lấy `GET /provision/earnings/:sellerId` (snapshot tổng) làm chuẩn
và tin số tổng, hay có cách replay per-record settlement?

---

## E. Wallet & vòng đời

**E1.** `GET /provision/wallet/:keyId` trả `{walletUsd, provisioned}`. Khi
`provisioned:false` + `walletUsd:0` nghĩa là chưa từng topup. Sau khi user dùng hết
tiền, `walletUsd` về 0 nhưng `provisioned` vẫn true — đúng không? (Để Foza phân biệt
"chưa nạp" vs "đã nạp rồi tiêu hết".)

**E2.** `DELETE /provision/key/:id` = soft revoke (disable, giữ lại để đối soát).
Có cách **xóa cứng** key không, hay soft là vĩnh viễn? Key đã revoke có còn xuất
hiện trong `GET /provision/keys` không (để Foza ẩn đi)?

**E3.** `POST /provision/key/:id/rotate` (tôi thấy trong code, doc không nêu) — đổi
secret giữ nguyên id/plan/wallet, trả plaintext mới một lần. Đây có phải API ổn định
để Foza cho user "tạo lại key" không?

---

## F. Quy mô & vận hành

**F1.** State seller/listing/plan/markup/canonical lưu ở **JSON state file**, còn
earnings/settlement/usage-log ở **SQLite**. Ở quy mô vài nghìn user / vài chục nghìn
request/ngày, JSON state file có phải là điểm nghẽn không? Có lộ trình chuyển hết
sang SQLite/DB không?

**F2.** `PROVISION_RATE_LIMIT_PER_MINUTE` mặc định 120/phút/key, áp lên create-key,
topup, grant, mark-paid. Nếu Foza provisioning hàng loạt (migrate / nhiều user đăng
ký cùng lúc) thì nên nâng config, hay Foza tự xếp hàng + retry-backoff? Bạn khuyến
nghị con số nào cho production?

**F3.** Có endpoint health/readiness nào Foza nên poll để biết X-Router (và lớp
marketplace) còn sống không? (`GET /healthz`, `/readyz` — `/readyz` cần key gì?)

---

## G. Câu hỏi mở về kiến trúc

**G1.** Theo bạn, mô hình "Foza chỉ giữ identity (user/đăng nhập) + mapping tối thiểu
user→sellerId, còn MỌI state marketplace hỏi live từ X-Router" có khả thi và đúng ý
đồ thiết kế của X-Router không? Hay bạn cho rằng website NÊN giữ sổ riêng (bill
ledger, payable ledger) để chống lệch khi webhook miss / X-Router downtime?

**G2.** Có điều gì về marketplace mà chúng tôi (phía website) hay hiểu sai / hay làm
sai khi tích hợp mà bạn muốn cảnh báo trước không?
