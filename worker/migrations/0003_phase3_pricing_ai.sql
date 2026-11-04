-- Phase 3 (mục 4.3, 4.5): cấu hình giá mặc định và các cột phục vụ validate/duyệt.

-- Cấu hình giá (mục 4.5). Kế toán/trưởng team sửa được qua bảng settings, không cần đổi code.
INSERT OR IGNORE INTO settings (key, value) VALUES
  ('profit_pct', '0.25'),
  ('ebay_fee_pct', '0.15'),
  ('tax_estimate_pct', '0'),
  ('price_rounding', '.99'),
  ('ai_model', 'gemini-2.5-flash'),
  ('title_max_chars', '80'),
  ('banned_words', '[]');

-- Cột phục vụ validate và duyệt.
ALTER TABLE drafts ADD COLUMN validation_errors TEXT;     -- JSON array, rỗng khi hợp lệ
ALTER TABLE drafts ADD COLUMN attempts INTEGER DEFAULT 0; -- số lần gọi AI
ALTER TABLE drafts ADD COLUMN approved_at TEXT;
ALTER TABLE drafts ADD COLUMN source_price REAL;          -- giá nguồn dùng để tính giá bán
ALTER TABLE drafts ADD COLUMN shipping_cost REAL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_drafts_product ON drafts(product_id);
