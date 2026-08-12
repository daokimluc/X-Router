# Câu hỏi cho X-Router — `/provision/wallet/topup` cần idempotency key

> ✅ **ĐÃ GIẢI QUYẾT (X-Router v0.6.3).** Trả lời: `ANSWERS_FROM_XROUTER_TOPUP_REVERSAL.md`.
> `wallet/topup` nhận `idempotencyKey` (dedupe trên `wallet_ledger`, trả `idempotent:true`
> khi trùng). Foza gửi `topup.id` làm key; luồng SePay giờ retry an toàn (không double-credit).
> Giữ file này làm lịch sử.

---

> Bối cảnh: khi vá lỗi HIGH ở luồng SePay credit (audit money-path 2026-06-01),
> phát hiện `POST /provision/wallet/topup` **không idempotent** — khác với
> `/provision/token-pack` (đã có `idempotencyKey`). Điều này làm Foza không thể
> tự động retry an toàn khi credit ví thất bại mơ hồ (gateway có thể đã commit
> nhưng response bị mất).

## Hiện trạng đã verify trong code X-Router

`marketplace/routes/provision.ts:192-200`:

```ts
app.post("/provision/wallet/topup", privOpts, async (request, reply) => {
  const p = z.object({ keyId: ..., usd: ..., amountUsd: ... }).safeParse(request.body);
  ...
  const walletUsd = app.walletService.topupUsd(p.data.keyId, amount); // CỘNG DỒN mỗi lần gọi
  app.apiKeyService.setWalletMicroUsd(...);
  return { keyId, walletUsd };
});
```

→ Mỗi lần POST là **cộng thêm** `amount` vào ví. Gọi 2 lần = credit gấp đôi.
Đối chiếu: `/provision/token-pack` (`:169-183`) nhận `idempotencyKey` và
`tokenGrantService.grant` dedupe theo key đó → gọi lại = trả về grant cũ, không
cấp thêm.

## Vì sao Foza cần điều này

Luồng SePay (Foza `api/webhooks/sepay/route.ts`): khi nhận tiền về, Foza
claim row (pending→crediting) → gọi gateway credit → finalize. Nếu gateway
credit **ném lỗi**:
- **token-pack** (idempotent): Foza release row về pending → SePay retry / reconcile
  gọi lại an toàn (không double-grant). ✅
- **wallet topup** (KHÔNG idempotent): Foza **không dám** release để retry, vì
  lỗi 5xx/timeout có thể nghĩa là gateway ĐÃ commit rồi mới mất response →
  retry sẽ credit 2 lần. Foza đành để row ở `crediting` và chờ **reconcile tay**. ⚠️

→ Tiền đã về tài khoản bank nhưng ví chưa được cộng, phải xử lý thủ công.

## Xin X-Router

Cho `POST /provision/wallet/topup` nhận thêm field `idempotencyKey` (optional,
string). Khi có key:
- Lần đầu với key đó → credit ví bình thường, lưu lại key.
- Gọi lại CÙNG key → **không cộng thêm**, trả về `walletUsd` hiện tại (giống
  cách token-pack dedupe trên `idempotencyKey`).

Foza sẽ dùng `topup.id` (id của row pending top-up, ổn định mỗi giao dịch) làm
`idempotencyKey` — đúng pattern đang dùng cho token-pack.

## Câu hỏi cụ thể

1. Có thể thêm `idempotencyKey` cho `wallet/topup` không? Dedupe ở đâu —
   `WalletService.topupUsd` hay một bảng riêng như token-pack?
2. Response khi trùng key: trả `walletUsd` hiện tại + cờ `idempotent: true`
   (giống grant) được không, để Foza biết là no-op chứ không phải credit mới?
3. TTL của idempotency key (giữ vĩnh viễn / theo cửa sổ thời gian)? Foza chỉ cần
   đủ lâu để bao trọn vòng retry của SePay (vài giờ là thừa).
