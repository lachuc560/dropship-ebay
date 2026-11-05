-- Chọn ảnh để lưu: mỗi dòng images là một ảnh ứng viên của sản phẩm.
-- selected = 1 nghĩa là seller chọn ảnh này để tải lên R2. Mặc định là chọn tất cả ứng viên hiện có.
ALTER TABLE images ADD COLUMN selected INTEGER NOT NULL DEFAULT 1;
