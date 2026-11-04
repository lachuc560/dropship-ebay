# Dropship eBay Helper

Chrome extension + backend Cloudflare cho quy trình dropship: lưu sản phẩm từ Amazon/Walmart/eBay, AI tối ưu listing, lưu ảnh lên R2, rồi **tự điền form eBay**. Extension **không bao giờ tự bấm "List it"**, và mọi phát triển chỉ chạy trên **eBay Sandbox**.

## Cấu trúc

```
default-workspace/
├── extension/        # WXT + React (Manifest V3), side panel
├── worker/           # Cloudflare Worker + Hono, D1, R2
│   ├── src/index.ts
│   ├── migrations/   # Schema D1
│   └── wrangler.toml
├── package.json      # Script gốc (pnpm workspace)
└── pnpm-workspace.yaml
```

## Yêu cầu

- Node.js >= 20 (đã kiểm tra với v26.13.0)
- pnpm 11.x (`npm i -g pnpm` hoặc dùng bản đã cài)
- Tài khoản Cloudflare (cho D1, R2 và Worker)
- Chrome / Chromium để load extension

## Cài đặt

```bash
pnpm install
```

## Chạy Worker (local)

1. Tạo D1 và R2 (chỉ làm một lần):

   ```bash
   pnpm --filter worker exec wrangler d1 create dropship-db
   pnpm --filter worker exec wrangler r2 bucket create dropship-images
   ```

2. Dán `database_id` mà lệnh `d1 create` trả về vào `worker/wrangler.toml` (thay `REPLACE_WITH_D1_ID`).

3. Chạy migration và khởi động server:

   ```bash
   pnpm --filter worker db:migrate:local
   pnpm dev:worker
   ```

4. Kiểm tra:

   ```bash
   curl http://localhost:8787/health
   curl http://localhost:8787/health/db
   ```

## Chạy Extension (local)

```bash
pnpm dev:ext
```

WXT sẽ tạo thư mục build cho Chrome. Mở `chrome://extensions`, bật **Developer mode**, rồi chọn **Load unpacked** và trỏ tới thư mục `extension/.output/chrome-mv3-dev`. Bấm icon extension để mở side panel.

## Quy tắc bắt buộc

- Dev và test chỉ trên **eBay Sandbox** (`sandbox.ebay.com`). Không bật Production.
- Không có code bấm List / Submit / Revise. Seller tự bấm.
- Không commit `.env`, `.dev.vars`, API key, token, cookie hay mật khẩu. Secret đặt bằng `wrangler secret put`.
- Mỗi phase: README chạy thử + test + báo cáo.

## Tiến độ

- [x] **Phase 0** — Khung repo, extension side panel, Worker `/health`, schema D1 khởi tạo
- [ ] Phase 1 — Crawl Amazon + lưu sản phẩm
- [ ] Phase 2 — Ảnh lên Cloudflare R2
- [ ] Phase 3 — AI tối ưu + màn hình duyệt
- [ ] Phase 4 — Tự điền form eBay Sandbox
- [ ] Phase 5 — Mở rộng

## Việc anh cần làm thủ công (Phase 0)

- [ ] Tạo tài khoản eBay Sandbox và tự list tay 3 sản phẩm để hiểu form
- [ ] Tạo tài khoản Cloudflare, chạy các lệnh tạo D1/R2 ở trên
