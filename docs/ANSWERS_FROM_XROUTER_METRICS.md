# Trả lời từ X-Router — metrics per-listing cho Marketplace card

> Người trả lời: X-Router engine. Tất cả câu trả lời dưới đây bám theo code thật
> (file:line trong `apps/gateway/src`), không phải dự định. Phần "đề xuất làm thêm"
> được tách riêng và đánh dấu rõ là CHƯA có.

## TL;DR (đọc cái này trước)

| Chỉ số | Có nguồn? | Grain tốt nhất hiện có | Khuyến nghị |
|---|---|---|---|
| **Requests** | ✅ Foza tự tính được | per `(sellerId, baseModel)` từ `settlement_log` / `usage.recorded` | **HIỂN THỊ** — Foza tự group, không cần endpoint mới |
| **Token** | ✅ Foza tự tính được | per `(sellerId, baseModel)` | **HIỂN THỊ** — như trên |
| **Success %** | ⚠️ có nhưng grain thô | per **account** (cumulative) hoặc per `(instance,model)` 5-min | Xem mục 4 — cần endpoint mới để dùng đúng. Tạm thời **BỎ** hoặc gắn nhãn rõ |
| **Latency p50/p95** | ⚠️ có, in-memory 5-min | per `(providerInstanceId, publicModel, accountId)` | Cần endpoint provision mới (giờ chỉ ở admin). Xem mục 1+4 |
| **Context window** | ❌ không per-canonical-model | nằm ở adapter capability (per provider type) | **Foza tự maintain bảng tĩnh** (xem mục 5) |
| **RPS** | ⚠️ suy ra được | từ latency `count`/300 hoặc requests/window | **Foza tự tính** từ requests; xem mục 6 |

**Kết luận thẳng:** hôm nay, **Requests + Token** là 2 chỉ số Foza dựng được ngay từ data đã có (qua `usage.recorded` / `/provision/settlements`), KHÔNG cần X-Router làm gì thêm. 4 chỉ số còn lại cần một endpoint provision mới (chưa có) hoặc nên bỏ. Chi tiết dưới.

---

## 1. Có endpoint provision trả metrics per-listing không?

**Hiện tại: KHÔNG.** Không có `/provision/listings/metrics`, và `GET /provision/listings`
(`marketplace/routes/provision.ts:273`) chỉ trả `SellerListing` thuần — không nhúng metrics:

```ts
// SellerService.ts:39
export type SellerListing = {
  id; sellerId; baseModel; displayName; namespacedModel;
  costPrice; providerInstanceId; providerAccountId; enabled; createdAt;
};
```

Các số bạn cần đang nằm tản ở 3 nơi, **2 store khác nhau về bản chất**:

- **Money/usage bền (SQLite):** `settlement_log` (qua `GET /provision/settlements`,
  `provision.ts:308`) + `usage_log` (qua `GET /provision/usage`, `provision.ts:285`).
  → có `requests`, `tokens`, group được theo `sellerId`/`baseModel`. **Bền qua restart.**
- **Latency (in-memory, 5-min rolling):** `LatencyTrackerService`
  (`services/LatencyTrackerService.ts`) — CHỈ expose qua `GET /admin/v1/metrics/latency`
  (admin key). **Mất khi restart, chỉ giữ cửa sổ 5 phút.**
- **Success count (in-memory, cumulative lifetime):** `ProviderAccount.runtime`
  (`providers/base/ProviderAccount.ts:3`) — `totalRequests`/`failedRequests` per account.

→ Muốn có MỘT endpoint provision gộp tất cả theo listing thì **phải làm mới** (xem
phần "Đề xuất" cuối). Còn nếu chấp nhận grain `(sellerId, baseModel)` cho
requests+tokens thì **Foza tự gộp được ngay, không cần gì thêm**.

---

## 2. Grain của metrics

Đây là điểm mấu chốt — **grain không khớp nhau giữa các nguồn:**

| Nguồn | Key | Map về 1 listing được không? |
|---|---|---|
| `settlement_log` | `(seller_id, base_model)` + `request_id` — **KHÔNG có providerAccountId** | ❌ chỉ tới `(seller, baseModel)`, không tới account của listing |
| `usage_log` | `(api_key_hash, model)` — model là **public model**, không phải account | ❌ |
| LatencyTracker | `(providerInstanceId, publicModel, accountId)` | ✅ map được nếu biết `providerAccountId` của listing |
| `ProviderAccount.runtime` | per `accountId` | ✅ map được qua `listing.providerAccountId` |

Listing có cả `providerInstanceId` + `providerAccountId` (`SellerListing`, mục 1). Nên:

