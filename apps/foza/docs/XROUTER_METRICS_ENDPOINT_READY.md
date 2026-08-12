# ✅ X-Router đã build xong endpoint metrics per-listing

> Trả lời cho `QUESTIONS_FOR_XROUTER_METRICS.md`. Chi tiết kỹ thuật đầy đủ ở
> `ANSWERS_FROM_XROUTER_METRICS.md`. File này là thông báo ngắn "dùng được rồi".

## Tóm tắt

Endpoint **`GET /provision/listings/metrics`** đã implement + test + merge (X-Router
main, chờ deploy). Foza hiển thị được **5/6 chỉ số động** từ MỘT call provision-key.
Chỉ số thứ 6 (Context window) Foza tự maintain bảng tĩnh — X-Router không có metadata đó.

## Cách dùng

```
GET /provision/listings/metrics?baseModel=<optional>&since=<ISO optional>
Authorization: Bearer <PROVISION_KEY>   # KHÔNG dùng admin key
```

Response:
```json
{
  "meta": { "settlementWindowSince": null, "successHorizon": "lifetime", "latencyWindowSeconds": 300 },
  "metrics": [{
    "listingId": "...", "sellerId": "...", "baseModel": "gpt-5.5",
    "providerInstanceId": "...", "providerAccountId": "...",
    "requests": 128, "promptTokens": 40231, "completionTokens": 18420, "totalTokens": 58651,
    "successRate": 0.98, "totalRequestsLifetime": 1500, "failedRequestsLifetime": 30,
    "latencyP50Ms": 120, "latencyP95Ms": 800, "rps": 0.42
  }]
}
```

## Map sang 6 card metric

| Card | Field | Lưu ý |
|---|---|---|
| Requests | `requests` | settlement window (`since`); đã loại record refund |
| Token | `totalTokens` | (hoặc tách `promptTokens`/`completionTokens`) |
| Success % | `successRate` | **LIFETIME** per account (×100 để ra %); `null` = chưa có data → hiện "—" |
| Latency | `latencyP95Ms` (hoặc `latencyP50Ms`) | rolling 5 phút; `null` = không traffic → "—" |
| RPS | `rps` | rolling 5 phút; nếu thấp, cân nhắc đổi sang req/phút |
| Context | — | **Foza tự maintain bảng tĩnh** `baseModel → context`; X-Router không trả |

## 3 điều BẮT BUỘC lưu ý (để không hiển thị sai)

1. **null ≠ 0.** Field `null` nghĩa là "chưa có dữ liệu" → hiện "—", ĐỪNG render thành 0
   hay 100%. X-Router không bao giờ bịa số.
2. **3 chân trời thời gian khác nhau** (đọc `meta`): requests/tokens theo `since`;
   successRate là lifetime tích luỹ (KHÔNG phải 24h); latency/rps là 5 phút gần nhất.
   Đừng gộp chúng thành "một con số sức khoẻ".
3. **Grain `(sellerId, baseModel)` cho requests/tokens.** Nếu một seller có NHIỀU listing
   cùng baseModel (khác account), requests/tokens của chúng bị gộp chung (settlement_log
   không lưu tới account). successRate/latency thì đúng per-account (qua `providerAccountId`).

## Freshness

Cập nhật gần realtime (settlement ghi ngay khi request settle; latency là cửa sổ trượt 5
phút). Card poll mỗi vài phút là đủ. Lưu ý latency/rps là in-memory → reset khi X-Router
restart (sẽ "—" vài phút sau restart rồi đầy lại).

Có gì cần thêm (vd muốn cửa sổ success 24h thay vì lifetime, hay thêm context vào canonical
model metadata) thì báo — làm được.
