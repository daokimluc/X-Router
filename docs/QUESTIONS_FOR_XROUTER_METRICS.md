# Câu hỏi cho X-Router — metrics hiển thị trên card listing (Marketplace)

> Bối cảnh: trang Marketplace của Foza hiển thị mỗi listing (model gói) dưới dạng
> card với 6 chỉ số: **Requests, Thành công (success %), Token, Ngữ cảnh (context
> window), Độ trễ (latency), RPS**. Hiện chúng đang là "—" (hoặc 100% mặc định cứng)
> cho listing thật, vì Foza chưa có nguồn dữ liệu per-listing.
>
> Tôi đã đọc code X-Router và thấy phần lớn dữ liệu ĐÃ tồn tại nội bộ — câu hỏi là
> cách expose ra cho website (qua provision key, không phải admin key, vì đây là dữ
> liệu website hiển thị cho end-user). Đã xác minh:
> - `LatencyTrackerService` (p50/p95/p99 per providerInstanceId+publicModel+accountId)
>   — expose qua `GET /admin/v1/metrics/latency` (admin).
> - `ProviderAccount` runtime: `totalRequests, failedRequests, consecutiveFailures,
>   lastSuccessAt`.
> - `UsageService.totalRequests` per model/key; `settlement_log` có tokens per record.

---

## Câu hỏi

**1. Có endpoint provision-key nào (hoặc dự định) trả metrics PER baseModel /
   PER listing không?** Lý tưởng là một cái như
   `GET /provision/listings/metrics` hoặc field metrics nhúng vào
   `GET /provision/listings`, trả mỗi listing/model:
   - `requests` (tổng request đã settle)
   - `successRate` (thành công / tổng — từ failedRequests?)
   - `tokens` (tổng prompt+completion)
   - `latencyP50`/`latencyP95` (ms)
   - `rps` (rolling)
   Hiện những số này tản ở `LatencyTrackerService` + `ProviderAccount` runtime +
   `UsageService`/`settlement_log`. Website có cách gộp chúng theo model qua MỘT
   endpoint provision không, hay phải tự suy ra?

**2. Grain của metrics là gì?** Latency tracker key theo
   `(providerInstanceId, publicModel, accountId)`. Một listing = `(sellerId,
   baseModel, providerInstanceId, providerAccountId)`. Vậy:
   - Có map được latency/success về đúng **một listing** (theo accountId của listing
     đó) không, hay metrics chỉ ở mức instance/model (gộp nhiều seller)?
   - `successRate` nên tính per-account (`failedRequests/totalRequests` của account
     trong listing) hay per-model?

**3. `requests` + `tokens` — Foza tự tính từ data đang có được không?**
   Foza đã giữ `billing_ledger` (per settlement: buyerKeyId, baseModel,
   promptTokens, completionTokens) dựng từ `usage.recorded`. Vậy Foza CÓ THỂ tự
   group theo `baseModel` để ra requests + tokens mà KHÔNG cần endpoint mới — đúng
   không? Có cạm bẫy gì (vd baseModel trong usage.recorded là canonical hay
   namespaced)?

**4. `successRate` — X-Router có expose count thành công/thất bại per model/listing
   cho provision key không?** `ProviderAccount.failedRequests/totalRequests` là
   runtime in-memory (reset khi restart?) hay bền? Nó có ra tới provision endpoint
   nào không? Nếu không, website nên bỏ chỉ số này hay bạn định thêm?

**5. `context` (ngữ cảnh / context window)** — đây là thuộc tính TĨNH của model, không
   phải metric đo. X-Router có nơi nào trả context window per baseModel (model
   metadata) cho provision key không, hay website tự maintain bảng tĩnh?

**6. `rps`** — có phải là rolling rate X-Router tính sẵn ở đâu không, hay chỉ là
   `requests / khoảng thời gian` website tự tính? Nếu phải tự tính, bạn khuyến nghị
   cửa sổ nào (1 phút? 5 phút?).

**7. Khuyến nghị tổng:** Trong 6 chỉ số (Requests, Success, Token, Context, Latency,
   RPS), cái nào bạn cho là website NÊN hiển thị (có nguồn đáng tin), cái nào nên BỎ
   (chưa có nguồn / dễ gây hiểu lầm)? Mục tiêu của tôi là không hiển thị số giả —
   thà bỏ còn hơn show "—" hoặc 100% cứng.

---

## Điều Foza KHÔNG cần

- Không cần realtime streaming — số liệu cập nhật mỗi vài phút là đủ cho card
  marketplace.
- Không muốn dùng admin key cho việc hiển thị end-user — nếu metrics chỉ có ở
  `/admin/v1/*`, cho tôi biết để cân nhắc (admin key god-mode, hạn chế đưa vào
  đường hiển thị công khai).
