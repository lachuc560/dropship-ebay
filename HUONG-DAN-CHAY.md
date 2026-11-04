# Hướng dẫn chạy Dropship eBay Helper

Chrome extension + Cloudflare Worker cho quy trình dropship: lưu sản phẩm từ Amazon, tải ảnh lên R2, tạo draft bằng AI, và điền form eBay **Sandbox**.

> Quy tắc cố định: extension **không bao giờ bấm List/Submit/Revise**. Seller tự bấm. Mọi thao tác eBay chỉ làm trên **sandbox.ebay.com**.

---

## 1. Yêu cầu

| Phần mềm | Phiên bản | Ghi chú |
|---|---|---|
| Node.js | 20 trở lên (đã test với 26) | https://nodejs.org |
| pnpm | 11.x | `npm i -g pnpm` |
| Git | bất kỳ | |
| Google Chrome | mới | để load extension |
| Tài khoản Cloudflare | miễn phí | cần cho D1 và R2 |

Tuỳ chọn: **VS Code** và **Docker Desktop** nếu muốn chạy trong container.

---

## 2. Tải project

```powershell
git clone https://github.com/<tài-khoản-của-bạn>/dropship-ebay.git
cd dropship-ebay
pnpm install
```

Nếu pnpm báo `ERR_PNPM_IGNORED_BUILDS` (esbuild, workerd, sharp), chạy:

```powershell
pnpm approve-builds --all
pnpm install
```

---

## 3. Chạy Worker (backend)

### 3.1. Chạy local (không cần Cloudflare)

```powershell
pnpm --filter worker db:migrate:local
pnpm --filter worker dev
```

Worker chạy tại `http://127.0.0.1:8787`. Kiểm tra:

```powershell
curl http://127.0.0.1:8787/health
```

Kết quả đúng: `{"ok":true,...}`

Dữ liệu local nằm trong `worker/.wrangler/` và không đồng bộ lên Cloudflare.

### 3.2. Dùng Cloudflare thật (tuỳ chọn)

Cần tài khoản Cloudflare và đăng nhập wrangler:

```powershell
cd worker
pnpm exec wrangler login
pnpm exec wrangler d1 create dropship-db
pnpm exec wrangler r2 bucket create dropship-images
```

Lệnh `d1 create` in ra `database_id`. Dán vào `worker/wrangler.toml` thay cho giá trị hiện có. Sau đó:

```powershell
pnpm exec wrangler d1 migrations apply dropship-db --remote
pnpm exec wrangler deploy
```

Đặt các secret (**không** dán vào chat, không commit):

```powershell
pnpm exec wrangler secret put GROQ_API_KEY
```

Khi dùng bản deploy, đổi `API_BASE` trong `extension/src/lib/api.ts` về URL Worker của bạn.

---

## 4. Chạy Extension

```powershell
pnpm --filter extension build
```

Load vào Chrome:

1. Mở `chrome://extensions`.
2. Bật **Developer mode** (góc trên bên phải).
3. Bấm **Load unpacked**.
4. Chọn thư mục `extension/.output/chrome-mv3`.
5. Bấm icon extension để mở side panel.

Khi sửa code extension, chạy lại `pnpm --filter extension build`, rồi bấm **Reload** trong `chrome://extensions`.

> Không dùng `pnpm dev:ext` nếu chỉ muốn dùng extension: nó mở một cửa sổ Chrome riêng và dễ gây đơ máy khi chạy nhiều tiến trình cùng lúc.

---

## 5. Luồng sử dụng

1. Mở trang sản phẩm Amazon (dạng `amazon.com/.../dp/...`).
2. Mở side panel → **Lưu sản phẩm**.
3. Bấm **Tải N ảnh lên** để đưa ảnh lên R2.
4. Bấm **Tạo draft AI** (cần `GROQ_API_KEY`).
5. Xem draft, bấm **Duyệt draft** khi đã đúng.
6. Mở trang tạo listing trên **sandbox.ebay.com**, bấm **Điền form eBay**.
7. Kiểm tra bảng kết quả. Tự kiểm tra form và **tự bấm List it** trên eBay.

---

## 6. Chạy test

```powershell
node worker/test-pricing.mjs
node worker/test-validate.mjs
node extension/test-amazon-parse.mjs
```

Kết quả đúng: mỗi file in `ALL PASS`.

---

## 7. Kiểm tra kiểu (typecheck)

```powershell
pnpm typecheck
```

---

## 8. Xử lý lỗi thường gặp

| Lỗi | Cách xử lý |
|---|---|
| `wrangler: not recognized` | Chạy qua pnpm: `pnpm exec wrangler ...`, hoặc `pnpm --filter worker exec wrangler ...` |
| Side panel trống | Load lại extension từ `.output/chrome-mv3`. Không dùng `dev:ext` cùng lúc. |
| `Không kết nối được Worker` | Worker chưa chạy, hoặc `API_BASE` trỏ sai. |
| `Tab hiện tại không phải Amazon` | Mở trang sản phẩm Amazon trước khi lưu. |
| `chưa cấu hình GROQ_API_KEY` | Chạy `wrangler secret put GROQ_API_KEY`. |
| Máy chậm | Dừng các tiến trình `wrangler`, `workerd`, `wxt` còn sót trong Task Manager. |

---

## 9. Cấu trúc thư mục

```
dropship-ebay/
├── extension/          # Chrome extension (WXT + React)
│   ├── entrypoints/    # side panel, content scripts, background
│   └── src/            # adapter Amazon, điền form eBay, API client
├── worker/             # Cloudflare Worker (Hono)
│   ├── src/            # route, ảnh, AI, giá, validate
│   └── migrations/     # schema D1
├── shared/             # kiểu dữ liệu dùng chung
└── HUONG-DAN-CHAY.md   # file này
```

---

## 10. Bảo mật

- Không commit `.env`, `.dev.vars`, API key, token, cookie, mật khẩu.
- Key AI chỉ đặt bằng `wrangler secret put`, không để trong code.
- Nếu lỡ lộ key: thu hồi ngay trên trang nhà cung cấp, rồi tạo key mới.
