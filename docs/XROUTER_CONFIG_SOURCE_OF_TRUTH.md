# X-Router ↔ Foza website — cấu hình ĐỒNG NHẤT (single source of truth)

> Mục đích: tránh lặp lại sự cố "2 kho data / sai key / mất marketplace". Đây là
> nguồn sự thật DUY NHẤT về việc X-Router chạy ở đâu, dùng key gì, data nằm đâu.
> Cập nhật file này mỗi khi đổi key/port.

## Quy tắc vàng: CHỈ DÙNG MỘT instance

**Luôn chạy X-Router bằng lệnh `x-router` (global install).** KHÔNG chạy
`cd apps/gateway && npm run dev` cho mục đích "thật" — bản dev đó đọc
`apps/gateway/.env` riêng và trỏ vào `apps/gateway/data/` (một kho data KHÁC,
cũ hơn, KHÔNG có marketplace data của bạn). Lẫn 2 instance là nguyên nhân gốc
của mọi nhầm lẫn vừa rồi.

| | ✅ DÙNG cái này | ❌ KHÔNG dùng cho "thật" |
|---|---|---|
| Lệnh | `x-router` | `cd apps/gateway && npm run dev` |
| Port | 3100 | 8080 |
| Data | `~/.x-router/` | `apps/gateway/data/` |
| Config | `~/.x-router/config.json` | `apps/gateway/.env` |
| Marketplace data | CÓ (3 sellers, 2 listings...) | trống |

(Bản `npm run dev` chỉ dùng khi lập trình/sửa code, với data test riêng — đừng
nhầm nó là instance vận hành.)

## Nguồn sự thật về key/cờ: `~/.x-router/config.json`

X-Router (global) đọc cấu hình từ đây. Giá trị hiện tại:

| Thiết lập | Giá trị | Website (`.env.local`) phải khớp |
|---|---|---|
| `adminApiKeys` | `admin` | `XROUTER_ADMIN_KEY=admin` |
| `provisionApiKeys` | `provision-key-1` | `XROUTER_PROVISION_KEY=provision-key-1` |
| `internalApiKeys` | `xrk_b9e0494a0373fc8d3061ae406f06ade3` | `XROUTER_INTERNAL_KEY=xrk_b9e0...` |
| `marketplaceEnabled` | `true` | (website chỉ cần URL đúng) |
| port | 3100 | `XROUTER_URL=http://localhost:3100` |

→ Website Foza (`D:/Project/XRouter.ai/.env.local`) đã được chỉnh cho khớp BẢNG TRÊN.

## Đổi key/cờ thế nào (đừng sửa tay file JSON nếu tránh được)

X-Router có lệnh CLI ghi thẳng vào config.json + nhắc restart:

```
x-router --reset-admin-key            # admin key về "admin"
x-router --set-provision-key <key>    # đặt provision key
x-router --add-provision-key <key>    # thêm 1 provision key (xoay vòng)
x-router --set-marketplace on|off     # bật/tắt marketplace (BỀN, lưu vào config.json)
x-router --print-keys                 # in key đang dùng
```

(Đổi admin password cũng làm được trong dashboard → Settings.)

**Quy tắc:** mỗi khi đổi 1 trong các key trên ở X-Router → cập nhật dòng tương
ứng trong `XRouter.ai/.env.local` NGAY, rồi restart cả hai. Bảng "Nguồn sự thật"
ở trên là chỗ đối chiếu.

## Data nằm đâu (để backup / debug)

```
~/.x-router/config.json          # keys + marketplaceEnabled
~/.x-router/gateway-state.json   # JSON cũ (chỉ còn là nguồn import 1 lần; KHÔNG còn là live store)
~/.x-router/gateway.sqlite       # ⭐ LIVE STORE: config + usage_log + marketplace money
~/.x-router/server.log           # log server
```

Từ v0.4.0 trở đi, **dữ liệu sống nằm trong `gateway.sqlite`**, không phải file
JSON nữa (JSON chỉ được import một lần khi nâng cấp). Muốn backup → copy
`gateway.sqlite` (kèm `-wal`/`-shm` nếu server đang chạy).

## Checklist khi "thấy mất data" lần sau

1. Đang chạy instance nào? → `netstat -ano | findstr :3100` (đúng) vs `:8080` (dev, sai kho).
2. Marketplace bật? → `curl localhost:3100/v1/public/auth-info` → xem `marketplaceEnabled`.
3. Key khớp? → `x-router --print-keys` so với `.env.local`.
4. Data trong SQLite? → mở `~/.x-router/gateway.sqlite`, bảng `config_entities` / `usage_log`.

Hầu hết "mất data" thực ra là (1) nhầm instance hoặc (2) cờ/key lệch — KHÔNG phải
mất thật. File JSON cũ luôn còn ở `~/.x-router/gateway-state.json` làm phao cứu.
