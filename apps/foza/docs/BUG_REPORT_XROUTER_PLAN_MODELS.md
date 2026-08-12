# Bug report cho X-Router — `modelsForPlanGroups` bỏ sót entry là tên model cụ thể

> Bối cảnh: sau khi X-Router build endpoint plan-groups (change `marketplace-plan-groups`,
> trả lời ở `ANSWERS_FROM_XROUTER_PLAN_GROUPS.md`), Foza test live và thấy 3/4 plan đúng,
> nhưng `plan_claude` trả `models: []` rỗng. Đào ra thì đây là **bug logic ở X-Router**,
> không phải data sai — chi tiết dưới.

## Triệu chứng (đã verify live trên instance global :3100)

`GET /provision/plans` (provision key):

| plan | modelGroups | models (expand) | đúng? |
|---|---|---|---|
| plan_free | `["free"]` | `["gpt-4o-mini","gemini-1.5-flash","gemini-2.0-flash"]` | ✅ |
| plan_codex | `["codex"]` | `["gpt-5.5"]` | ✅ |
| plan_pro | `["*"]` | `["*"]` | ✅ |
| **plan_claude** | `["claude-opus-4-8","claude-sonnet-4-6"]` | **`[]`** ← rỗng | ❌ |

`plan_claude` được admin tạo với `modelGroups` chứa **tên model cụ thể** (không phải tên
nhóm `claude`). Đây là cách dùng hợp lệ — admin muốn plan giới hạn đúng 2 model đó.

## Nguyên nhân gốc — 2 hàm trong `modelGroup.ts` lệch nhau

**Enforcement ĐÃ hỗ trợ entry là tên model** (`marketplace/utils/modelGroup.ts:97`):
```ts
export function matchesGroups(group: string, planGroups: string[], model?: string): boolean {
  if (planGroups.includes("*")) return true;
  if (planGroups.includes(group)) return true;
  if (model && planGroups.includes(model)) return true;  // ← nhận tên model cụ thể
  return false;
}
```
→ Lúc gọi API, buyer gửi `claude-opus-4-8`, `planGroups.includes("claude-opus-4-8")` = true
→ **được phép**. plan_claude HOẠT ĐỘNG ĐÚNG khi dùng thật.

**Nhưng hàm expand để HIỂN THỊ thì KHÔNG** (`modelGroup.ts:78`):
```ts
export function modelsForPlanGroups(planGroups: string[], groupMembers: Record<string,string[]>): string[] {
  if (planGroups.includes("*")) return ["*"];
  const seen = new Set<string>();
  for (const g of planGroups) {
    for (const m of groupMembers[g] ?? []) seen.add(m);  // ← chỉ tra theo TÊN NHÓM
  }
  return Array.from(seen);
}
```
→ Với `g = "claude-opus-4-8"`, `groupMembers["claude-opus-4-8"]` = undefined → `?? []`
→ không thêm gì → kết quả **rỗng**. Hàm này thiếu đúng cái nhánh mà `matchesGroups` đã có:
"nếu entry là tên model thật thì giữ nguyên nó".

→ Hệ quả: plan scoped theo model cụ thể **gọi API được nhưng card hiển thị rỗng** — user
không thấy plan gồm model gì, ngược đúng mục tiêu của endpoint.

## Fix gợi ý (1 hàm, cùng file)

Thêm nhánh giữ nguyên entry khi nó là một model thật (đối xứng với `matchesGroups`):

```ts
export function modelsForPlanGroups(planGroups: string[], groupMembers: Record<string,string[]>): string[] {
  if (planGroups.includes("*")) return ["*"];
  const seen = new Set<string>();
  // Tập tất cả model đã biết, để phân biệt "entry là tên nhóm" vs "entry là tên model".
  const known = new Set<string>(Object.values(groupMembers).flat());
  for (const g of planGroups) {
    const members = groupMembers[g];
    if (members && members.length) {
      for (const m of members) seen.add(m);   // entry là tên nhóm → expand
    } else if (known.has(g)) {
      seen.add(g);                              // entry là tên model cụ thể → giữ nguyên
    }
    // entry không khớp gì (nhóm rỗng / model lạ) → bỏ qua, như cũ
  }
  return Array.from(seen);
}
```

Sau fix, plan_claude → `models: ["claude-opus-4-8","claude-sonnet-4-6"]` (đúng 2 model
admin chọn). Không đụng enforcement/money path. Test thêm:
- plan dạng nhóm (`["claude"]`) vẫn expand union như cũ.
- plan dạng model (`["claude-opus-4-8"]`) giữ nguyên model.
- plan trộn (`["claude","gpt-5.5"]`) ra union nhóm + model.
- `["*"]` vẫn `["*"]`.

## Foza sẽ làm gì sau khi fix

Wire thẳng `plan.models` từ `/provision/plans` lên card (đã chuẩn bị sẵn). Không cần Foza
tự đoán hay copy regex. Chỉ chờ field `models` đúng cho mọi dạng `modelGroups`.

> Báo "đã fix" là Foza wire phần hiển thị (chỉ đụng `plans/page.tsx` + adapter).

---

## Phụ lục — file:line

- `modelsForPlanGroups` (bug): `apps/gateway/src/marketplace/utils/modelGroup.ts:78`
- `matchesGroups` (đã đúng, dùng làm tham chiếu): `modelGroup.ts:97` (có `planGroups.includes(model)`)
- Enforcement gọi `matchesGroups`: `marketplace/policy/marketplacePolicyCheck.ts:99`
- `GET /provision/plans` nhúng models: `marketplace/routes/provision.ts`