- **Latency + success theo runtime account**: map được về đúng 1 listing qua
  `listing.providerAccountId`. NHƯNG latency key là bộ ba `(instance, publicModel,
  accountId)` — một account phục vụ nhiều publicModel sẽ có nhiều tuple; bạn phải
  cộng/lọc theo `accountId` (và optionally theo publicModel nếu muốn per-model).
- **settlement/usage**: KHÔNG xuống được tới account. `settlement_log` chỉ có
  `seller_id` + `base_model`. Nên requests/tokens chỉ chính xác tới mức
  `(sellerId, baseModel)` — **gộp tất cả account của seller đó cho model đó**. Với
  marketplace của các bạn (1 listing ≈ 1 seller cung cấp 1 baseModel) thì thường
  `(sellerId, baseModel)` ≈ 1 listing, **trừ khi** một seller có nhiều listing cùng
  baseModel khác account → khi đó số sẽ bị gộp. Cần xác nhận ràng buộc này ở phía Foza.

**successRate nên tính per-account hay per-model?** → **per-account** đúng hơn cho card
listing, vì lỗi auth/cooldown là thuộc tính của account/credential cụ thể, không phải
của model. Dùng `runtime.failedRequests / runtime.totalRequests` của
`listing.providerAccountId`. (Cảnh báo: đây là **cumulative lifetime**, không phải tỉ lệ
gần đây — xem mục 4.)

---

## 3. Requests + Token — Foza tự tính được không?

**ĐÚNG, tự tính được, không cần endpoint mới.** Foza đã giữ `billing_ledger` dựng từ
`usage.recorded`. Payload `usage.recorded` (`marketplace/policy/settlementHook.ts:195`):

```ts
request.settlement = {
  settlementId, buyerKeyId, buyerKeyHash,
  baseModel,        // ← canonical (xem cạm bẫy bên dưới)
  sellerId,
  promptTokens, completionTokens,
  actualSellCost, sellerCredit, platformMargin, billTrack
};
// emit: webhookService.notifyBusiness("usage.recorded", {...request.settlement})  (:211)
```

→ group theo `baseModel` (hoặc `(sellerId, baseModel)`):
- `requests` = count số record
- `tokens` = sum(promptTokens + completionTokens)

**Cạm bẫy `baseModel` — quan trọng:**
- `baseModel` trong `usage.recorded` LÀ **canonical** (vd `claude-opus-4-8`), không phải
  namespaced (`sellerName/claude-opus-4-8`). Lấy từ `routed.baseModel` =
  `listing.baseModel`, và listing chỉ cho tạo nếu baseModel nằm trong danh sách canonical
  (`SellerService.ts:203`). Listing có thêm `namespacedModel = "${displayName}/${baseModel}"`
  (`SellerService.ts:207`) nhưng cái đó KHÔNG đi vào settlement.
- **Fallback case:** nếu request đi qua route KHÔNG có listing (unlisted), `baseModel`
  rơi về `ctx.model` (`settlementHook.ts:103`) — có thể là public model client gửi, không
  đảm bảo canonical. Với listing thật thì luôn canonical; chỉ cảnh giác các record house/
  fallback.
- **Reversed:** `settlement_log` có cờ `reversed` (refund). `usage.recorded` emit lúc
  settle (trước khi reverse), nên billing_ledger của Foza nên trừ các settlement bị
  reverse (lấy qua `GET /provision/settlements`, field `reversed: boolean`) để không
  đếm thừa request/token đã hoàn.

**Nguồn bền hơn webhook:** nếu sợ miss webhook, dùng `GET /provision/settlements?since=...`
(`provision.ts:308`) — replay từ SQLite, mỗi row có `baseModel, sellerId, promptTokens,
completionTokens, collected, reversed, ts, requestId`. Đây là nguồn reconcile chuẩn để
dựng lại requests+tokens cho bất kỳ cửa sổ nào.

---

## 4. successRate — có expose count success/fail per listing cho provision không?

**Hiện tại: KHÔNG có qua provision key.** Hai nguồn, cả hai đều có vấn đề:

**(a) `ProviderAccount.runtime`** (`ProviderAccount.ts:3`):
```ts
runtime: { activeRequests, totalRequests, failedRequests, consecutiveFailures,
           lastUsedAt?, lastSuccessAt?, lastFailureAt?, lastError?, cooldownUntil? }
```
- **Bền hay reset?** → **BỀN**. `runtime` là một phần của `ProviderAccount` và được
  persist (qua `createPersistedState` → JSON/SQLite ConfigStore). KHÔNG reset khi restart.
- **Nhưng:** đây là **cumulative lifetime** (tổng từ đầu đời account), không phải tỉ lệ
  gần đây. Một account chạy 6 tháng có 2% lỗi cũ sẽ luôn hiện ~98% dù tuần này 100%. Card
  marketplace hiển thị số "đời đời" này dễ gây hiểu nhầm.
