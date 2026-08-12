# Câu hỏi cho X-Router — expose group → models (cho plan card của Foza)

> Bối cảnh: trang `/console/plans` của Foza hiển thị mỗi plan kèm danh sách model
> được bao gồm. Plan trên gateway lưu `modelGroups` (vd `["claude"]`, `["codex"]`,
> `["*"]`). Hiện Foza chỉ hiển thị được **tên nhóm thô** ("claude", "codex") chứ
> không phải danh sách model con cụ thể (vd `claude → claude-opus-4-8,
> claude-sonnet-4-6`), nên card kém trực quan.
>
> Tôi đã đọc code X-Router và thấy logic phân loại nằm ở
> `apps/gateway/src/marketplace/utils/modelGroup.ts` — `modelGroupOf(model)` phân
> loại bằng regex (`claude|sonnet|opus|haiku` → "claude"; `^codex|^gpt-|^o3|^o4|
> ^chatgpt` → "codex"; `gemini` → "gemini") + một `FREE_MODELS` Set cụ thể
> (`gpt-4o-mini`, `gemini-1.5-flash`, `gemini-2.0-flash`) → "free"; còn lại "other".
> Comment trong file ghi rõ đây là "the single place model→group classification
> lives". → X-Router là **nguồn sự thật** cho mapping này.

## Vấn đề

Mapping hiện là chiều **model → group** (phân loại 1 model ra 1 nhãn). Foza cần
chiều **ngược**: group → danh sách model thuộc nhóm đó, để render chip trên plan
card. Foza KHÔNG muốn tự copy regex sang vì:

- Sẽ **lệch** mỗi khi X-Router đổi rule (thêm group, sửa regex, thêm model vào
  `FREE_MODELS`) — plan sẽ hiển thị sai model mà không ai biết.
- Nhóm `free` đặc biệt: nó là một Set model cụ thể, KHÔNG suy được từ regex. Nếu
  Foza chỉ expand từ danh sách canonical hiện có (`gpt-5.5`, `claude-sonnet-4-6`,
  `claude-opus-4-8`, `gemini-2.5-pro`) thì nhóm `free` ra **rỗng** (không canonical
  nào khớp `FREE_MODELS`) → plan Free hiện 0 model.

## Câu hỏi / Đề xuất

**1. X-Router expose được chiều group → members không?** Hai lựa chọn, tùy phía
   bạn thấy hợp:

   **(a) Endpoint mới `GET /provision/model-groups`** (provision-scope, KHÔNG admin
   — đây là dữ liệu website hiển thị cho end-user):
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
   Mỗi group → danh sách model. `"*"` không cần liệt kê (Foza tự render "Tất cả
   model"). Lý tưởng nếu chỉ liệt kê các model **đang thực sự khả dụng** (có
   listing/canonical active) để khỏi show model chết.

   **(b) HOẶC nhúng `models` vào `GET /provision/plans`** — mỗi plan trả kèm danh
   sách model đã expand sẵn từ `modelGroups` của nó:
   ```json
   { "id": "plan_claude", "name": "Claude $10", "modelGroups": ["claude"],
     "models": ["claude-opus-4-8", "claude-sonnet-4-6"], ... }
   ```
   Cách này tiện nhất cho Foza (1 call, không cần tự join), và X-Router là bên
   biết chính xác nhất plan đó cho dùng model nào.

   → Foza nghiêng về **(b)** vì khớp đúng cái plan card cần. Nhưng (a) cũng tốt
   nếu bạn muốn tách riêng (Foza tự join group→members với plan.modelGroups).

**2. Nguồn để liệt kê members là gì?** Hiện `modelGroupOf` phân loại bất kỳ chuỗi
   model nào, nhưng không có "danh sách tất cả model tồn tại" để duyệt. Bạn định
   expand từ đâu — `canonicalBaseModels` (Set canonical), hay danh sách model thực
   tế có provider phục vụ? Foza muốn hiển thị model mà buyer **thực sự gọi được**
   khi mua plan đó, nên nguồn nào phản ánh đúng "khả dụng" là tốt nhất.

**3. `free` và `other` xử lý sao?** `free` = Set cứng trong code; `other` = model
   không khớp group nào. Hai nhóm này có nên xuất hiện trong response không, hay
   chỉ expose các group "có ý nghĩa thương mại" (claude/codex/gemini)? Plan Free
   của bạn dùng `modelGroups: ["free"]` nên Foza CẦN biết `free` gồm gì.

**4. Freshness:** mapping này gần như tĩnh (đổi khi thêm model/sửa rule). Foza có
   thể cache vài phút phía website không, hay nên gọi live mỗi lần? (Không phải
   tiền nên cache thoải mái, chỉ hỏi cho chắc.)

---

## Foza sẽ làm gì khi có câu trả lời

- Thay chip nhóm thô (`"claude"`, `"codex"`) trên plan card bằng danh sách model
  con thật (`claude-opus-4-8`, `claude-sonnet-4-6`...).
- Giữ `"*"` → nhãn "Tất cả model" như hiện tại (không cần expand).
- `totalModels` đếm theo số model thật thay vì số nhóm.

> Nếu chốt phương án, cho biết — Foza wire trong một thay đổi nhỏ phía website
> (chỉ đụng `plans/page.tsx` + adapter, không đụng money path).
