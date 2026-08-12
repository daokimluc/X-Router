# Trả lời từ X-Router — expose group → models cho plan card

> Người trả lời: X-Router engine. Bám code thật (file:line trong `apps/gateway/src`).
> Tóm tắt: **làm được, và X-Router NÊN là bên expose** (vì nó là nguồn sự thật của
> classification). Tôi chọn phương án (b) + bonus (a). Có thể build ngay.

## TL;DR

- **Đồng ý phương án (b):** nhúng `models` (đã expand) vào `GET /provision/plans`. Foza
  1 call, không tự join, không copy regex.
- **Bonus (a):** cũng expose `GET /provision/model-groups` (group → members) để Foza
  tái dùng nếu cần render độc lập.
- **Nguồn member = canonical base models + FREE_MODELS**, phân loại qua chính
  `modelGroupOf()` (cùng hàm enforcement dùng) → không bao giờ lệch.
- `free` PHẢI được liệt kê riêng (Set cứng, không suy từ canonical) — đúng như bạn lo.
- Cache thoải mái vài phút.

## 1. Phương án — (b) là chính, (a) là bonus

X-Router là bên DUY NHẤT biết chính xác plan → model, vì `modelGroupOf` +
`matchesGroups` chính là hàm enforcement chạy lúc request (`marketplacePolicyCheck.ts:98`).
Foza copy regex sẽ lệch ngay khi tôi sửa rule. → X-Router expose, Foza không tự suy.

Tôi sẽ build CẢ HAI (chung một nguồn, rẻ):

**(a) `GET /provision/model-groups`** (provision-scope):
```json
{
  "groups": {
    "claude":  ["claude-opus-4-8", "claude-sonnet-4-6"],
    "codex":   ["gpt-5.5"],
    "gemini":  ["gemini-2.5-pro"],
    "free":    ["gpt-4o-mini", "gemini-1.5-flash", "gemini-2.0-flash"],
    "other":   []
  }
}
```

**(b) `models` nhúng vào `GET /provision/plans`** — mỗi plan expand sẵn từ `modelGroups`:
```json
{
  "plans": [
    { "id": "plan_claude", "name": "Claude $10", "modelGroups": ["claude"],
      "models": ["claude-opus-4-8", "claude-sonnet-4-6"], "buckets": {...}, ... },
    { "id": "plan_pro", "name": "Pro $20", "modelGroups": ["*"],
      "models": ["*"], ... }   // "*" → Foza render "Tất cả model"
  ]
}
```
- Plan có `["*"]` → `models: ["*"]` (Foza giữ nhãn "Tất cả model", không expand).
- Plan group thường → `models` = union các member của các group đó.
- `totalModels` Foza đếm `models.length` (hoặc hiển thị "Tất cả" nếu chứa `"*"`).

## 2. Nguồn liệt kê member — canonical base models + FREE_MODELS

Đây là điểm tinh tế. Có 3 ứng viên nguồn, tôi giải thích vì sao chọn cái nào:

| Nguồn | Là gì | Dùng cho member? |
|---|---|---|
| `canonicalBaseModels` (Set) | model "chính danh" của marketplace (`gpt-5.5`, `claude-sonnet-4-6`, `claude-opus-4-8`, `gemini-2.5-pro`) — `SellerService.ts:165` | ✅ nguồn chính |
| listings (seller cung cấp) | model thực sự có người bán | dùng để lọc "đang khả dụng" (xem dưới) |
| engine model registry (public models) | mọi alias kỹ thuật, kể cả model nội bộ | ❌ quá rộng, lộ model rác |

**Cách tôi expand:** lấy `canonicalBaseModels` → chạy `modelGroupOf(m)` cho từng cái →
gom theo group. Đây CHÍNH là phép phân loại enforcement dùng, nên member hiển thị = đúng
model buyer gọi được khi mua plan đó.

**Về "thực sự khả dụng" (câu 2 của bạn):** tôi sẽ thêm tùy chọn `?activeOnly=true` —
lọc chỉ giữ canonical model **có ít nhất 1 listing enabled** (qua
`SellerService.listingCostFor(baseModel)`). Mặc định trả full canonical (kể cả chưa có
listing) để plan card không trống lúc seller chưa lên hàng; bật `activeOnly` khi muốn chỉ
show model có người bán. Foza chọn theo nhu cầu.