- **Không tới provision endpoint nào** hiện giờ. Chỉ ra qua `GET /admin/v1/accounts`
  (admin key) — KHÔNG nên đưa vào đường hiển thị public.

**(b) LatencyTracker** ghi riêng ok/error count theo `(instance, publicModel, accountId)`
trong cửa sổ 5 phút (`LatencyTrackerService.ts:59` — `ok.count` + `error.count`). →
successRate gần-đây = `ok.count / (ok.count + error.count)`. Nhưng cũng chỉ ở admin
endpoint, và cửa sổ chỉ 5 phút (request thưa thì mẫu quá nhỏ).

**Khuyến nghị:** thành thật mà nói, success% per-listing **chưa có nguồn provision sạch**.
Hai lựa chọn:
- **Tạm BỎ** chỉ số này (đúng tinh thần "thà bỏ còn hơn show 100% cứng"), HOẶC
- Đợi endpoint provision mới (đề xuất cuối) trả success per-account từ `runtime`, và
  **gắn nhãn rõ là "lifetime"** chứ đừng để người ta tưởng là 24h.

---

## 5. context (context window) — X-Router có trả per-baseModel không?

**KHÔNG per-canonical-model.** Context window sống ở 2 chỗ, đều KHÔNG map theo canonical
baseModel và KHÔNG ra provision:
- `ProviderCapabilities.maxInputTokens` — per **adapter/provider type** (vd Kiro =
  200000), không per model.
- `ProviderInstance.maxInputTokens` — override per instance (do admin cấu hình), optional.
- Danh sách canonical baseModel (`SellerService.canonicalBaseModels`) chỉ là
  `Set<string>` tên model — **không kèm metadata** context window.

→ **Foza tự maintain bảng tĩnh** `baseModel → context window` ở phía website. Đây vốn là
thuộc tính tĩnh của model (như bạn nói), không phải metric đo, nên việc website giữ một
bảng nhỏ (claude-opus-4-8 → 200k, gpt-5.5 → ..., v.v.) là hợp lý và không phụ thuộc
X-Router. Nếu sau này muốn X-Router làm "nguồn sự thật", cần thêm metadata vào danh sách
canonical model — báo nếu cần, không khó.

---

## 6. RPS — X-Router tính sẵn không?

**Không có field "rps" tính sẵn.** Nhưng suy ra được 2 cách:
- Từ LatencyTracker: `count` (ok+error) trong cửa sổ 5 phút (`windowSeconds: 300`) →
  `rps ≈ count / 300`. Chính xác là "rps trung bình 5 phút gần nhất", nhưng chỉ ở admin
  endpoint + in-memory.
- Từ settlement/usage (Foza tự làm): đếm record trong cửa sổ rồi chia. **Khuyến nghị
  cửa sổ 5 phút** để khớp với latency window và đủ mượt cho card (1 phút quá nhiễu với
  traffic marketplace thưa). Công thức: `rps = requests_trong_5_phút / 300`.

Lưu ý: với marketplace traffic thấp, RPS sẽ ra số rất nhỏ (0.0x) → cân nhắc hiển thị
"req/phút" hoặc "req/giờ" cho dễ đọc thay vì RPS thô.

---

## 7. Khuyến nghị tổng (6 chỉ số nên hiển thị / nên bỏ)

| Chỉ số | Khuyến nghị | Lý do |
|---|---|---|
| **Requests** | ✅ **HIỂN THỊ** | Foza tự dựng từ `usage.recorded`/`/provision/settlements`, nguồn bền, chính xác tới `(sellerId, baseModel)` |
| **Token** | ✅ **HIỂN THỊ** | Như Requests |
| **RPS** | ✅ **HIỂN THỊ** (Foza tự tính, cửa sổ 5 phút) | Suy ra từ Requests; cân nhắc đổi đơn vị sang req/phút nếu traffic thấp |
| **Context** | ✅ **HIỂN THỊ** (bảng tĩnh phía Foza) | Thuộc tính tĩnh, không cần X-Router; Foza maintain |
| **Success %** | ⚠️ **BỎ tạm** (hoặc chờ endpoint mới + nhãn "lifetime") | Chưa có nguồn provision sạch; runtime là cumulative dễ gây hiểu nhầm |
| **Latency p50/p95** | ⚠️ **BỎ tạm** (hoặc chờ endpoint provision mới) | Chỉ có ở admin key + in-memory 5-min; chưa expose qua provision |

→ **Ship được ngay (không cần X-Router đổi code):** Requests, Token, RPS, Context.
→ **Cần X-Router làm endpoint mới hoặc nên ẩn:** Success%, Latency.

---

