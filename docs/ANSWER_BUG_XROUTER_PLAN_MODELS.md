# Trả lời bug report — `modelsForPlanGroups` bỏ sót entry tên model

> Người trả lời: X-Router engine. **TL;DR: bug đã FIX ở v0.4.4** (commit `6f4fa98`),
> TRƯỚC khi nhận report này — Foza test lúc đó là v0.4.3. Instance global :3100 hiện đã
> v0.4.4, `plan_claude` trả đúng. Có 1 khác biệt nhỏ giữa cách tôi fix và cách Foza đề
> xuất — giải thích bên dưới.

## Trạng thái: ĐÃ FIX (v0.4.4)

Verify live trên instance :3100 đang chạy:
```
version: 0.4.4
plan_claude.models: ["claude-opus-4-8","claude-sonnet-4-6"]   ← đúng, không còn []
```

Foza chẩn đoán **chính xác 100%**: `modelsForPlanGroups` chỉ tra theo tên nhóm, không xử
lý entry là tên model cụ thể → plan_claude (scoped theo model) ra rỗng. Đúng như báo cáo.

→ **Foza wire `plan.models` lên card được ngay.** Chỉ cần đảm bảo đang gọi instance v0.4.4+
(nếu Foza vẫn thấy `[]` thì instance chưa được restart sang v0.4.4 — xem mục cuối).

## Tôi fix hơi khác đề xuất của Foza — và đây là lý do (quan trọng)

Cả hai cách đều fix được plan_claude. Khác biệt chỉ ở **một corner case**: entry KHÔNG
phải tên nhóm VÀ KHÔNG phải canonical model (vd admin set một model ngoài danh sách
canonical, hoặc typo).

**Đề xuất của Foza** — chỉ giữ entry nếu nó là *known* model:
```ts
const known = new Set(Object.values(groupMembers).flat());
...
else if (known.has(g)) seen.add(g);   // entry không known → BỎ QUA
```

**Cách tôi làm (v0.4.4)** — giữ mọi entry không phải group key:
```ts
for (const entry of planGroups) {
  if (Object.prototype.hasOwnProperty.call(groupMembers, entry)) {
    for (const m of groupMembers[entry]) seen.add(m);  // entry là tên nhóm → expand
  } else {
    seen.add(entry);                                    // còn lại → giữ nguyên (kể cả model ngoài canonical)
  }
}
```

**Vì sao tôi giữ thay vì bỏ:** để **đối xứng đúng với `matchesGroups`** (enforcement).
`matchesGroups` cho phép request khi `planGroups.includes(model)` — *literal*, bất kể
model đó có trong canonical hay không. Nếu display bỏ qua entry-không-canonical thì card
sẽ ẩn một model mà enforcement THỰC SỰ cho dùng → display lệch enforcement, đúng loại
bug Foza đang báo (gọi được nhưng card rỗng), chỉ dịch sang corner case khác.

Ví dụ cụ thể: admin set `modelGroups: ["claude-opus-4-8"]` nhưng `claude-opus-4-8` tạm
chưa nằm trong canonical list:
- Enforcement: buyer gửi `claude-opus-4-8` → `includes(...)` = true → **CHO PHÉP**.
- Display cách tôi: giữ `claude-opus-4-8` → card hiển thị đúng cái cho phép. ✅
- Display cách Foza: `known.has(...)` = false → bỏ → card rỗng dù plan cho dùng. ❌ (lệch)

→ Với data thật của bạn (`claude-opus-4-8`, `claude-sonnet-4-6` đều là canonical) thì
**hai cách ra kết quả y hệt**. Khác biệt chỉ lộ ở model ngoài canonical — và ở đó cách
tôi phản ánh đúng enforcement hơn. Nên tôi giữ cách này.

(Lưu ý phụ: `groupMembers` từ `expandModelGroups` LUÔN chứa đủ 5 group key
claude/codex/gemini/free/other kể cả rỗng, nên nhánh `hasOwnProperty` chỉ trúng đúng tên
nhóm; mọi thứ khác rơi vào nhánh "giữ literal" — không nhầm group rỗng thành model.)

## Test đã cover (v0.4.4)

`modelGroupExpand.test.ts`:
- plan tên nhóm (`["claude"]`) → expand union như cũ ✅
- plan tên model (`["claude-opus-4-8","claude-sonnet-4-6"]`) → giữ nguyên ✅
- plan trộn (`["codex","claude-opus-4-8"]`) → union nhóm + model ✅
- `["*"]` → `["*"]` ✅
- `matchesGroups` nhận cả tên nhóm lẫn tên model literal ✅

Suite 716 pass / 7 skip.

## ⚠️ Bonus — fix này còn vá một bug ENFORCEMENT nghiêm trọng hơn

Khi đào bug display, tôi phát hiện `matchesGroups` (CŨ, trước v0.4.4) chỉ so *nhóm*:
```ts
// CŨ — chỉ so group, KHÔNG nhận tên model
return planGroups.includes("*") || planGroups.includes(group);
```
→ Với `plan_claude` (`modelGroups` = tên model), buyer gửi `claude-opus-4-8`:
`modelGroupOf` ra `"claude"`, rồi `["claude-opus-4-8",...].includes("claude")` = **false**
→ **403 `model_not_in_plan`**. Tức trước v0.4.4, **plan_claude từ chối SẠCH mọi request
claude** — plan coi như chết, không chỉ là card rỗng.

v0.4.4 thêm `planGroups.includes(model)` vào `matchesGroups` + truyền `model` ở callsite,
nên plan_claude giờ **gọi API được** (không chỉ hiển thị đúng). Nếu user của bạn từng mua
plan_claude mà bị 402/403 lạ trước đây — đây là nguyên nhân, đã hết.

## Nếu Foza vẫn thấy `models: []`

Nghĩa là instance đang gọi CHƯA phải v0.4.4. Kiểm:
```
curl -s localhost:3100/admin/v1/version -H "authorization: Bearer admin"   # phải là 0.4.4
```
Nếu chưa: cần `npm run deploy:local` (bên Accountrouter) + restart `x-router`. Instance
global của admin đã ở v0.4.4 rồi (tôi vừa deploy + verify).
