-- Bổ sung các trường tùy chọn của mục 4.1 (plan): brand, bullets, mô tả gốc, specs, tồn kho, shipping.
-- Bảng products đã có title_raw, price_raw, currency, raw_json từ 0001.

ALTER TABLE products ADD COLUMN brand TEXT;
ALTER TABLE products ADD COLUMN bullets_json TEXT;        -- JSON array
ALTER TABLE products ADD COLUMN description_raw TEXT;
ALTER TABLE products ADD COLUMN specs_json TEXT;          -- JSON object
ALTER TABLE products ADD COLUMN in_stock INTEGER;         -- 1 / 0 / NULL (không rõ)
ALTER TABLE products ADD COLUMN shipping_info TEXT;
ALTER TABLE products ADD COLUMN variants_json TEXT;       -- JSON array (Phase 5)

-- Bảng images đã có từ 0001. Thêm chỉ mục để lấy ảnh theo sản phẩm nhanh.
CREATE INDEX IF NOT EXISTS idx_images_product ON images(product_id, position);