> Lưu ý chiều phân loại: enforcement phân loại theo **model buyer GỬI** (`req.body.model`,
> `enforceKeyPolicy` lấy `getModel`), không phải canonical. Buyer thường gửi thẳng tên
> canonical (`claude-opus-4-8`) hoặc namespaced (`seller/claude-opus-4-8`) — cả hai đều
> match regex `claude` nên ra đúng group. Member list tôi expose là canonical (sạch, để
> hiển thị); việc match lúc chạy vẫn do `modelGroupOf` lo, không lệch.

## 3. `free` và `other`

- **`free` PHẢI có trong response** — bạn đúng: nó là Set cứng `FREE_MODELS`
  (`modelGroup.ts:19`: `gpt-4o-mini`, `gemini-1.5-flash`, `gemini-2.0-flash`), KHÔNG suy
  được từ canonical (không canonical nào khớp). Plan Free của bạn dùng `modelGroups:
  ["free"]` → tôi đưa nguyên Set này vào group `free`, nên plan Free hiện đủ 3 model thay
  vì rỗng. (Đây là lý do Foza tự expand sẽ ra rỗng — đã fix bằng cách X-Router là nguồn.)
- **`other`**: model không khớp group nào. Với canonical hiện tại, `other` thường **rỗng**
  (4 canonical đều rơi vào claude/codex/gemini). Tôi vẫn trả key `other: []` cho đủ bộ;
  Foza có thể bỏ qua group rỗng khi render. Không có plan thương mại nào dùng `other` nên
  nó chỉ mang tính đầy đủ.

## 4. Freshness

Mapping gần như tĩnh (đổi khi thêm canonical model / sửa regex / sửa FREE_MODELS).
**Cache phía Foza vài phút thoải mái** — không phải tiền, không cần live. Tôi gợi ý cache
5–10 phút; khi bạn (admin) thêm canonical model thì cache cũ tối đa lệch vài phút rồi tự
đúng.

## Tôi sẽ build gì (nếu Foza chốt)

> **✅ ĐÃ BUILD + MERGE** (change `marketplace-plan-groups`). Dùng được ngay; shape chi
> tiết ở `Accountrouter/docs/PROVISION_API_REFERENCE.md`. Đã làm cả (a) + (b):
> - `GET /provision/plans` → mỗi plan có field `models` đã expand (`*` → `["*"]`, Free →
>   3 model curated không rỗng).
> - `GET /provision/model-groups?activeOnly=` → `group → members`.
> Foza wire: thay chip nhóm bằng `plan.models`, `totalModels = plan.models.length`.

1. `SellerService` / một util: `expandGroups(activeOnly?)` → `Record<group, string[]>` từ
   canonical + FREE_MODELS, phân loại bằng `modelGroupOf`.
2. `GET /provision/model-groups?activeOnly=` (phương án a).
3. `models` nhúng vào `GET /provision/plans` (phương án b) — `["*"]` giữ nguyên, group
   thường expand thành union member.
4. Test: free không rỗng; `*` → `["*"]`; activeOnly lọc theo listing; group→members khớp
   `modelGroupOf`.

OpenSpec change nhỏ (provision-read scope, KHÔNG đụng money/enforcement path). Báo
"build đi" là tôi làm.

---

## Phụ lục — file:line

- `modelGroupOf` + `FREE_MODELS` + `matchesGroups`: `marketplace/utils/modelGroup.ts:12,19,43`
- Enforcement phân loại `req.body.model`: `marketplace/policy/marketplacePolicyCheck.ts:98`
- Plan shape (`modelGroups: string[]`): `marketplace/services/PlanService.ts:18`
- Seed plans (free/claude/codex/pro): `PlanService.ts:36`
- Canonical models (`listCanonicalBaseModels`): `marketplace/services/SellerService.ts:165`; default = gpt-5.5, claude-sonnet-4-6, claude-opus-4-8, gemini-2.5-pro
- Listing cost lookup (cho activeOnly): `SellerService.ts:269` (`listingCostFor`)
- `GET /provision/plans` hiện tại: `marketplace/routes/provision.ts` (`app.get("/provision/plans")`)