## Đề xuất X-Router làm thêm (✅ ĐÃ LÀM — `GET /provision/listings/metrics`)

> **Cập nhật:** endpoint này đã được implement + test + merge (xem
> `Accountrouter/docs/PROVISION_API_REFERENCE.md`). Không còn là "đề xuất" — dùng được.

**`GET /provision/listings/metrics`** (provision-scope, KHÔNG admin), trả per listing:
```json
{
  "meta": { "settlementWindowSince": null, "successHorizon": "lifetime", "latencyWindowSeconds": 300 },
  "metrics": [{
    "listingId", "sellerId", "baseModel", "providerInstanceId", "providerAccountId",
    "requests", "promptTokens", "completionTokens", "totalTokens",   // settlement window (since), loại reversed
    "successRate", "totalRequestsLifetime", "failedRequestsLifetime", // LIFETIME per account
    "latencyP50Ms", "latencyP95Ms", "rps"                            // rolling 5-min; null nếu không có traffic
  }]
}
```
Query: `?baseModel=` (lọc 1 model), `?since=<ISO>` (cửa sổ đếm requests/tokens).

**Hợp đồng freshness — đọc `meta`, ĐỪNG trộn 3 chân trời:**
- `requests`/`*Tokens`: tổng settlement đã settle trong `since`, **đã loại `reversed`**.
  Group theo `(sellerId, baseModel)` — nếu 1 seller có nhiều listing cùng baseModel khác
  account thì bị gộp.
- `successRate`/`*Lifetime`: **cumulative lifetime** account (không phải 24h). `null` nếu
  chưa từng phục vụ request.
- `latency*`/`rps`: rolling 5 phút in-memory (mất khi restart). `null` nếu không traffic.
- **Không bịa số:** thiếu nguồn → `null` (không 100%/0 giả).

→ Giờ Foza có thể hiển thị đủ 5 chỉ số động (Requests, Token, Success, Latency, RPS) từ
MỘT endpoint provision; Context window vẫn là bảng tĩnh phía Foza (mục 5).

---

## (Lưu trữ) Đề xuất ban đầu — đã thực hiện ở trên

Nếu các bạn muốn Success% + Latency per-listing qua provision key, X-Router có thể thêm:

**`GET /provision/listings/metrics`** (provision-scope, KHÔNG admin), trả per listing:
```
{
  listingId, sellerId, baseModel, providerAccountId,
  requests,            // từ settlement_log group (sellerId, baseModel)
  tokens,              // sum prompt+completion
  successRate,         // từ ProviderAccount.runtime của providerAccountId (gắn nhãn lifetime)
  latencyP50, latencyP95,  // từ LatencyTracker filter theo accountId (5-min rolling)
  rps,                 // latency count / 300
  windowNote: "latency/rps = rolling 5m; success = lifetime; requests/tokens = since-window"
}
```
Việc này gộp đúng 3 nguồn về listing qua `providerAccountId` (mapping đã khả thi vì
`SellerListing` có sẵn field này). Effort vừa phải, không cần schema mới — chỉ là một
read-aggregator. **Cảnh báo trung thực cần kèm:** latency/rps là 5-phút in-memory (mất khi
restart), success là lifetime — phải gắn nhãn để card không trộn 3 chân trời thời gian
khác nhau thành "1 con số".

Nếu Foza chốt muốn endpoint này, cho biết — tôi viết được trong một change OpenSpec nhỏ
(provision-read scope, không đụng money path).

---

## Phụ lục — file:line tham chiếu

- Listing shape: `marketplace/services/SellerService.ts:39` (`SellerListing`)
- `GET /provision/listings`: `marketplace/routes/provision.ts:273`
- `GET /provision/usage` (usage_log, bền): `marketplace/routes/provision.ts:285`
- `GET /provision/settlements` (settlement replay, bền): `marketplace/routes/provision.ts:308`
- `SettlementLedger.query()` shape: `marketplace/services/SettlementLedger.ts:214`
  (có `baseModel, sellerId, promptTokens, completionTokens, reversed, requestId, ts` — KHÔNG có accountId)
- `usage.recorded` payload: `marketplace/policy/settlementHook.ts:195` + emit `:211`
- LatencyTracker grain + snapshot: `services/LatencyTrackerService.ts:44,59,187`
  (key `(providerInstanceId, publicModel, accountId)`, window 300s, ok/error count tách riêng)
- ProviderAccount runtime: `providers/base/ProviderAccount.ts:3`
  (totalRequests/failedRequests, persisted/bền, cumulative lifetime)
- Admin-only latency endpoint: `GET /admin/v1/metrics/latency`
- Context window (per provider type, KHÔNG per canonical model): `ProviderCapabilities.maxInputTokens`,
  `ProviderInstance.maxInputTokens`
